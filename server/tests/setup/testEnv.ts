/**
 * Test environment bootstrap. Runs BEFORE any test module — and therefore before
 * `config/env.ts` is imported, which is the point: dotenv does not override variables that are
 * already set, so these win over `.env`.
 *
 * Two things matter here:
 *  - `NODE_ENV=test` switches the mailer to an in-memory JSON transport, so suites assert on
 *    what would have been sent without needing a live SMTP server.
 *  - `MONGODB_DB_NAME` points at a throwaway database so a test run can never touch dev data.
 */
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.MONGODB_DB_NAME = process.env.TEST_DB_NAME ?? 'campusconnect_test';
// 'fatal' is the quietest level the config schema accepts — keeps suite output readable.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'fatal';

// Deterministic, test-only secrets. Never used outside the test database.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-00000';

// Keep Argon2id at its floor here: these suites hash a lot of passwords and the cost
// parameters are an ADR-0004 production concern, not something the tests are measuring.
process.env.ARGON2_MEMORY_COST = '8192';
process.env.ARGON2_TIME_COST = '2';
process.env.ARGON2_PARALLELISM = '1';

// Retry backoff is what we assert on, not what we wait for — keep it at the schema's floor so
// a test that exercises exhausted retries finishes in milliseconds instead of seconds.
process.env.NOTIFICATION_DELIVERY_BACKOFF_MS = '10';
// No real push provider is ever contacted from a test; suites that need one install a fake.
process.env.PUSH_PROVIDER = 'none';

// No live Redis either. An empty value is still "set", so dotenv will not put .env's URL back,
// and the rate limiters fall back to their in-process store — which is what the suite asserts on.
process.env.REDIS_URL = '';

// File bytes go to a throwaway directory per run, never the developer's storage root. Limits
// are shrunk so the size, quota and rate-limit paths can be exercised with small fixtures; the
// scanner is off unless a suite installs one (see file.service `setScannerForTesting`).
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_ROOT = path.join(os.tmpdir(), `cc-test-storage-${process.pid}`);
process.env.MAX_UPLOAD_BYTES = String(1024 * 1024);
process.env.USER_UPLOAD_QUOTA_BYTES = String(3 * 1024 * 1024);
process.env.UPLOAD_RATE_PER_HOUR = '25';
process.env.CLAMAV_ENABLED = 'false';
process.env.FILE_SIGNING_SECRET = 'test-file-signing-secret-long-enough-000000';
process.env.FILE_ORPHAN_TTL_HOURS = '24';
