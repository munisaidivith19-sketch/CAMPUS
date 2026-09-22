/**
 * Tenant isolation (ADR-0005, docs/architecture/06-multi-tenancy.md).
 *
 * The contract these suites enforce: a caller from institution A asking about institution B's
 * data gets **NOT_FOUND**, never FORBIDDEN. A 403 would confirm the resource exists, which is
 * itself a cross-tenant leak; 404 says only "not here".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createStudentProfile,
  createTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
  type TestUser,
} from '../../server/tests/helpers/testHarness.js';

let tenantA: TestTenant;
let tenantB: TestTenant;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenantA = await createTenant('alpha-university.test');
  tenantB = await createTenant('beta-institute.test');
});

describe('cross-tenant reads', () => {
  it('a user directory only ever contains the caller’s own institution', async () => {
    const adminA = await createAndLogin(tenantA, { roles: [Role.SYSTEM_ADMIN], localPart: 'admina' });
    await createUser(tenantB, { roles: [Role.STUDENT], localPart: 'secretstudent' });

    const response = await api()
      .get('/api/v1/admin/users?limit=100')
      .set('authorization', `Bearer ${adminA.accessToken}`);

    expect(response.status).toBe(200);
    const emails = (response.body.data as Array<{ email: string }>).map((u) => u.email);
    expect(emails.every((email) => email.endsWith(tenantA.domain))).toBe(true);
    expect(emails.some((email) => email.includes('secretstudent'))).toBe(false);
  });

  it('the audit log of one institution is invisible to another', async () => {
    const adminA = await createAndLogin(tenantA, { roles: [Role.SYSTEM_ADMIN], localPart: 'audita' });
    const userB = await createUser(tenantB, { roles: [Role.STUDENT], localPart: 'loggedinb' });
    await login(userB);

    const response = await api()
      .get('/api/v1/admin/audit-logs?limit=100')
      .set('authorization', `Bearer ${adminA.accessToken}`);

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(userB.id);
  });
});

describe('cross-tenant writes return NOT_FOUND, never FORBIDDEN', () => {
  it('an admin cannot change roles for a user in another institution', async () => {
    const adminA = await createAndLogin(tenantA, { roles: [Role.SYSTEM_ADMIN], localPart: 'rolesa' });
    const victimB = await createUser(tenantB, { roles: [Role.STUDENT], localPart: 'victimb' });

    const response = await api()
      .put(`/api/v1/admin/users/${victimB.id}/roles`)
      .set('authorization', `Bearer ${adminA.accessToken}`)
      .send({ roles: [Role.SYSTEM_ADMIN], primaryRole: Role.SYSTEM_ADMIN });

    // 404 — the existence of that user must not be confirmed.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');

    // The victim's roles are untouched.
    const victimSession = await login(victimB);
    const me = await api().get('/api/v1/me').set('authorization', `Bearer ${victimSession.accessToken}`);
    expect(me.body.data.roles).toEqual([Role.STUDENT]);
  });

  it('an admin cannot issue a student ID for another institution’s student', async () => {
    const adminA = await createAndLogin(tenantA, { roles: [Role.SYSTEM_ADMIN], localPart: 'issuera' });
    const studentB = await createUser(tenantB, { roles: [Role.STUDENT], localPart: 'studentb' });
    await createStudentProfile(tenantB, studentB, 'BETA0001');

    const response = await api()
      .post('/api/v1/admin/student-ids')
      .set('authorization', `Bearer ${adminA.accessToken}`)
      .send({ userId: studentB.id });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('a user cannot revoke a session belonging to another institution', async () => {
    const userA = await createAndLogin(tenantA, { roles: [Role.STUDENT], localPart: 'sessiona' });
    const userB = await createUser(tenantB, { roles: [Role.STUDENT], localPart: 'sessionb' });
    const sessionB = await login(userB);

    const listB = await api()
      .get('/api/v1/me/sessions')
      .set('authorization', `Bearer ${sessionB.accessToken}`);
    const targetId = listB.body.data[0].id as string;

    const response = await api()
      .delete(`/api/v1/me/sessions/${targetId}`)
      .set('authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);

    // B's session is still alive.
    const refresh = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: sessionB.refreshToken });
    expect(refresh.status).toBe(200);
  });
});

describe('cross-tenant QR scanning', () => {
  it('a guard cannot resolve another institution’s student code', async () => {
    // Student in B with an issued card and a live QR.
    const adminB = await createAndLogin(tenantB, { roles: [Role.SYSTEM_ADMIN], localPart: 'adminb' });
    const studentB: TestUser = await createUser(tenantB, { roles: [Role.STUDENT], localPart: 'qrstudentb' });
    await createStudentProfile(tenantB, studentB, 'BETA0002');
    await api()
      .post('/api/v1/admin/student-ids')
      .set('authorization', `Bearer ${adminB.accessToken}`)
      .send({ userId: studentB.id });

    const studentSessionB = await login(studentB);
    const issued = await api()
      .post('/api/v1/me/student-id/qr')
      .set('authorization', `Bearer ${studentSessionB.accessToken}`);
    const token = issued.body.data.token as string;

    // Guard in A scans it.
    const guardA: LoggedIn = await createAndLogin(tenantA, {
      roles: [Role.SECURITY_GUARD],
      localPart: 'guarda',
    });
    const response = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guardA.accessToken}`)
      .send({ token });

    expect(response.status).toBe(404);
    // Nothing about the holder may appear in the rejection.
    expect(JSON.stringify(response.body)).not.toContain('BETA0002');
    expect(JSON.stringify(response.body)).not.toContain(studentB.id);

    // And the code is still usable inside its own institution — it was not consumed.
    const guardB = await createAndLogin(tenantB, { roles: [Role.SECURITY_GUARD], localPart: 'guardb' });
    const ownTenant = await api()
      .post('/api/v1/qr/verify')
      .set('authorization', `Bearer ${guardB.accessToken}`)
      .send({ token });
    expect(ownTenant.status).toBe(200);
  });
});

describe('tenant binding cannot be influenced by the client', () => {
  it('ignores an institutionId supplied in the body', async () => {
    const userA = await createAndLogin(tenantA, { roles: [Role.STUDENT], localPart: 'bodyspoof' });

    const response = await api()
      .patch('/api/v1/me')
      .set('authorization', `Bearer ${userA.accessToken}`)
      .send({ fullName: 'Renamed Person', institutionId: tenantB.institutionId });

    expect(response.status).toBe(200);
    // Still in tenant A, whatever the body claimed.
    expect(response.body.data.institutionId).toBe(tenantA.institutionId);
  });

  it('ignores an x-institution-id header', async () => {
    const userA = await createAndLogin(tenantA, { roles: [Role.STUDENT], localPart: 'headerspoof' });

    const response = await api()
      .get('/api/v1/me')
      .set('authorization', `Bearer ${userA.accessToken}`)
      .set('x-institution-id', tenantB.institutionId);

    expect(response.status).toBe(200);
    expect(response.body.data.institutionId).toBe(tenantA.institutionId);
  });
});
