/**
 * Digital student ID issuance and the opaque-QR verification flow.
 *
 * The central property under test: the QR payload carries no identifying information, and the
 * code is single-use, short-lived and revocable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createPrimaryTenant,
  createStudentProfile,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
  type TestUser,
} from '../helpers/testHarness.js';

let tenant: TestTenant;
let admin: LoggedIn;
let student: TestUser;
let studentSession: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();

  admin = await createAndLogin(tenant, { roles: [Role.SYSTEM_ADMIN], localPart: 'idadmin' });
  student = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'idstudent' });
  await createStudentProfile(tenant, student, 'CS2026001');
  studentSession = await login(student);
});

async function issueCard(): Promise<void> {
  const response = await api()
    .post('/api/v1/admin/student-ids')
    .set('authorization', `Bearer ${admin.accessToken}`)
    .send({ userId: student.id });
  expect(response.status).toBe(201);
}

describe('student ID issuance', () => {
  it('lets an admin issue a card the student can then read', async () => {
    await issueCard();

    const card = await api()
      .get('/api/v1/me/student-id')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(card.status).toBe(200);
    expect(card.body.data.status).toBe('ACTIVE');
    expect(card.body.data.holder.rollNo).toBe('CS2026001');
    expect(card.body.data.cardNo).toContain('CS2026001');
  });

  it('refuses issuance for someone with no student profile', async () => {
    const staff = await createUser(tenant, { roles: [Role.FACULTY], localPart: 'notastudent' });

    const response = await api()
      .post('/api/v1/admin/student-ids')
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: staff.id });

    expect(response.status).toBe(404);
  });

  it('replaces the previous card when re-issued', async () => {
    await issueCard();
    const firstCard = await api()
      .get('/api/v1/me/student-id')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    await issueCard();
    const secondCard = await api()
      .get('/api/v1/me/student-id')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(secondCard.body.data.cardNo).not.toBe(firstCard.body.data.cardNo);
    expect(secondCard.body.data.status).toBe('ACTIVE');
  });

  it('denies a student trying to issue a card', async () => {
    const response = await api()
      .post('/api/v1/admin/student-ids')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ userId: student.id });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_DENIED');
  });

  it('returns 404 when no card has been issued', async () => {
    const response = await api()
      .get('/api/v1/me/student-id')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(404);
  });
});

describe('QR issue and verify', () => {
  it('issues an opaque code that carries no personal data', async () => {
    await issueCard();

    const response = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    const token = response.body.data.token as string;

    // Nothing identifying may be derivable from the payload itself.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('CS2026001');
    expect(token).not.toContain(student.id);
    expect(token.toLowerCase()).not.toContain('test');
    expect(response.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(new Date(response.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('lets staff verify the code and resolve the holder', async () => {
    await issueCard();
    const issued = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const guard = await createAndLogin(tenant, { roles: [Role.SECURITY_GUARD], localPart: 'guard' });

    const verified = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guard.accessToken}`)
      .send({ token: issued.body.data.token });

    expect(verified.status).toBe(200);
    expect(verified.body.data.valid).toBe(true);
    expect(verified.body.data.subject.rollNo).toBe('CS2026001');
    expect(verified.body.data.subject.userId).toBe(student.id);
  });

  it('accepts a code only once', async () => {
    await issueCard();
    const issued = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const guard = await createAndLogin(tenant, { roles: [Role.SECURITY_GUARD], localPart: 'guard2' });

    const first = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guard.accessToken}`)
      .send({ token: issued.body.data.token });
    const replay = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guard.accessToken}`)
      .send({ token: issued.body.data.token });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(404);
  });

  it('invalidates the previous code when a new one is shown', async () => {
    await issueCard();
    const older = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const newer = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const guard = await createAndLogin(tenant, { roles: [Role.SECURITY_GUARD], localPart: 'guard3' });

    const stale = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guard.accessToken}`)
      .send({ token: older.body.data.token });
    expect(stale.status).toBe(404);

    const current = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guard.accessToken}`)
      .send({ token: newer.body.data.token });
    expect(current.status).toBe(200);
  });

  it('rejects an unknown code', async () => {
    const guard = await createAndLogin(tenant, { roles: [Role.SECURITY_GUARD], localPart: 'guard4' });

    const response = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guard.accessToken}`)
      .send({ token: 'n'.repeat(43) });

    expect(response.status).toBe(404);
  });

  it('will not issue a QR for a student with no card', async () => {
    const response = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('denies a student the ability to verify codes', async () => {
    await issueCard();
    const issued = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const response = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token: issued.body.data.token });

    expect(response.status).toBe(403);
  });
});
