/**
 * NoSQL-injection defence and rate limiting (SECURITY.md §5 threats/controls).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type TestTenant,
} from '../../server/tests/helpers/testHarness.js';

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
});

describe('NoSQL injection', () => {
  it('an operator object in place of an email does not authenticate anyone', async () => {
    await createUser(tenant, { roles: [Role.STUDENT], localPart: 'injectiontarget' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });

    // Stripped at the edge, then rejected by Zod — never executed as a query.
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a $regex payload cannot be used to fish for accounts', async () => {
    await createUser(tenant, { roles: [Role.STUDENT], localPart: 'regextarget' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $regex: '.*' }, password: 'anything' });

    expect(response.status).toBe(422);
  });

  it('strips $-prefixed and dotted keys from an otherwise valid body', async () => {
    const session = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'stripme' });

    const response = await api()
      .patch('/api/v1/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        fullName: 'Legit Name',
        $set: { roles: [Role.SYSTEM_ADMIN] },
        'roles.0': Role.SYSTEM_ADMIN,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.fullName).toBe('Legit Name');
    // The smuggled operators changed nothing.
    expect(response.body.data.roles).toEqual([Role.STUDENT]);
  });

  it('ignores operator keys in the query string', async () => {
    const session = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'queryinject' });

    const response = await api()
      .get('/api/v1/me/login-history?page=1&limit=5&$where=1')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
  });

  it('refuses to be mass-assigned into another role via the profile endpoint', async () => {
    const session = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'massassign' });

    await api()
      .patch('/api/v1/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({ fullName: 'Still A Student', roles: [Role.SYSTEM_ADMIN], primaryRole: Role.SYSTEM_ADMIN, status: 'ACTIVE' });

    const me = await api().get('/api/v1/me').set('authorization', `Bearer ${session.accessToken}`);
    expect(me.body.data.roles).toEqual([Role.STUDENT]);
    expect(me.body.data.permissions).not.toContain('role:assign');
  });
});

describe('rate limiting', () => {
  it('locks out repeated login attempts from the same client', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'bruteforce' });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: `WrongGuess#${attempt}aa` });
      statuses.push(response.status);
    }

    // The limiter must bite before the twelfth guess.
    expect(statuses).toContain(429);
    const limited = statuses.indexOf(429);
    expect(limited).toBeLessThanOrEqual(10);
  });

  it('answers a rate-limited request with the documented envelope', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'envelope' });

    let limited: { status: number; body: { error: { code: string } } } | null = null;
    for (let attempt = 0; attempt < 15 && !limited; attempt += 1) {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: `Nope#${attempt}aaaa` });
      if (response.status === 429) limited = response;
    }

    expect(limited?.body.error.code).toBe('RATE_LIMITED');
  });

  it('throttles password-reset requests', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'resetflood' });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });

  it('locks an account after sustained password guessing, even once the IP limit resets', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'lockout' });
    const { resetRateLimiters } = await import('../../server/src/middleware/rateLimit.middleware.js');

    // Ten wrong guesses, resetting the IP limiter so the ACCOUNT lockout is what we observe.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      resetRateLimiters();
      await api().post('/api/v1/auth/login').send({ email: user.email, password: `Bad#${attempt}aaaaa` });
    }
    resetRateLimiters();

    // The correct password is now refused because the account itself is locked.
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(401);
    await expect(login(user)).rejects.toThrow();
  });
});

describe('payload limits', () => {
  it('rejects an oversized body rather than parsing it', async () => {
    const response = await api()
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(2 * 1024 * 1024) }));

    expect([400, 413]).toContain(response.status);
  });
});
