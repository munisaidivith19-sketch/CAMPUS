/**
 * Per-route rate limits for authentication-sensitive endpoints (SECURITY.md §5 — brute force /
 * credential stuffing, API abuse).
 *
 * These sit on top of the coarse global limiter in app.ts and are deliberately strict: login,
 * OTP verification and password-reset requests are the endpoints worth guessing against. All of
 * them answer with the standard RATE_LIMITED envelope and no extra detail.
 *
 * **Store: in-memory. Redis-backed rate limiting is NOT CONFIGURED.** This is the documented
 * dev degradation from docs/architecture/03-backend-architecture.md — correct for a single
 * process, but counters are per-instance and reset on restart, so a multi-instance deployment
 * must swap in the Redis store before going to production.
 */
import { MemoryStore, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { Errors } from '../utils/errors.js';

const stores: MemoryStore[] = [];

function makeLimiter(windowMs: number, limit: number): RateLimitRequestHandler {
  const store = new MemoryStore();
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

/** Password guessing: strict, because a correct guess is total account compromise. */
export const loginLimiter = makeLimiter(15 * MINUTES, 10);

/** Signup abuse / mailbox flooding. */
export const registerLimiter = makeLimiter(60 * MINUTES, 5);

/** Reset-link flooding. Per-user throttling also happens inside the auth service. */
export const forgotPasswordLimiter = makeLimiter(60 * MINUTES, 5);

/** OTP / TOTP guessing, on top of the per-challenge attempt cap. */
export const otpLimiter = makeLimiter(15 * MINUTES, 10);

/** Reset redemption attempts. */
export const resetPasswordLimiter = makeLimiter(60 * MINUTES, 10);

/**
 * Clear every counter. Used by the test suite so one suite's login attempts cannot exhaust the
 * budget of the next — production code never calls this.
 */
export function resetRateLimiters(): void {
  for (const store of stores) store.resetAll();
}
