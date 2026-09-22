/** Role management, the user directory, and the audit trail behind them. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createPrimaryTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
} from '../helpers/testHarness.js';

let tenant: TestTenant;
let admin: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(async () => {
  await clearDatabase();
  tenant = await createPrimaryTenant();
  admin = await createAndLogin(tenant, { roles: [Role.SYSTEM_ADMIN], localPart: 'rbacadmin' });
});

describe('role catalog', () => {
  it('exposes all 14 seeded platform roles with their grants', async () => {
    const response = await api()
      .get('/api/v1/admin/roles')
      .set('authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(14);

    const student = (response.body.data as Array<{ key: string; permissions: string[] }>).find(
      (role) => role.key === Role.STUDENT,
    );
    expect(student?.permissions).toContain('user:read:self');
    expect(student?.permissions).not.toContain('role:assign');
  });
});

describe('user directory', () => {
  it('lists users in the caller’s institution, paginated, with no password material', async () => {
    await createUser(tenant, { roles: [Role.STUDENT], localPart: 'listed1' });
    await createUser(tenant, { roles: [Role.FACULTY], localPart: 'listed2' });

    const response = await api()
      .get('/api/v1/admin/users?page=1&limit=10')
      .set('authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });

  it('caps the page size no matter what the client asks for', async () => {
    const response = await api()
      .get('/api/v1/admin/users?limit=5000')
      .set('authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('role assignment', () => {
  it('changes a user’s roles and their effective permissions', async () => {
    const target = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'promoted' });

    const before = await login(target);
    const beforeMe = await api().get('/api/v1/me').set('authorization', `Bearer ${before.accessToken}`);
    expect(beforeMe.body.data.permissions).not.toContain('qr:verify');

    const assign = await api()
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ roles: [Role.FACULTY], primaryRole: Role.FACULTY });

    expect(assign.status).toBe(200);
    expect(assign.body.data.roles).toEqual([Role.FACULTY]);

    // A fresh login picks up the new grants.
    const after = await login(target);
    const afterMe = await api().get('/api/v1/me').set('authorization', `Bearer ${after.accessToken}`);
    expect(afterMe.body.data.permissions).toContain('qr:verify');
  });

  it('rejects a primaryRole that is not among the assigned roles', async () => {
    const target = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'inconsistent' });

    const response = await api()
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ roles: [Role.STUDENT], primaryRole: Role.SYSTEM_ADMIN });

    expect(response.status).toBe(422);
  });

  it('rejects a role that is not in the platform catalog', async () => {
    const target = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'fakerole' });

    const response = await api()
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ roles: ['SUPER_ROOT'], primaryRole: 'SUPER_ROOT' });

    expect(response.status).toBe(422);
  });

  it('denies a non-admin — a student cannot promote themselves', async () => {
    const student = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'selfpromoter' });

    const response = await api()
      .put(`/api/v1/admin/users/${student.user.id}/roles`)
      .set('authorization', `Bearer ${student.accessToken}`)
      .send({ roles: [Role.SYSTEM_ADMIN], primaryRole: Role.SYSTEM_ADMIN });

    expect(response.status).toBe(403);

    // And the roles really did not change.
    const me = await api().get('/api/v1/me').set('authorization', `Bearer ${student.accessToken}`);
    expect(me.body.data.roles).toEqual([Role.STUDENT]);
  });

  it('returns 404 for a user id that does not exist in this institution', async () => {
    const response = await api()
      .put('/api/v1/admin/users/507f1f77bcf86cd799439011/roles')
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ roles: [Role.STUDENT], primaryRole: Role.STUDENT });

    expect(response.status).toBe(404);
  });
});

describe('audit trail', () => {
  it('records privilege changes with the before/after roles', async () => {
    const target = await createUser(tenant, { roles: [Role.STUDENT], localPart: 'audited' });

    await api()
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ roles: [Role.HOD], primaryRole: Role.HOD });

    const audit = await api()
      .get('/api/v1/admin/audit-logs?limit=50')
      .set('authorization', `Bearer ${admin.accessToken}`);

    const entry = (audit.body.data as Array<{ action: string; reason: string | null }>).find(
      (row) => row.action === 'ROLES_CHANGED',
    );
    expect(entry).toBeTruthy();
    expect(entry?.reason).toBe('STUDENT -> HOD');
  });

  it('records logins and never stores a credential', async () => {
    const audit = await api()
      .get('/api/v1/admin/audit-logs?limit=50')
      .set('authorization', `Bearer ${admin.accessToken}`);

    const actions = (audit.body.data as Array<{ action: string }>).map((row) => row.action);
    expect(actions).toContain('LOGIN_SUCCEEDED');

    const body = JSON.stringify(audit.body);
    expect(body).not.toContain(admin.user.password);
    expect(body).not.toContain('$argon2');
    expect(body).not.toContain(admin.refreshToken);
  });

  it('denies audit access to a student', async () => {
    const student = await createAndLogin(tenant, { roles: [Role.STUDENT], localPart: 'nosnooping' });

    const response = await api()
      .get('/api/v1/admin/audit-logs')
      .set('authorization', `Bearer ${student.accessToken}`);

    expect(response.status).toBe(403);
  });

  it('is append-only: the model refuses updates and deletes', async () => {
    const { AuditLogModel } = await import('../../src/models/AuditLog.model.js');

    await expect(AuditLogModel.updateOne({}, { $set: { reason: 'tampered' } }).exec()).rejects.toThrow(
      /append-only/i,
    );
    await expect(AuditLogModel.deleteMany({}).exec()).rejects.toThrow(/append-only/i);
  });
});
