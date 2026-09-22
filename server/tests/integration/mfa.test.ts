/** TOTP enrollment and the MFA-gated login it produces. */
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
  type TestUser,
  type TestTenant,
} from '../helpers/testHarness.js';
import { generateTotpCode } from '../../src/services/mfa.service.js';

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();
});

/** Enroll TOTP for a freshly created user and return the confirmed secret. */
async function enrollMfa(user: TestUser): Promise<{ secret: string; accessToken: string }> {
  const session = await login(user);

  const enroll = await api()
    .post('/api/v1/me/mfa/enroll')
    .set('authorization', `Bearer ${session.accessToken}`);
  expect(enroll.status).toBe(200);

  const secret = enroll.body.data.secret as string;
  const confirm = await api()
    .post('/api/v1/me/mfa/confirm')
    .set('authorization', `Bearer ${session.accessToken}`)
    .send({ code: await generateTotpCode(secret) });
  expect(confirm.status).toBe(200);

  return { secret, accessToken: session.accessToken };
}

describe('TOTP enrollment', () => {
  it('returns a secret, an otpauth URI and a QR, then confirms with a real code', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'enroller' });
    const session = await login(user);

    const enroll = await api()
      .post('/api/v1/me/mfa/enroll')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(enroll.status).toBe(200);
    expect(enroll.body.data.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enroll.body.data.otpauthUri).toContain('otpauth://totp/');
    expect(enroll.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const confirm = await api()
      .post('/api/v1/me/mfa/confirm')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({ code: await generateTotpCode(enroll.body.data.secret as string) });

    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('MFA_ENABLED');
  });

  it('does not enable MFA when the confirmation code is wrong', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'badconfirm' });
    const session = await login(user);

    await api().post('/api/v1/me/mfa/enroll').set('authorization', `Bearer ${session.accessToken}`);
    const confirm = await api()
      .post('/api/v1/me/mfa/confirm')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({ code: '000000' });

    expect(confirm.status).toBe(401);

    // An abandoned enrollment must not lock the account behind a factor it never confirmed.
    const me = await api().get('/api/v1/me').set('authorization', `Bearer ${session.accessToken}`);
    expect(me.body.data.mfaEnabled).toBe(false);
  });

  it('never returns the stored secret again after enrollment', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'secretonce' });
    const { secret, accessToken } = await enrollMfa(user);

    const me = await api().get('/api/v1/me').set('authorization', `Bearer ${accessToken}`);
    expect(JSON.stringify(me.body)).not.toContain(secret);
  });
});

describe('MFA-gated login', () => {
  it('stops at a challenge, then completes with a valid code', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'mfalogin' });
    const { secret } = await enrollMfa(user);

    const first = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('MFA_REQUIRED');
    expect(first.body.data.challengeId).toBeTruthy();
    // No tokens are handed out before the second factor is satisfied.
    expect(first.body.data.tokens).toBeUndefined();

    const complete = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeId: first.body.data.challengeId, code: await generateTotpCode(secret) });

    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('AUTHENTICATED');
    expect(complete.body.data.tokens.accessToken).toBeTruthy();
  });

  it('rejects a wrong code', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'wrongcode' });
    await enrollMfa(user);

    const first = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    const complete = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeId: first.body.data.challengeId, code: '123456' });

    expect(complete.status).toBe(401);
  });

  it('rejects a forged challenge id', async () => {
    const response = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeId: 'x'.repeat(40), code: '123456' });

    expect(response.status).toBe(401);
  });

  it('does not accept a challenge from a different device', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'boundchallenge' });
    const { secret } = await enrollMfa(user);

    const first = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120')
      .send({ email: user.email, password: user.password });

    // Same challenge, different device fingerprint.
    const stolen = await api()
      .post('/api/v1/auth/mfa/verify')
      .set('user-agent', 'Mozilla/5.0 (X11; Linux) Firefox/121')
      .send({ challengeId: first.body.data.challengeId, code: await generateTotpCode(secret) });

    expect(stolen.status).toBe(401);
  });
});

describe('disabling MFA', () => {
  it('requires the password and then turns the factor off', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'disabler' });
    const { secret } = await enrollMfa(user);

    // Re-authenticate through the MFA gate to get a usable access token.
    const first = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    const completed = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeId: first.body.data.challengeId, code: await generateTotpCode(secret) });
    const token = completed.body.data.tokens.accessToken as string;

    const wrongPassword = await api()
      .post('/api/v1/me/mfa/disable')
      .set('authorization', `Bearer ${token}`)
      .send({ password: 'NotMyPassword#2026' });
    expect(wrongPassword.status).toBe(401);

    const disabled = await api()
      .post('/api/v1/me/mfa/disable')
      .set('authorization', `Bearer ${token}`)
      .send({ password: user.password });
    expect(disabled.status).toBe(200);

    // Login no longer stops at a challenge.
    const after = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(after.body.data.status).toBe('AUTHENTICATED');
  });
});
