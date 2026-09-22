/** "My Devices": listing sessions, revoking one, revoking the rest, and the security overview. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createPrimaryTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type TestTenant,
} from '../helpers/testHarness.js';

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();
});

describe('session listing', () => {
  it('lists every active session and marks the current one', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'devices' });
    await login(user);
    const current = await login(user);

    const response = await api()
      .get('/api/v1/me/sessions')
      .set('authorization', `Bearer ${current.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('never exposes the refresh token hash', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'nohash' });
    const session = await login(user);

    const response = await api()
      .get('/api/v1/me/sessions')
      .set('authorization', `Bearer ${session.accessToken}`);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('refreshTokenHash');
    expect(body).not.toContain(session.refreshToken);
  });

  it('shows a readable device label', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'devicelabel' });
    const loginResponse = await api()
      .post('/api/v1/auth/login')
      .set('x-client', 'mobile')
      .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0')
      .send({ email: user.email, password: user.password });

    const sessions = await api()
      .get('/api/v1/me/sessions')
      .set('authorization', `Bearer ${loginResponse.body.data.tokens.accessToken}`);

    expect(sessions.body.data[0].device).toBe('Chrome on Windows');
  });
});

describe('session revocation', () => {
  it('revokes a single session and stops it refreshing', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'revokeone' });
    const doomed = await login(user);
    const keeper = await login(user);

    const list = await api()
      .get('/api/v1/me/sessions')
      .set('authorization', `Bearer ${keeper.accessToken}`);
    const target = (list.body.data as Array<{ id: string; current: boolean }>).find((s) => !s.current);

    const revoke = await api()
      .delete(`/api/v1/me/sessions/${target?.id}`)
      .set('authorization', `Bearer ${keeper.accessToken}`);
    expect(revoke.status).toBe(200);

    const doomedRefresh = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: doomed.refreshToken });
    expect(doomedRefresh.status).toBe(401);

    // The session that did the revoking is untouched.
    const keeperRefresh = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: keeper.refreshToken });
    expect(keeperRefresh.status).toBe(200);
  });

  it('revoke-others keeps the calling session alive and kills the rest', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'revokeothers' });
    const first = await login(user);
    const second = await login(user);
    const current = await login(user);

    const response = await api()
      .post('/api/v1/me/sessions/revoke-others')
      .set('authorization', `Bearer ${current.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.revoked).toBe(2);

    for (const dead of [first, second]) {
      const refresh = await api()
        .post('/api/v1/auth/refresh')
        .set('x-client', 'mobile')
        .send({ refreshToken: dead.refreshToken });
      expect(refresh.status).toBe(401);
    }

    const alive = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: current.refreshToken });
    expect(alive.status).toBe(200);
  });

  it('returns 404 for a session id that is not the caller’s', async () => {
    const owner = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'sessowner' });
    const attacker = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'sessattacker' });

    const ownerSession = await login(owner);
    const attackerSession = await login(attacker);

    const list = await api()
      .get('/api/v1/me/sessions')
      .set('authorization', `Bearer ${ownerSession.accessToken}`);
    const victimSessionId = list.body.data[0].id as string;

    const response = await api()
      .delete(`/api/v1/me/sessions/${victimSessionId}`)
      .set('authorization', `Bearer ${attackerSession.accessToken}`);

    expect(response.status).toBe(404);

    // And the victim's session still works.
    const refresh = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: ownerSession.refreshToken });
    expect(refresh.status).toBe(200);
  });

  it('rejects a malformed session id with a validation error, not a crash', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'badid' });
    const session = await login(user);

    const response = await api()
      .delete('/api/v1/me/sessions/not-an-object-id')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('security dashboard foundation', () => {
  it('summarises sessions, recent logins and failed attempts', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'dashboard' });
    await api().post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong#2026aaaa' });
    const session = await login(user);

    const response = await api()
      .get('/api/v1/me/security')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.mfaEnabled).toBe(false);
    expect(response.body.data.activeSessions).toHaveLength(1);
    expect(response.body.data.recentLogins.length).toBeGreaterThanOrEqual(2);
    expect(response.body.data.failedAttemptsLast7Days).toBe(1);
  });
});
