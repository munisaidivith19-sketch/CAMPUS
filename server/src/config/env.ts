/**
 * Environment loading + validation. Read ONCE at startup, validated with Zod, exposed as a
 * typed frozen object. The app refuses to boot if required vars are missing/malformed
 * (fail fast). No other module reads process.env directly.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Resolve the monorepo root .env regardless of the process cwd (npm workspace scripts run
// with cwd set to this package, not the repo root).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
loadEnv({ path: path.resolve(REPO_ROOT, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  API_VERSION: z.string().default('v1'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().optional(),

  REDIS_URL: z.string().optional(),

  /**
   * Phase 2 (auth) is live, so these are no longer optional: the app cannot issue or verify a
   * token without them and must not fall back to a guessable default.
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Argon2id tuning (ADR-0004). Raise as hardware improves.
  ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  // --- Institution email enforcement (backend-enforced, never frontend-only) ---
  COLLEGE_EMAIL_DOMAIN: z.string().min(3).default('jnn.edu.in'),

  // --- Email (Mailpit in dev; no real credentials needed) ---
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAIL_FROM: z.string().default('CampusConnect <no-reply@jnn.edu.in>'),

  /** Public origin of the web app, used to build links inside emails. */
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),

  // --- Notification delivery (Phase 3 Part B) ---
  /**
   * Out-of-band delivery is a side channel on top of the in-app notification row, which stays
   * the source of truth. Turning this off stops delivery attempts; it never stops the row.
   */
  NOTIFICATION_DELIVERY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  /** Base backoff in ms; each retry multiplies it (100 → 200 → 400 …). */
  NOTIFICATION_DELIVERY_BACKOFF_MS: z.coerce.number().int().min(10).max(60_000).default(500),
  /**
   * How often a worker looks for queued deliveries it has not been told about: another
   * instance's enqueue, or work a crashed worker left behind. Enqueue on this instance drains
   * immediately, so this only sets the worst-case latency for the other two cases.
   */
  NOTIFICATION_DELIVERY_POLL_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),

  /** How many people one group chat may hold. */
  CHAT_GROUP_MAX_MEMBERS: z.coerce.number().int().min(2).max(2_000).default(256),
  /**
   * Per (chat, recipient) quiet period for offline chat notifications. A burst of messages in
   * one conversation is one thing to be told about, not thirty.
   */
  CHAT_NOTIFY_DEBOUNCE_MS: z.coerce.number().int().min(0).max(3_600_000).default(120_000),
  /** Messages one user may send per minute, across every chat. */
  CHAT_SEND_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(60),
  /** Socket events one connection may emit per minute before it is throttled. */
  CHAT_SOCKET_EVENTS_PER_MINUTE: z.coerce.number().int().min(10).max(6_000).default(240),

  /**
   * Push provider. `none` means push is NOT CONFIGURED: attempts are recorded as skipped
   * rather than failed, and nothing is sent. No provider is contacted in tests.
   */
  PUSH_PROVIDER: z.enum(['none', 'expo']).default('none'),
  PUSH_API_URL: z.string().url().default('https://exp.host/--/api/v2/push/send'),
  /** Optional Expo access token. Never hardcoded; absent is a valid, degraded configuration. */
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // --- File sharing (Phase 3 Part C-3) ----------------------------------------
  /**
   * Where file BYTES live. Only `local` is implemented; naming another driver fails the boot
   * with "NOT CONFIGURED" rather than silently writing somewhere unexpected.
   */
  STORAGE_DRIVER: z.enum(['local', 's3', 'gcs', 'azure']).default('local'),
  /**
   * Outside anything served, git-ignored, created at boot. A relative value is resolved against
   * the repository root (not the process cwd, which differs between npm scripts), so the path
   * the server actually uses is always absolute and always the same one.
   */
  STORAGE_LOCAL_ROOT: z
    .string()
    .min(1)
    .default('storage/files')
    .transform((value) => (path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value))),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(1_073_741_824).default(26_214_400),
  /** Allowlisted types, by extension. Each must be one the server knows how to verify. */
  UPLOAD_ALLOWED_TYPES: z
    .string()
    .default('pdf,png,jpg,jpeg,webp,gif,docx,xlsx,pptx,txt,csv,zip')
    .transform((s) =>
      s
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** ZIP-bomb limits, applied to ZIPs and to Office (DOCX/XLSX/PPTX) containers alike. */
  ZIP_MAX_ENTRIES: z.coerce.number().int().min(1).max(100_000).default(1_000),
  ZIP_MAX_RATIO: z.coerce.number().min(1).max(10_000).default(100),
  ZIP_MAX_TOTAL_BYTES: z.coerce.number().int().min(1024).default(209_715_200),
  /** Lifetime of a signed download URL. */
  FILE_DOWNLOAD_TOKEN_TTL_S: z.coerce.number().int().min(10).max(3_600).default(300),
  /**
   * Backend-only HMAC key for download URLs. Required in production. Every instance behind one
   * deployment must share it, or a URL minted by one instance fails on another.
   */
  FILE_SIGNING_SECRET: z
    .string()
    .min(32, 'FILE_SIGNING_SECRET must be at least 32 characters')
    .optional(),
  /** Per-user storage allowance across their live files. */
  USER_UPLOAD_QUOTA_BYTES: z.coerce.number().int().min(1024).default(209_715_200),
  /** Uploads one user may start per hour. */
  UPLOAD_RATE_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(60),
  /** How long an uploaded-but-never-attached file survives before the cleanup job removes it. */
  FILE_ORPHAN_TTL_HOURS: z.coerce
    .number()
    .min(0.001)
    .max(24 * 30)
    .default(24),
  FILE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(3_600_000),

  /**
   * ClamAV (clamd INSTREAM). Disabled means uploads are recorded as SKIPPED — downloadable in
   * development only, and labelled "not scanned". Enabled but unreachable means SCAN_FAILED,
   * which is never downloadable.
   */
  CLAMAV_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

/**
 * Cross-field rules the schema cannot express on its own. These fail the boot, like any other
 * invalid configuration, rather than degrading quietly.
 */
const configProblems: string[] = [];
if (env.STORAGE_DRIVER !== 'local') {
  configProblems.push(
    `STORAGE_DRIVER=${env.STORAGE_DRIVER} is NOT CONFIGURED — only "local" is implemented`,
  );
}
if (env.NODE_ENV === 'production' && !env.FILE_SIGNING_SECRET) {
  configProblems.push('FILE_SIGNING_SECRET is required in production');
}
if (configProblems.length > 0) {
  console.error('❌ Invalid environment configuration:', configProblems);
  process.exit(1);
}

export const config = Object.freeze({
  ...env,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
});

export type Config = typeof config;
