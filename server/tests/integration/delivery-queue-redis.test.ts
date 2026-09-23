/**
 * The claim script against a REAL Redis.
 *
 * Skipped unless `TEST_REDIS_URL` is set, because the suite must stay runnable with no services
 * beyond the database the other integration tests already need. The fake in
 * tests/unit/delivery-queue.test.ts states what the script should do; this checks that Redis
 * agrees — the atomicity claim is about Lua's execution model, and only a server can prove it.
 *
 * Run it with:  TEST_REDIS_URL=redis://localhost:6379 npx vitest run tests/integration/delivery-queue-redis.test.ts
 */
import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { __testing, type DeliveryTask } from '../../src/services/deliveryQueue.js';

const url = process.env.TEST_REDIS_URL;
const { RedisQueue, PENDING_KEY, INFLIGHT_KEY, VISIBILITY_MS } = __testing;

const task = (notificationId: string): DeliveryTask => ({ institutionId: 'inst-1', notificationId });

describe.skipIf(!url)('the claim script on a real Redis', () => {
  const redis = new Redis(url ?? 'redis://localhost:6379', { lazyConnect: true });

  afterAll(async () => {
    await redis.del(PENDING_KEY, INFLIGHT_KEY);
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(PENDING_KEY, INFLIGHT_KEY);
  });

  it('moves an item from pending to in-flight in one step', async () => {
    const queue = new RedisQueue(redis);
    await queue.enqueue(task('n1'));

    expect(await redis.llen(PENDING_KEY)).toBe(1);
    const claimed = await queue.claim();

    expect(claimed?.task.notificationId).toBe('n1');
    expect(await redis.llen(PENDING_KEY)).toBe(0);
    expect(await redis.zcard(INFLIGHT_KEY)).toBe(1);

    await queue.ack(claimed!.receipt);
    expect(await redis.zcard(INFLIGHT_KEY)).toBe(0);
  });

  it('gives one item to exactly one of many concurrent workers', async () => {
    const queue = new RedisQueue(redis);
    await queue.enqueue(task('n1'));

    // Ten workers racing for one item — this is the two-instance case, amplified.
    const results = await Promise.all(Array.from({ length: 10 }, async () => new RedisQueue(redis).claim()));
    const winners = results.filter((result) => result !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.task.notificationId).toBe('n1');
  });

  it('shares a queue of many items out without duplicating any', async () => {
    const queue = new RedisQueue(redis);
    for (let i = 0; i < 20; i += 1) await queue.enqueue(task(`n${i}`));

    const workerA = new RedisQueue(redis);
    const workerB = new RedisQueue(redis);
    const drained: string[] = [];

    const drain = async (worker: RedisQueue): Promise<void> => {
      for (;;) {
        const claimed = await worker.claim();
        if (!claimed) return;
        drained.push(claimed.task.notificationId);
        await worker.ack(claimed.receipt);
      }
    };
    await Promise.all([drain(workerA), drain(workerB)]);

    expect(drained).toHaveLength(20);
    expect(new Set(drained).size).toBe(20);
  });

  it('holds a claimed item until its visibility window expires', async () => {
    const queue = new RedisQueue(redis);
    await queue.enqueue(task('n1'));
    const claimed = await queue.claim();

    // Nobody else may take it while the claim is live.
    expect(await new RedisQueue(redis).claim()).toBeNull();

    // Rewind the deadline by hand rather than waiting two minutes for it.
    await redis.zadd(INFLIGHT_KEY, String(Date.now() - VISIBILITY_MS), claimed!.receipt);
    const reclaimed = await new RedisQueue(redis).claim();
    expect(reclaimed?.task.notificationId).toBe('n1');
  });

  it('still holds the work after the process that queued it is gone', async () => {
    await new RedisQueue(redis).enqueue(task('n1'));

    // A fresh connection stands in for a restarted process: the queue is in Redis, not in it.
    const afterRestart = new Redis(url ?? 'redis://localhost:6379');
    try {
      const queue = new RedisQueue(afterRestart);
      expect(await queue.size()).toBe(1);
      expect((await queue.claim())?.task.notificationId).toBe('n1');
    } finally {
      await afterRestart.quit();
    }
  });
});
