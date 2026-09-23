/**
 * The delivery work queue.
 *
 * Two backends behind one interface:
 *
 *  - **Redis (durable, multi-instance).** A reliable-queue pattern: a `pending` LIST plus an
 *    `inflight` ZSET scored by a visibility deadline. Claiming pops from `pending` and records
 *    the deadline in `inflight` inside a single Lua script, so two instances can never claim the
 *    same item — `RPOP` and `ZADD` are one atomic step. Ack removes it from `inflight`.
 *    Recovery falls out of the same structure: an item whose deadline has passed (its worker
 *    died mid-drain) is re-claimable by the next worker, and anything still in `pending` at
 *    startup is simply claimed as normal. Nothing is lost to a restart.
 *
 *  - **In-process (fallback).** The Part B queue, kept for two cases: Redis is NOT CONFIGURED
 *    (single-instance dev), or Redis is unreachable at enqueue time. See the degradation note
 *    below.
 *
 * ## Redis down: fail open, degrade, never drop
 *
 * Consistent with the rate limiter (docs/security/SECURITY.md): the in-app notification row is
 * already written and is the source of truth, so an unavailable queue must never propagate back
 * into the request. If `LPUSH` fails, the item goes onto the in-process queue instead and a
 * warning is logged — delivery is still attempted on this instance, it just loses durability
 * until Redis returns. The alternative (drop, or fail the enqueue) would either lose the
 * out-of-band copy silently or let a Redis outage break notification writes. Neither is
 * acceptable; weaker durability for the length of an outage is.
 *
 * The one thing a degraded enqueue costs is the restart guarantee: an item queued in-process
 * while Redis was down does not survive a restart. That is logged, not hidden.
 */
import { getRedisClient, waitForRedisReady } from '../infra/redis.js';
import { logger } from '../utils/logger.js';

export interface DeliveryTask {
  institutionId: string;
  notificationId: string;
}

/** An item handed out by `claim`, with whatever the backend needs to ack it. */
export interface ClaimedTask {
  task: DeliveryTask;
  /** Opaque to the caller: the exact payload the backend stored. */
  receipt: string;
}

export interface QueueBackend {
  readonly name: 'redis' | 'in-process';
  enqueue(task: DeliveryTask): Promise<void>;
  claim(): Promise<ClaimedTask | null>;
  ack(receipt: string): Promise<void>;
  /** Pending + in-flight. Used by tests and the drain loop's idle check. */
  size(): Promise<number>;
  clear(): Promise<void>;
}

const PENDING_KEY = 'cc:dq:pending';
const INFLIGHT_KEY = 'cc:dq:inflight';

/**
 * How long a claimed item stays invisible to other workers.
 *
 * Long enough that a worker doing its retries is never overtaken (max attempts × the longest
 * backoff, plus provider timeouts), short enough that a crashed worker's item is picked up
 * promptly. Re-claiming early would not double-send — the per-channel guard in
 * notificationDelivery.service prevents that — but it would waste work.
 */
const VISIBILITY_MS = 120_000;

/**
 * Claim one item atomically.
 *
 * Returns a fresh item if there is one, otherwise the oldest item whose visibility deadline has
 * expired (a crashed worker's). Both paths set a new deadline in the same script.
 */
const CLAIM_SCRIPT = `
local item = redis.call('RPOP', KEYS[1])
if item then
  redis.call('ZADD', KEYS[2], ARGV[2], item)
  return item
end
local stale = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1)
if stale[1] then
  redis.call('ZADD', KEYS[2], ARGV[2], stale[1])
  return stale[1]
end
return nil
`;

function parseTask(payload: string): DeliveryTask | null {
  try {
    const parsed = JSON.parse(payload) as Partial<DeliveryTask>;
    if (typeof parsed.institutionId !== 'string' || typeof parsed.notificationId !== 'string') {
      return null;
    }
    return { institutionId: parsed.institutionId, notificationId: parsed.notificationId };
  } catch {
    return null;
  }
}

class RedisQueue implements QueueBackend {
  readonly name = 'redis' as const;
  private awaitedHandshake = false;

  constructor(private readonly redis: NonNullable<ReturnType<typeof getRedisClient>>) {}

  /**
   * Wait out the initial connect handshake, once.
   *
   * The problem this solves is narrow: with the offline queue disabled, a command issued in the
   * first moments after boot fails even though Redis is perfectly healthy, and every delivery in
   * that window would degrade for nothing. Waiting only on the FIRST command keeps that fix from
   * turning into a 2-second tax on every task while Redis is actually down — after the first
   * one, commands fail fast and the caller degrades, which is the intended behaviour.
   */
  private async handshake(): Promise<void> {
    if (this.awaitedHandshake) return;
    this.awaitedHandshake = true;
    await waitForRedisReady(this.redis);
  }

  async enqueue(task: DeliveryTask): Promise<void> {
    await this.handshake();
    await this.redis.lpush(PENDING_KEY, JSON.stringify(task));
  }

  async claim(): Promise<ClaimedTask | null> {
    await this.handshake();
    const now = Date.now();
    const payload = (await this.redis.eval(
      CLAIM_SCRIPT,
      2,
      PENDING_KEY,
      INFLIGHT_KEY,
      String(now),
      String(now + VISIBILITY_MS),
    )) as string | null;

    if (!payload) return null;

    const task = parseTask(payload);
    if (!task) {
      // Unreadable payload: drop it rather than poison the queue forever.
      logger.error({ payload: payload.slice(0, 120) }, 'Discarding unreadable delivery task');
      await this.ack(payload);
      return null;
    }
    return { task, receipt: payload };
  }

