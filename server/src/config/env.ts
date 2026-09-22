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
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

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

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = Object.freeze({
  ...env,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
});

export type Config = typeof config;
