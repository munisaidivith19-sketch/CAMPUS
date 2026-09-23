/**
 * The delivery queue's own mechanics, exercised without a live Redis.
 *
 * The Redis backend is driven against a small fake that implements the handful of commands the
 * queue uses — including the Lua claim, whose semantics are reimplemented here so the test says
 * what the script is supposed to do. The script itself is verified against a real server in the
 * live checks and in delivery-queue-redis.test.ts (which runs only when TEST_REDIS_URL is set).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __testing, type DeliveryTask } from '../../src/services/deliveryQueue.js';

const { RedisQueue, InProcessQueue, VISIBILITY_MS } = __testing;

type FakeRedis = ConstructorParameters<typeof RedisQueue>[0];

/**
 * A fake Redis holding just a list and a sorted set.
 *
 * `eval` implements the same rule as CLAIM_SCRIPT: take the oldest pending item, or else an
 * in-flight item whose visibility deadline has passed, and (re)set its deadline atomically.
 */
function fakeRedis(): FakeRedis & { pending: string[]; inflight: Map<string, number> } {
  const pending: string[] = [];
  const inflight = new Map<string, number>();

  const fake = {
    pending,
    inflight,
    // The queue waits out the connect handshake on its first command, so the fake has to look
    // like a client that is already connected.
    status: 'ready',
    lpush: async (_key: string, value: string) => {
      pending.unshift(value);
      return pending.length;
    },
    eval: async (_script: string, _numKeys: number, ..._args: string[]) => {
      const now = Number(_args[2]);
      const deadline = Number(_args[3]);
      const item = pending.pop();
      if (item !== undefined) {
        inflight.set(item, deadline);
        return item;
      }
      for (const [member, score] of inflight) {
        if (score <= now) {
          inflight.set(member, deadline);
          return member;
        }
      }
      return null;
    },
    zrem: async (_key: string, member: string) => (inflight.delete(member) ? 1 : 0),
    llen: async () => pending.length,
    zcard: async () => inflight.size,
    del: async () => {
      pending.length = 0;
      inflight.clear();
      return 1;
    },
  };

  return fake as unknown as FakeRedis & { pending: string[]; inflight: Map<string, number> };
}

const task = (notificationId: string): DeliveryTask => ({ institutionId: 'inst-1', notificationId });

describe('the durable queue', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let queue: InstanceType<typeof RedisQueue>;

  beforeEach(() => {
    redis = fakeRedis();
    queue = new RedisQueue(redis);
  });

  it('hands out what was put in, oldest first', async () => {
    await queue.enqueue(task('n1'));
    await queue.enqueue(task('n2'));

    expect((await queue.claim())?.task.notificationId).toBe('n1');
    expect((await queue.claim())?.task.notificationId).toBe('n2');
    expect(await queue.claim()).toBeNull();
  });

  it('holds a claimed item in flight until it is acked', async () => {
    await queue.enqueue(task('n1'));
    const claimed = await queue.claim();

    // Still counted as outstanding work: claimed is not the same as done.
    expect(await queue.size()).toBe(1);
    await queue.ack(claimed!.receipt);
    expect(await queue.size()).toBe(0);
  });

  it('does not hand the same item to a second worker', async () => {
    // Two workers, one queue — this is the multi-instance case.
    const workerA = new RedisQueue(redis);
    const workerB = new RedisQueue(redis);
    await workerA.enqueue(task('n1'));

    const first = await workerA.claim();
    const second = await workerB.claim();

    expect(first?.task.notificationId).toBe('n1');
    expect(second).toBeNull();
  });

  it('survives a worker that dies holding an item', async () => {
    vi.useFakeTimers();
    try {
      await queue.enqueue(task('n1'));
      await queue.claim(); // …and this worker never acks: it crashed.

      // Nothing to do while the claim is still valid — no other worker should pick it up.
      expect(await queue.claim()).toBeNull();

      vi.advanceTimersByTime(VISIBILITY_MS + 1);

      // Once the visibility window lapses the work is recoverable rather than lost.
      expect((await queue.claim())?.task.notificationId).toBe('n1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps work across a restart, because the work is not in the process', async () => {
    await queue.enqueue(task('n1'));
    await queue.enqueue(task('n2'));

    // A new process, a brand-new queue object, the same Redis.
    const afterRestart = new RedisQueue(redis);
    expect(await afterRestart.size()).toBe(2);
    expect((await afterRestart.claim())?.task.notificationId).toBe('n1');
  });

  it('discards an unreadable payload instead of jamming behind it', async () => {
    redis.pending.push('not json at all');
    expect(await queue.claim()).toBeNull();
    expect(await queue.size()).toBe(0);
  });
});

describe('the in-process fallback', () => {
  it('behaves like the durable queue for a single process', async () => {
    const queue = new InProcessQueue();
    await queue.enqueue(task('n1'));

    const claimed = await queue.claim();
    expect(claimed?.task.notificationId).toBe('n1');
    expect(await queue.size()).toBe(1);

    await queue.ack(claimed!.receipt);
    expect(await queue.size()).toBe(0);
    expect(await queue.claim()).toBeNull();
  });
});