  async ack(receipt: string): Promise<void> {
    await this.redis.zrem(INFLIGHT_KEY, receipt);
  }

  async size(): Promise<number> {
    const [pending, inflight] = await Promise.all([
      this.redis.llen(PENDING_KEY),
      this.redis.zcard(INFLIGHT_KEY),
    ]);
    return pending + inflight;
  }

  async clear(): Promise<void> {
    await this.redis.del(PENDING_KEY, INFLIGHT_KEY);
  }
}

/** The Part B queue. No durability, no sharing — correct for one dev process, and the fallback. */
class InProcessQueue implements QueueBackend {
  readonly name = 'in-process' as const;
  private readonly pending: string[] = [];
  private readonly inflight = new Set<string>();

  async enqueue(task: DeliveryTask): Promise<void> {
    this.pending.push(JSON.stringify(task));
  }

  async claim(): Promise<ClaimedTask | null> {
    const payload = this.pending.shift();
    if (!payload) return null;
    const task = parseTask(payload);
    if (!task) return null;
    this.inflight.add(payload);
    return { task, receipt: payload };
  }

  async ack(receipt: string): Promise<void> {
    this.inflight.delete(receipt);
  }

  async size(): Promise<number> {
    return this.pending.length + this.inflight.size;
  }

  async clear(): Promise<void> {
    this.pending.length = 0;
    this.inflight.clear();
  }
}

const fallbackQueue = new InProcessQueue();
let primaryQueue: QueueBackend | null = null;
let resolved = false;
let lastDegradeWarnAt = 0;

/** The durable backend, or null when Redis is NOT CONFIGURED. */
function primary(): QueueBackend | null {
  if (!resolved) {
    resolved = true;
    const redis = getRedisClient();
    primaryQueue = redis ? new RedisQueue(redis) : null;
    if (!primaryQueue) {
      logger.info('Delivery queue is in-process (REDIS_URL not set): it does not survive restarts');
    }
  }
  return primaryQueue;
}

function warnDegraded(err: unknown): void {
  const now = Date.now();
  if (now - lastDegradeWarnAt < 60_000) return;
  lastDegradeWarnAt = now;
  logger.warn(
    { err: err instanceof Error ? err.message : String(err) },
    'Delivery queue unavailable — degraded to the in-process queue; queued work will not survive a restart',
  );
}

/** True when the last enqueue had to fall back. Surfaced for tests and diagnostics. */
let degraded = false;
export function isDeliveryQueueDegraded(): boolean {
  return degraded;
}

/**
 * Put a task on the durable queue, falling back to the in-process one.
 *
 * Never throws: the caller has already written the in-app notification, and nothing here is
 * allowed to turn that into a failure.
 */
export async function pushTask(task: DeliveryTask): Promise<void> {
  const durable = primary();
  if (durable) {
    try {
      await durable.enqueue(task);
      degraded = false;
      return;
    } catch (err) {
      warnDegraded(err);
      degraded = true;
    }
  }
  await fallbackQueue.enqueue(task);
}

/**
 * Claim the next task from either queue.
 *
 * The in-process queue is drained first because anything on it is already degraded work that
 * only this process can finish.
 */
export async function claimTask(): Promise<ClaimedTask | null> {
  const local = await fallbackQueue.claim();
  if (local) return local;

  const durable = primary();
  if (!durable) return null;
  try {
    return await durable.claim();
  } catch (err) {
    warnDegraded(err);
    degraded = true;
    return null;
  }
}

/** Ack on both: a receipt only exists in one of them, and removing a missing member is a no-op. */
export async function ackTask(receipt: string): Promise<void> {
  await fallbackQueue.ack(receipt);
  const durable = primary();
  if (!durable) return;
  try {
    await durable.ack(receipt);
  } catch (err) {
    // The item stays in-flight and becomes re-claimable after the visibility window. The
    // per-channel guard makes that harmless.
    warnDegraded(err);
  }
}

export async function queueSize(): Promise<number> {
  const durable = primary();
  const local = await fallbackQueue.size();
  if (!durable) return local;
  try {
    return local + (await durable.size());
  } catch {
    return local;
  }
}

/** Name of the backend in use, for logs and the report. */
export function queueBackendName(): QueueBackend['name'] {
  return primary() ? 'redis' : 'in-process';
}

/** Test-only: empty both queues and forget the resolved backend. */
export async function resetDeliveryQueue(): Promise<void> {
  await fallbackQueue.clear();
  const durable = primary();
  if (durable) {
    try {
      await durable.clear();
    } catch {
      // Nothing to clean up if Redis is unreachable.
    }
  }
  degraded = false;
  // Forget any backend a test installed, so the next one starts from the environment's.
  invalidateQueueBackend();
}

/** Test-only: re-resolve the backend after REDIS_URL or the client changes. */
export function invalidateQueueBackend(): void {
  resolved = false;
  primaryQueue = null;
}

/**
 * Test-only: stand a specific backend in front of Redis.
 *
 * Used to drive the degraded path — a backend that throws is the only honest way to test what
 * happens when Redis is unreachable, short of stopping a real server mid-suite.
 */
export function __setPrimaryQueueForTests(backend: QueueBackend | null): void {
  resolved = true;
  primaryQueue = backend;
  degraded = false;
  lastDegradeWarnAt = 0;
}

export const __testing = { VISIBILITY_MS, PENDING_KEY, INFLIGHT_KEY, InProcessQueue, RedisQueue };
