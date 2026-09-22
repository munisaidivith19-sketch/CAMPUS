/**
 * The core authentication journey end to end: register → verify → login → refresh → logout,
 * plus the failure paths that matter most (unverified account, wrong password, refresh reuse).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, UserStatus } from '@campusconnect/types';
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
import { userRepository } from '../../src/repositories/user.repository.js';

const PASSWORD = 'Registrant#2026aa';

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();
});

describe('registration', () => {
  it('accepts a valid institution address and emails a verification link', async () => {
    const email = `newbie@${tenant.domain}`;

    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'New Bie' });

    expect(response.status).toBe(202);
    expect(response.body.data.status).toBe('VERIFICATION_SENT');
    expect(sentMailbox.at(-1)?.to).toBe(email);
    expect(extractTokenFromMail(/verify/i)).toBeTruthy();
  });

  it('rejects an address outside the institution domain (backend-enforced)', async () => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'someone@gmail.com', password: PASSWORD, fullName: 'Outsider' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('enforces the password policy', async () => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email: `weak@${tenant.domain}`, password: 'short', fullName: 'Weak Pass' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('answers identically for an address that already exists (no account enumeration)', async () => {
    const existing = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'taken' });

    const first = await api()
      .post('/api/v1/auth/register')
      .send({ email: `fresh@${tenant.domain}`, password: PASSWORD, fullName: 'Fresh One' });
    const second = await api()
      .post('/api/v1/auth/register')
      .send({ email: existing.email, password: PASSWORD, fullName: 'Impostor' });

    expect(second.status).toBe(first.status);
    expect(second.body.data).toEqual(first.body.data);
  });

  it('does not overwrite an existing account’s password', async () => {
    const existing = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'victim' });

    await api()
      .post('/api/v1/auth/register')
      .send({ email: existing.email, password: 'Attacker#2026aa', fullName: 'Attacker' });

    // The original password still works; the attacker's does not.
    await expect(login(existing)).resolves.toBeTruthy();
    const attempt = await api()
      .post('/api/v1/auth/login')
      .send({ email: existing.email, password: 'Attacker#2026aa' });
    expect(attempt.status).toBe(401);
  });
});

describe('email verification', () => {
  it('activates the account and lets the user sign in', async () => {
    const email = `verifyme@${tenant.domain}`;
    await api().post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Verify Me' });

    const token = extractTokenFromMail(/verify/i);
    expect(token).toBeTruthy();

    const verify = await api().post('/api/v1/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe('VERIFIED');

    const signIn = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.body.data.status).toBe('AUTHENTICATED');
  });

  it('refuses an unverified account at login', async () => {
    const email = `unverified@${tenant.domain}`;
    await api().post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Not Yet' });

    const response = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/verify/i);
  });

  it('rejects a bogus or reused verification token', async () => {
    const email = `once@${tenant.domain}`;
    await api().post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Once Only' });
    const token = extractTokenFromMail(/verify/i);

    await api().post('/api/v1/auth/verify-email').send({ token });
    const replay = await api().post('/api/v1/auth/verify-email').send({ token });
    expect(replay.status).toBe(401);

    const bogus = await api()
      .post('/api/v1/auth/verify-email')
      .send({ token: 'a'.repeat(43) });
    expect(bogus.status).toBe(401);
  });
});

describe('login', () => {
  it('returns the user plus an access token, and never a password hash', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'loginok' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(user.email);
    expect(response.body.data.tokens.accessToken).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('sets an httpOnly refresh cookie for browser clients and withholds it from the body', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'cookieclient' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookies.find((c) => c.startsWith('cc_refresh='));
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=Lax/i);
    // The browser gets the token only as a cookie it cannot read from JavaScript.
    expect(response.body.data.tokens.refreshToken).toBeUndefined();
  });

  it('returns the refresh token in the body for native clients', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'nativeclient' });

    const response = await api()
      .post('/api/v1/auth/login')
      .set('x-client', 'mobile')
      .send({ email: user.email, password: user.password });

    expect(response.body.data.tokens.refreshToken).toBeTruthy();
  });

  it('gives the same generic error for a wrong password and an unknown address', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'generic' });

    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword#2026' });
    const unknownUser = await api()
      .post('/api/v1/auth/login')
      .send({ email: `ghost@${tenant.domain}`, password: 'WrongPassword#2026' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error).toEqual(wrongPassword.body.error);
  });

  it('records both successful and failed attempts in login history', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'history' });
    await api().post('/api/v1/auth/login').send({ email: user.email, password: 'Nope#2026aaaa' });
    const session = await login(user);

    const history = await api()
      .get('/api/v1/me/login-history')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(history.status).toBe(200);
    const results = (history.body.data as Array<{ result: string }>).map((e) => e.result);
    expect(results).toContain('SUCCESS');
    expect(results).toContain('FAILURE');
    // The attempted password must never appear in the record.
    expect(JSON.stringify(history.body)).not.toContain('Nope#2026aaaa');
  });

  it('refuses a suspended account', async () => {
    const user = await createUser(tenant, {
      roles: [Role.STUDENT],
      localPart: 'suspended',
      status: UserStatus.SUSPENDED,
    });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/not active/i);
  });
});

describe('refresh rotation', () => {
  it('issues a new refresh token and invalidates the old one', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'rotate' });
    const session = await login(user);

    const first = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: session.refreshToken });

    expect(first.status).toBe(200);
    const rotated = first.body.data.tokens.refreshToken as string;
    expect(rotated).not.toBe(session.refreshToken);

    // The rotated-away token must no longer work.
    const replay = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
  });

  it('revokes the whole session chain when a retired token is replayed (reuse detection)', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'reuse' });
    const session = await login(user);

    const first = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: session.refreshToken });
    const current = first.body.data.tokens.refreshToken as string;

    // Attacker replays the stolen (already rotated) token.
    const replay = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);

    // The legitimate client's current token is now dead too — the chain was revoked.
    const legitimate = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: current });
    expect(legitimate.status).toBe(401);
  });

  it('refuses to renew for a user who is no longer active', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'deactivated' });
    const session = await login(user);

    await userRepository.markEmailVerified(tenant.institutionId, user.id, UserStatus.SUSPENDED);

    const response = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: session.refreshToken });

    expect(response.status).toBe(401);
  });

  it('rejects a refresh with no token at all', async () => {
    const response = await api().post('/api/v1/auth/refresh').send({});
    expect(response.status).toBe(401);
  });
});

describe('logout', () => {
  it('revokes the current session so its refresh token stops working', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'logout' });
    const session = await login(user);

    const out = await api()
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${session.accessToken}`);
    expect(out.status).toBe(200);

    const refresh = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('logout-all revokes every session for the user', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'logoutall' });
    const first = await login(user);
    const second = await login(user);

    const out = await api()
      .post('/api/v1/auth/logout-all')
      .set('authorization', `Bearer ${second.accessToken}`);
    expect(out.status).toBe(200);

    for (const session of [first, second]) {
      const refresh = await api()
        .post('/api/v1/auth/refresh')
        .set('x-client', 'mobile')
        .send({ refreshToken: session.refreshToken });
      expect(refresh.status).toBe(401);
    }
  });
});
