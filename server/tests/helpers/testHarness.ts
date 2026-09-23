/**
 * Shared test harness: database lifecycle, tenant fixtures, and authenticated request helpers.
 *
 * Fixtures deliberately go through the real seeding helpers and the real HTTP endpoints rather
 * than poking documents into collections. A test that logs in through `/auth/login` proves the
 * whole pipeline works; one that forges a token would only prove the forgery works.
 */
import mongoose from 'mongoose';
import supertest from 'supertest';
import type { Role } from '@campusconnect/types';
import { UserStatus } from '@campusconnect/types';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config/env.js';
import { ensureInstitution, ensureRolesAndPermissions, ensureUser } from '../../src/db/seeders.js';
import { studentProfileRepository } from '../../src/repositories/profile.repository.js';
import { invalidateRbacCache } from '../../src/services/rbac.service.js';
import { sentMailbox } from '../../src/services/email.service.js';
import { resetRateLimiters } from '../../src/middleware/rateLimit.middleware.js';
import { clearDeliveryQueue } from '../../src/services/notificationDelivery.service.js';
import { resetPushSender } from '../../src/services/push.service.js';

export const app = buildApp();
export const api = (): supertest.Agent => supertest.agent(app);

/**
 * Connect once per process and stay connected.
 *
 * Every suite calls this in `beforeAll`, and they all share one worker process, so this is a
 * no-op after the first. Mongoose's connection is a process-global singleton — tearing it down
 * and rebuilding it 23 times in one process is pure churn, and it was destabilising the run.
 */
export async function connectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(config.MONGODB_URI, {
      dbName: config.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 5000,
    });
  }
}

/**
 * Deliberately a no-op.
 *
 * Suites call this in `afterAll`, but disconnecting would pull the connection out from under
 * the suites that run next in the same process. The worker exits when the run finishes, which
 * closes the socket; there is nothing to clean up by hand.
 */
export async function disconnectTestDatabase(): Promise<void> {
  // Intentionally empty — see the note above.
}

/**
 * Wipe every collection through the native driver.
 *
 * The driver is used on purpose: `AuditLog` refuses deletes at the Mongoose layer, which is the
 * behaviour under test elsewhere, so test cleanup goes underneath it rather than weakening it.
 */
export async function clearDatabase(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  invalidateRbacCache();
  resetRateLimiters();
  sentMailbox.length = 0;
  // Delivery is queued out-of-band, so anything still pending from the previous test would
  // otherwise land in the middle of the next one.
  clearDeliveryQueue();
  resetPushSender();
}

export interface TestTenant {
  institutionId: string;
  domain: string;
}

let tenantCounter = 0;

/** Create an institution with the full RBAC catalog seeded. */
export async function createTenant(domain?: string): Promise<TestTenant> {
  tenantCounter += 1;
  const resolved = domain ?? `tenant${tenantCounter}.test`;
  const institution = await ensureInstitution({
    name: `Test Institution ${tenantCounter}`,
    slug: `test-${tenantCounter}-${Date.now()}`,
    domains: [resolved],
  });
  await ensureRolesAndPermissions(institution._id);
  return { institutionId: String(institution._id), domain: resolved };
}

/** The institution the app treats as its own (COLLEGE_EMAIL_DOMAIN), for registration tests. */
export async function createPrimaryTenant(): Promise<TestTenant> {
  return createTenant(config.COLLEGE_EMAIL_DOMAIN);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  fullName: string;
  institutionId: string;
}

export const DEFAULT_PASSWORD = 'TestPassw0rd!2026';

export async function createUser(
  tenant: TestTenant,
  options: {
    roles: Role[];
    localPart?: string;
    password?: string;
    status?: UserStatus;
    fullName?: string;
  },
): Promise<TestUser> {
  const localPart = options.localPart ?? `user${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const email = `${localPart}@${tenant.domain}`;
  const password = options.password ?? DEFAULT_PASSWORD;
  const primaryRole = options.roles[0];
  if (!primaryRole) throw new Error('createUser requires at least one role');

  const user = await ensureUser({
    institutionId: tenant.institutionId,
    email,
    password,
    fullName: options.fullName ?? 'Test User',
    roles: options.roles,
    primaryRole,
    status: options.status ?? UserStatus.ACTIVE,
  });

  return {
    id: String(user._id),
    email,
    password,
    fullName: user.fullName,
    institutionId: tenant.institutionId,
  };
}

export async function createStudentProfile(
  tenant: TestTenant,
  user: TestUser,
  rollNo = `ROLL${Math.floor(Math.random() * 1_000_000)}`,
): Promise<string> {
  const profile = await studentProfileRepository.create({
    institutionId: tenant.institutionId,
    userId: user.id,
    rollNo,
  });
  return String(profile._id);
}

export interface LoggedIn {
  accessToken: string;
  refreshToken: string;
  user: TestUser;
}

/**
 * Log in through the real endpoint as a native client, so the refresh token comes back in the
 * body and tests can drive rotation explicitly.
 */
export async function login(user: TestUser): Promise<LoggedIn> {
  const response = await api()
    .post('/api/v1/auth/login')
    .set('x-client', 'mobile')
    .send({ email: user.email, password: user.password });

  if (response.status !== 200 || response.body?.data?.status !== 'AUTHENTICATED') {
    throw new Error(`login failed for ${user.email}: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return {
    accessToken: response.body.data.tokens.accessToken as string,
    refreshToken: response.body.data.tokens.refreshToken as string,
    user,
  };
}

/** Create a user, then sign them in. */
export async function createAndLogin(
  tenant: TestTenant,
  options: { roles: Role[]; localPart?: string },
): Promise<LoggedIn> {
  const user = await createUser(tenant, options);
  return login(user);
}

export function authHeader(session: LoggedIn): [string, string] {
  return ['authorization', `Bearer ${session.accessToken}`];
}

/** Pull the first token-bearing link out of a captured email (verification / reset). */
export function extractTokenFromMail(subjectMatch: RegExp): string | null {
  const message = [...sentMailbox].reverse().find((mail) => subjectMatch.test(mail.subject));
  if (!message) return null;
  const match = /token=([A-Za-z0-9_-]+)/.exec(message.text);
  return match?.[1] ?? null;
}

/** Pull the 6-digit OTP out of a captured device-verification email. */
export function extractOtpFromMail(): string | null {
  const message = [...sentMailbox].reverse().find((mail) => /verification code/i.test(mail.subject));
  if (!message) return null;
  const match = /Verification code:\s*(\d{6})/.exec(message.text);
  return match?.[1] ?? null;
}
