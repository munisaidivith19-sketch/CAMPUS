/** Forgot-password → emailed token → reset, including the enumeration and replay defences. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createPrimaryTenant,
  createUser,
  disconnectTestDatabase,
  extractTokenFromMail,
  login,
  type TestTenant,
} from '../helpers/testHarness.js';
import { sentMailbox } from '../../src/services/email.service.js';

const NEW_PASSWORD = 'Rotated#2026abc';

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();
});

async function requestReset(email: string): Promise<string | null> {
  await api().post('/api/v1/auth/forgot-password').send({ email });
  return extractTokenFromMail(/reset/i);
}

describe('forgot password', () => {
  it('answers the same way for a registered and an unregistered address', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'known' });

    const known = await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody@${tenant.domain}` });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body.data).toEqual(known.body.data);
  });

  it('emails a reset link only to an address that actually exists', async () => {
    await api().post('/api/v1/auth/forgot-password').send({ email: `ghost@${tenant.domain}` });
    expect(sentMailbox).toHaveLength(0);

    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'real' });
    await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    expect(sentMailbox.at(-1)?.to).toBe(user.email);
  });

  it('stops issuing tokens once a user has asked repeatedly in a short window', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'spammer' });

    for (let i = 0; i < 4; i += 1) {
      await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    }

    // Three tokens issued, the fourth request throttled — while still answering identically.
    const resetMails = sentMailbox.filter((m) => /reset/i.test(m.subject));
    expect(resetMails).toHaveLength(3);
  });
});

describe('reset password', () => {
  it('changes the password, invalidates the token, and revokes existing sessions', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'resetme' });
    const existingSession = await login(user);

    const token = await requestReset(user.email);
    expect(token).toBeTruthy();

    const reset = await api().post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    // New password works, old one does not.
    const withNew = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(withNew.status).toBe(200);

    const withOld = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(withOld.status).toBe(401);

    // The session that existed before the reset is gone.
    const refresh = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: existingSession.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('sends a security notification after the password changes', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'notified' });
    const token = await requestReset(user.email);

    await api().post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD });

    const notice = sentMailbox.find((m) => /password was changed/i.test(m.subject));
    expect(notice?.to).toBe(user.email);
  });

  it('is single use', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'singleuse' });
    const token = await requestReset(user.email);

    await api().post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD });
    const replay = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Another#2026abc' });

    expect(replay.status).toBe(401);
  });

  it('invalidates other outstanding tokens for the same user', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'multitoken' });
    const first = await requestReset(user.email);
    sentMailbox.length = 0;
    const second = await requestReset(user.email);

    await api().post('/api/v1/auth/reset-password').send({ token: second, password: NEW_PASSWORD });

    const staleToken = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: first, password: 'Yetanother#2026a' });
    expect(staleToken.status).toBe(401);
  });

  it('rejects a forged token', async () => {
    const response = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: 'z'.repeat(43), password: NEW_PASSWORD });

    expect(response.status).toBe(401);
  });

  it('refuses to set the same password again (reuse control)', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'reuser' });
    const token = await requestReset(user.email);

    const response = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: user.password });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('still enforces the password policy on the new password', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'weaknew' });
    const token = await requestReset(user.email);

    const response = await api().post('/api/v1/auth/reset-password').send({ token, password: 'abc' });
    expect(response.status).toBe(422);
  });

  it('never puts the reset token in the response body', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'notleaked' });
    const response = await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

    const token = extractTokenFromMail(/reset/i);
    expect(token).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain(token);
  });
});
