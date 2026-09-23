/**
 * Per-route rate limits for authentication-sensitive endpoints (SECURITY.md §5 — brute force /
 * credential stuffing, API abuse).
 *
 * Every limiter in the app is built here, including the coarse global one app.ts mounts, so they
 * all share one store policy. The per-route limits are deliberately strict: login,
 * OTP verification and password-reset requests are the endpoints worth guessing against. All of
 * them answer with the standard RATE_LIMITED envelope and no extra detail.
 *
 * **Store: Redis when `REDIS_URL` is set, so counters hold across processes and instances; the
 * in-process memory store otherwise.** A deployment behind more than one API instance must set
 * `REDIS_URL` — per-instance counters multiply every limit by the instance count.
 *
 * ## Degradation policy: FAIL OPEN, with an in-process floor
 *
 * If Redis is unreachable, a request is NOT rejected. It falls through to the memory store,
 * which keeps counting per instance, and a warning is logged.
 *
 * Why open: SECURITY.md's "fail closed" rule is about **authorization** — an ambiguous policy
 * decision must deny. Rate limiting is an availability control, not an authorization decision,
 * and nothing here grants access to anything. Failing closed would turn a Redis blip into a
 * campus-wide login outage at exactly the moment (an incident) when people most need in, and an
 * attacker who can reach Redis could then lock out every student by taking it down. Failing open
 * costs, at worst, weaker throttling for the duration of the outage — and even that is bounded,
 * because the fallback below still enforces the same limit per instance.
 *
 * The controls that actually protect an account do not depend on Redis and stay in force
 * regardless: Argon2id verification, the per-challenge OTP attempt cap, per-user reset
 * throttling in the auth service, generic (non-enumerating) responses, and MFA.
 */
import { MemoryStore, rateLimit, type RateLimitRequestHandler, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { ClientRateLimitInfo, IncrementResponse, Options } from 'express-rate-limit';
import { getRedisClient } from '../infra/redis.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Don't log a warning per request while Redis is down. */
const FALLBACK_LOG_INTERVAL_MS = 60_000;

/**
 * A store that prefers Redis and falls back to memory when it is unavailable.
 *
 * The fallback counter runs in parallel — it is incremented on the fallback path only, so a
 * short outage degrades to per-instance limiting rather than to no limiting at all.
 */
export class ResilientStore implements Store {
  /**
   * Tells express-rate-limit that this store's keys belong to this instance alone.
   *
   * Without it the validator identifies a store by its CLASS NAME, sees every limiter as one
   * shared store, and reports a spurious ERR_ERL_DOUBLE_COUNT the moment a request passes the
   * global limiter and then a per-route one. Each instance really does own its key space — its
   * own Redis prefix and its own memory store — so this is a statement of fact, not a silencer.
   */
  readonly localKeys = true;

  private readonly fallback = new MemoryStore();
  private lastWarnAt = 0;

  constructor(private readonly primary: Store | null) {}

  init(options: Options): void {
    this.primary?.init?.(options);
    this.fallback.init(options);
  }

  private degrade(operation: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt > FALLBACK_LOG_INTERVAL_MS) {
      this.lastWarnAt = now;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), operation },
        'Rate-limit store unavailable — failing open to the in-process counter',
      );
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (this.primary) {
      try {
        return await this.primary.increment(key);
      } catch (err) {
        this.degrade('increment', err);
      }
    }
    return this.fallback.increment(key);
  }

  async decrement(key: string): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.decrement(key);
        return;
      } catch (err) {
        this.degrade('decrement', err);
      }
    }
    await this.fallback.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.resetKey(key);
      } catch (err) {
        this.degrade('resetKey', err);
      }
    }
    await this.fallback.resetKey(key);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    if (this.primary?.get) {
      try {
        return await this.primary.get(key);
      } catch (err) {
        this.degrade('get', err);
      }
    }
    return this.fallback.get?.(key);
  }

  async resetAll(): Promise<void> {
    // Only the local counter is cleared: wiping a shared Redis namespace from one instance would
    // reset every other instance's limits too. Tests run with the memory store anyway.
    await this.fallback.resetAll?.();
  }
}

const stores: ResilientStore[] = [];

/**
 * Build the primary store for one limiter.
 *
 * Each limiter gets its own key prefix so the login budget and the OTP budget cannot consume
 * one another, and the prefix is namespaced so a shared Redis is not ambiguous.
 */
function makePrimaryStore(name: string): Store | null {
  const redis = getRedisClient();
  if (!redis) return null;

  const store = new RedisStore({
    prefix: `cc:rl:${name}:`,
    // ioredis exposes raw commands through `call`. `async` matters: with the offline queue
    // disabled, `call` throws SYNCHRONOUSLY while the socket is down, and rate-limit-redis
    // expects a promise. Without this, a limiter built before Redis finishes connecting takes
    // the process down at import time.
    sendCommand: async (...args: string[]) =>
      (await redis.call(...(args as [string, ...string[]]))) as never,
  });

  // RedisStore preloads its Lua scripts in its constructor, and nothing awaits those promises.
  // If Redis is not ready yet they reject, and an unhandled rejection is fatal in Node. Marking
  // them handled costs nothing: the store reloads the script on the next increment.
  void store.incrementScriptSha.catch(() => undefined);
  void store.getScriptSha.catch(() => undefined);

  return store;
}

function makeLimiter(name: string, windowMs: number, limit: number): RateLimitRequestHandler {
  const store = new ResilientStore(makePrimaryStore(name));
  stores.push(store);
  return rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Route the rejection through the normal error pipeline so the envelope stays consistent.
    handler: (_req, _res, next) => next(Errors.rateLimited()),
  });
}

const MINUTES = 60_000;

/**
 * The coarse, catch-all limit every request passes through. Generous on purpose: this is DoS
 * protection, and the strict per-route limits below are what stop credential guessing.
 */
export const globalLimiter = makeLimiter('global', 1 * MINUTES, 300);

/** Password guessing: strict, because a correct guess is total account compromise. */
export const loginLimiter = makeLimiter('login', 15 * MINUTES, 10);

/** Signup abuse / mailbox flooding. */
export const registerLimiter = makeLimiter('register', 60 * MINUTES, 5);

/** Reset-link flooding. Per-user throttling also happens inside the auth service. */
export const forgotPasswordLimiter = makeLimiter('forgot', 60 * MINUTES, 5);

/** OTP / TOTP guessing, on top of the per-challenge attempt cap. */
export const otpLimiter = makeLimiter('otp', 15 * MINUTES, 10);

/** Reset redemption attempts. */
export const resetPasswordLimiter = makeLimiter('reset', 60 * MINUTES, 10);

/**
 * Clear every counter. Used by the test suite so one suite's login attempts cannot exhaust the
 * budget of the next — production code never calls this.
 */
export function resetRateLimiters(): void {
  for (const store of stores) void store.resetAll();
}
