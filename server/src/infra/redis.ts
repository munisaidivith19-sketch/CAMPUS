/**
 * The shared Redis connection.
 *
 * Redis is infrastructure, not a source of truth: it holds rate-limit counters and, later,
 * caches and queues. Nothing here is allowed to take the API down — if `REDIS_URL` is unset the
 * client is simply absent (`null`) and every caller falls back to its in-process equivalent, and
 * if Redis is up but unreachable, commands reject quickly instead of queueing forever.
 *
 * Two settings carry that promise:
 *  - `enableOfflineQueue: false` — a command issued while the socket is down fails immediately
 *    rather than waiting for a reconnect. A rate-limit check must never add latency to a login.
 *  - `maxRetriesPerRequest: 1` — one retry, then the caller's fallback decides what to do.
 */
import Redis from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

let client: Redis | null = null;
let initialised = false;

/**
 * The process-wide client, or `null` when Redis is NOT CONFIGURED.
 *
 * Callers must handle `null` — that is the documented single-instance dev mode, not an error.
 */
export function getRedisClient(): Redis | null {
  if (initialised) return client;
  initialised = true;

  if (!config.REDIS_URL) {
    logger.info('REDIS_URL is not set — Redis-backed features fall back to in-process stores');
    return null;
  }

  client = new Redis(config.REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    connectTimeout: 3_000,
    // Give up reconnecting after a while rather than logging forever; the fallback keeps working.
    retryStrategy: (times) => (times > 20 ? null : Math.min(times * 200, 3_000)),
  });

  // Without a listener, ioredis emits 'error' as an unhandled exception and kills the process.
  client.on('error', (err: Error) => {
    logger.warn({ err: err.message }, 'Redis connection error — degraded to in-process fallback');
  });
  client.on('ready', () => {
    logger.info('Redis connected');
  });

  return client;
}

/**
 * Wait (briefly) for the client to finish connecting.
 *
 * With `enableOfflineQueue: false` a command issued during the connect handshake fails
 * immediately, so anything that runs in the first moments after boot — the delivery queue's
 * first enqueue, for instance — would degrade for no good reason. This closes that window
 * without reintroducing an unbounded wait: if the socket is not up within `timeoutMs`, the
 * caller proceeds and its own failure handling takes over.
 *
 * Deliberately NOT used by the rate limiter: a login must never wait on Redis at all.
 */
export async function waitForRedisReady(client: Redis, timeoutMs = 2_000): Promise<boolean> {
  if (client.status === 'ready') return true;
  // 'end' means the client has given up reconnecting; waiting would be pointless.
  if (client.status === 'end') return false;

  return new Promise<boolean>((resolve) => {
    const done = (value: boolean): void => {
      clearTimeout(timer);
      client.off('ready', onReady);
      resolve(value);
    };
    const onReady = (): void => {
      done(true);
    };
    const timer = setTimeout(() => {
      done(false);
    }, timeoutMs);
    timer.unref();
    client.once('ready', onReady);
  });
}

/** Close the connection on shutdown. Safe to call when Redis was never configured. */
export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
  initialised = false;
}
