/**
 * New-device verification.
 *
 * The first login is exempt (the user just proved mailbox control at verification); a login
 * from an unrecognised device afterwards has to clear an emailed one-time code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createPrimaryTenant,
  createUser,
  disconnectTestDatabase,
  extractOtpFromMail,
  type TestTenant,
} from '../helpers/testHarness.js';
import { sentMailbox } from '../../src/services/email.service.js';

const KNOWN_DEVICE = 'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0';
const NEW_DEVICE = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0';

let tenant: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();
});

describe('new-device verification', () => {
  it('lets the first login through and remembers that device', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'firstdevice' });

    const first = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', KNOWN_DEVICE)
      .send({ email: user.email, password: user.password });
    expect(first.body.data.status).toBe('AUTHENTICATED');

    // Returning on the same device is still frictionless.
    const second = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', KNOWN_DEVICE)
      .send({ email: user.email, password: user.password });
    expect(second.body.data.status).toBe('AUTHENTICATED');
    expect(sentMailbox.filter((m) => /verification code/i.test(m.subject))).toHaveLength(0);
  });

  it('challenges an unrecognised device and completes with the emailed code', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'newdevice' });

    await api()
      .post('/api/v1/auth/login')
      .set('user-agent', KNOWN_DEVICE)
      .send({ email: user.email, password: user.password });

    const challenged = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', NEW_DEVICE)
      .send({ email: user.email, password: user.password });

    expect(challenged.body.data.status).toBe('DEVICE_VERIFICATION_REQUIRED');
    expect(challenged.body.data.tokens).toBeUndefined();

    const code = extractOtpFromMail();
    expect(code).toMatch(/^\d{6}$/);

    const completed = await api()
      .post('/api/v1/auth/device/verify')
      .set('user-agent', NEW_DEVICE)
      .send({ challengeId: challenged.body.data.challengeId, code });

    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('AUTHENTICATED');

    // The device is now trusted, so it does not get challenged again.
    const again = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', NEW_DEVICE)
      .send({ email: user.email, password: user.password });
    expect(again.body.data.status).toBe('AUTHENTICATED');
  });

  it('rejects a wrong code and does not issue tokens', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'wrongotp' });

    await api()
      .post('/api/v1/auth/login')
      .set('user-agent', KNOWN_DEVICE)
      .send({ email: user.email, password: user.password });

    const challenged = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', NEW_DEVICE)
      .send({ email: user.email, password: user.password });

    const response = await api()
      .post('/api/v1/auth/device/verify')
      .set('user-agent', NEW_DEVICE)
      .send({ challengeId: challenged.body.data.challengeId, code: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.data).toBeUndefined();
  });

  it('caps guessing at five attempts', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'otpbrute' });

    await api()
      .post('/api/v1/auth/login')
      .set('user-agent', KNOWN_DEVICE)
      .send({ email: user.email, password: user.password });

    const challenged = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', NEW_DEVICE)
      .send({ email: user.email, password: user.password });
    const challengeId = challenged.body.data.challengeId as string;
    const realCode = extractOtpFromMail();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await api()
        .post('/api/v1/auth/device/verify')
        .set('user-agent', NEW_DEVICE)
        .send({ challengeId, code: '111111' });
    }

    // Even the CORRECT code is refused once the attempt budget is gone.
    const response = await api()
      .post('/api/v1/auth/device/verify')
      .set('user-agent', NEW_DEVICE)
      .send({ challengeId, code: realCode });

    expect(response.status).toBe(429);
  });

  it('never puts the code in the HTTP response', async () => {
    const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'nocodeleak' });

    await api()
      .post('/api/v1/auth/login')
      .set('user-agent', KNOWN_DEVICE)
      .send({ email: user.email, password: user.password });

    const challenged = await api()
      .post('/api/v1/auth/login')
      .set('user-agent', NEW_DEVICE)
      .send({ email: user.email, password: user.password });

    const code = extractOtpFromMail();
    expect(code).toBeTruthy();
    expect(JSON.stringify(challenged.body)).not.toContain(code);
  });
});
