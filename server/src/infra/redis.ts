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
