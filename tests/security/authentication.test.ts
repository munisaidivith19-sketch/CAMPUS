/**
 * Authentication and authorization enforcement on protected routes (SECURITY.md §3–4,
 * docs/deployment/TESTING.md "Key security-test assertions").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createTenant,
  disconnectTestDatabase,
  type TestTenant,
} from '../../server/tests/helpers/testHarness.js';
import { config } from '../../server/src/config/env.js';

/** Every protected surface in Phase 2, as [method, path]. */
const PROTECTED_ROUTES: Array<[string, string]> = [
  ['get', '/api/v1/me'],
  ['patch', '/api/v1/me'],
  ['get', '/api/v1/me/sessions'],
  ['post', '/api/v1/me/sessions/revoke-others'],
  ['get', '/api/v1/me/login-history'],
  ['get', '/api/v1/me/security'],
  ['get', '/api/v1/me/profile'],
  ['get', '/api/v1/me/student-id'],
  ['post', '/api/v1/me/student-id/qr'],
  ['post', '/api/v1/me/mfa/enroll'],
  ['get', '/api/v1/admin/users'],
  ['get', '/api/v1/admin/roles'],
  ['get', '/api/v1/admin/audit-logs'],
  ['post', '/api/v1/admin/student-ids'],
  ['post', '/api/v1/qr/verify'],
  ['post', '/api/v1/auth/logout'],
  ['post', '/api/v1/auth/logout-all'],
];

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
});

describe('missing credentials', () => {
  it.each(PROTECTED_ROUTES)('%s %s requires a token', async (method, path) => {
    const request = api() as unknown as Record<string, (p: string) => Promise<{ status: number; body: { error?: { code?: string } } }>>;
    const response = await request[method]!(path);

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('AUTH_REQUIRED');
  });
});

describe('invalid credentials', () => {
  const badTokens: Array<[string, string]> = [
    ['gibberish', 'not-a-jwt-at-all'],
    ['structurally valid but unsigned', 'aaa.bbb.ccc'],
    ['empty', ''],
  ];

  it.each(badTokens)('rejects a %s token', async (_label, token) => {
    const response = await api().get('/api/v1/me').set('authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret (forgery)', async () => {
    const forged = jwt.sign(
      { sub: '507f1f77bcf86cd799439011', iid: tenant.institutionId, sid: 'x', roles: [Role.SYSTEM_ADMIN], typ: 'access' },
      'an-attacker-chosen-secret-value-0000000000',
    );

    const response = await api().get('/api/v1/me').set('authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_INVALID');
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: '507f1f77bcf86cd799439011', iid: tenant.institutionId, sid: 'x', roles: [Role.STUDENT], typ: 'access' },
      config.JWT_ACCESS_SECRET,
      { expiresIn: -60 },
    );

    const response = await api().get('/api/v1/me').set('authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
  });

  it('rejects a refresh token presented as an access token', async () => {
    const session = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'swapper' });

    const response = await api()
      .get('/api/v1/me')
      .set('authorization', `Bearer ${session.refreshToken}`);

    expect(response.status).toBe(401);
  });

  it('rejects a malformed Authorization scheme', async () => {
    const session = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'scheme' });

    for (const header of [session.accessToken, `Basic ${session.accessToken}`, 'Bearer']) {
      const response = await api().get('/api/v1/me').set('authorization', header);
      expect(response.status).toBe(401);
    }
  });
});

describe('privilege escalation is not possible by editing the token payload', () => {
  it('refuses a self-minted token that claims SYSTEM_ADMIN', async () => {
    const session = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'escalator' });

    // Take the real token and swap the roles claim, without a valid signature.
    const [header, payload] = session.accessToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<string, unknown>;
    decoded.roles = [Role.SYSTEM_ADMIN];
    const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.invalidsignature`;

    const response = await api()
      .get('/api/v1/admin/users')
      .set('authorization', `Bearer ${tampered}`);

    expect(response.status).toBe(401);
  });

  it('a student is denied every administrative route', async () => {
    const student = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'plainstudent' });

    const adminRoutes: Array<[string, string]> = [
      ['get', '/api/v1/admin/users'],
      ['get', '/api/v1/admin/roles'],
      ['get', '/api/v1/admin/audit-logs'],
    ];

    for (const [method, path] of adminRoutes) {
      const request = api() as unknown as Record<string, (p: string) => { set: (k: string, v: string) => Promise<{ status: number; body: { error: { code: string } } }> }>;
      const response = await request[method]!(path).set('authorization', `Bearer ${student.accessToken}`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTHORIZATION_DENIED');
    }
  });
});

describe('error responses leak nothing', () => {
  it('never returns a stack trace or internal detail', async () => {
    const response = await api().get('/api/v1/me').set('authorization', 'Bearer nonsense');

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/at .*\(.*\.ts:/);
    expect(body).not.toContain('mongodb://');
    expect(body).not.toContain(config.JWT_ACCESS_SECRET);
    expect(response.body).toHaveProperty('requestId');
  });

  it('uses the documented failure envelope', async () => {
    const response = await api().get('/api/v1/me');

    expect(response.body.success).toBe(false);
    expect(response.body.error).toHaveProperty('code');
    expect(response.body.error).toHaveProperty('message');
    expect(response.body).toHaveProperty('requestId');
  });
});
