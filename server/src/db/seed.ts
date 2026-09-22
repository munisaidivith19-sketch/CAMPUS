/**
 * Development seed entrypoint. SYNTHETIC DATA ONLY — never real student PII.
 *
 * Run with `npm run seed -w server`. Idempotent: re-running updates the RBAC catalog and leaves
 * existing accounts untouched.
 *
 * The dev passwords are printed to the console ONLY outside production, and only because these
 * are fictional local accounts. They are never written to the log stream as structured fields,
 * and nothing here ever prints a real secret.
 */
import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connection.js';
import { seedDevelopmentData } from './seeders.js';
import { logger } from '../utils/logger.js';

async function seed(): Promise<void> {
  if (config.isProd) {
    logger.error('Refusing to run the development seed in production.');
    process.exit(1);
  }

  await connectDatabase();
  const { institution, credentials } = await seedDevelopmentData(config.COLLEGE_EMAIL_DOMAIN);

  logger.info(
    { institution: institution.name, slug: institution.slug, users: credentials.length },
    'Seed complete',
  );

  /* eslint-disable no-console */
  console.log('\n  Synthetic development accounts (local only)\n');
  for (const credential of credentials) {
    console.log(`  ${credential.role.padEnd(14)} ${credential.email.padEnd(34)} ${credential.password}`);
  }
  console.log('\n  These are fictional accounts for local development. Never reuse them anywhere else.\n');
  /* eslint-enable no-console */

  await disconnectDatabase();
}

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });
