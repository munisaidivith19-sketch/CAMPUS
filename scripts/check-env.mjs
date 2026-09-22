#!/usr/bin/env node
/**
 * Verifies that a local `.env` exists and contains the variables the app requires to boot.
 * Does NOT print secret values. Run: `node scripts/check-env.mjs`
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

const REQUIRED = ['MONGODB_URI', 'COLLEGE_EMAIL_DOMAIN'];
const RECOMMENDED = ['REDIS_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'SMTP_HOST'];

if (!existsSync(envPath)) {
  console.error('❌ No .env found. Copy .env.example to .env first.');
  process.exit(1);
}

const present = new Set(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim()),
);

const missing = REQUIRED.filter((k) => !present.has(k));
const missingRec = RECOMMENDED.filter((k) => !present.has(k));

if (missing.length) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
if (missingRec.length) {
  console.warn(`⚠️  Missing recommended env vars (some features will be disabled): ${missingRec.join(', ')}`);
}
console.log('✅ .env looks good (required variables present).');
