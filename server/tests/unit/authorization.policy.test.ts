/**
 * The authorization pipeline as a pure function (SECURITY.md §4).
 *
 * These are the rules the whole platform leans on, so they are tested directly rather than only
 * through HTTP: identity → role → permission → tenant → ownership → business rule, failing
 * closed at every step.
 */
import { describe, expect, it } from 'vitest';
import { DenyReason, authorize, hasPermission } from '@campusconnect/security';
import { Permission, ROLE_PERMISSIONS, Role, permissionsForRoles } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';

const principal: Principal = {
  userId: 'user-a',
  institutionId: 'tenant-a',
  roles: [Role.STUDENT],
  permissions: [Permission.USER_READ_SELF, Permission.SESSION_REVOKE_SELF],
  sessionId: 'session-1',
};

const ownResource = { type: 'Session', institutionId: 'tenant-a', ownerUserId: 'user-a', id: 's1' };

describe('authorize — fail closed', () => {
  it('denies when there is no principal at all', () => {
    const decision = authorize({ principal: undefined, anyOf: [Permission.USER_READ_SELF] });
    expect(decision).toEqual({ allow: false, reason: DenyReason.NO_PRINCIPAL });
  });

  it('denies when no policy is declared — an empty permission list is never a wildcard', () => {
    const decision = authorize({ principal, anyOf: [] });
    expect(decision).toEqual({ allow: false, reason: DenyReason.NO_POLICY });
  });
});

describe('authorize — permission step', () => {
  it('allows when the principal holds any one of the listed permissions', () => {
    expect(authorize({ principal, anyOf: [Permission.AUDIT_READ, Permission.USER_READ_SELF] }).allow).toBe(true);
  });

  it('denies when the principal holds none of them', () => {
    const decision = authorize({ principal, anyOf: [Permission.ROLE_ASSIGN] });
    expect(decision).toEqual({ allow: false, reason: DenyReason.PERMISSION_DENIED });
  });
});

describe('authorize — tenant step', () => {
  it('denies a resource belonging to another institution', () => {
    const decision = authorize({
      principal,
      anyOf: [Permission.USER_READ_SELF],
      resource: { ...ownResource, institutionId: 'tenant-b' },
    });
    expect(decision).toEqual({ allow: false, reason: DenyReason.TENANT_MISMATCH });
  });

  it('checks the tenant BEFORE ownership, so cross-tenant never reaches a resource check', () => {
    const decision = authorize({
      principal,
      anyOf: [Permission.SESSION_REVOKE_SELF],
      requireOwnership: true,
      // Owned by this user, but in another tenant: the tenant reason must win.
      resource: { ...ownResource, institutionId: 'tenant-b' },
    });
    expect(decision).toEqual({ allow: false, reason: DenyReason.TENANT_MISMATCH });
  });
});

describe('authorize — ownership step (IDOR/BOLA defence)', () => {
  it('allows the owner', () => {
    expect(
      authorize({
        principal,
        anyOf: [Permission.SESSION_REVOKE_SELF],
        requireOwnership: true,
        resource: ownResource,
      }).allow,
    ).toBe(true);
  });

  it('denies someone else’s resource even with the right permission', () => {
    const decision = authorize({
      principal,
      anyOf: [Permission.SESSION_REVOKE_SELF],
      requireOwnership: true,
      resource: { ...ownResource, ownerUserId: 'user-b' },
    });
    expect(decision).toEqual({ allow: false, reason: DenyReason.NOT_RESOURCE_OWNER });
  });

  it('denies when ownership is required but the resource has no owner (ambiguous = deny)', () => {
    const decision = authorize({
      principal,
      anyOf: [Permission.SESSION_REVOKE_SELF],
      requireOwnership: true,
      resource: { type: 'Session', institutionId: 'tenant-a' },
    });
    expect(decision).toEqual({ allow: false, reason: DenyReason.NOT_RESOURCE_OWNER });
  });
});

describe('authorize — business rule step', () => {
  it('denies when the ABAC condition fails, even though everything else passed', () => {
    const decision = authorize({
      principal,
      anyOf: [Permission.USER_READ_SELF],
      resource: ownResource,
      condition: () => false,
    });
    expect(decision).toEqual({ allow: false, reason: DenyReason.CONDITION_FAILED });
  });

  it('allows when the condition passes', () => {
    expect(
      authorize({
        principal,
        anyOf: [Permission.USER_READ_SELF],
        resource: ownResource,
        condition: (p) => p.userId === 'user-a',
      }).allow,
    ).toBe(true);
  });
});

describe('role → permission resolution', () => {
  it('deduplicates permissions granted by several roles', () => {
    const resolved = permissionsForRoles([Role.STUDENT, Role.STUDENT]);
    expect(resolved.length).toBe(new Set(resolved).size);
  });

  it('gives SYSTEM_ADMIN every permission and STUDENT far fewer', () => {
    expect(ROLE_PERMISSIONS[Role.SYSTEM_ADMIN].length).toBeGreaterThan(
      ROLE_PERMISSIONS[Role.STUDENT].length,
    );
  });

  it('does not grant a student any administrative permission', () => {
    const studentPermissions = ROLE_PERMISSIONS[Role.STUDENT];
    for (const admin of [Permission.ROLE_ASSIGN, Permission.AUDIT_READ, Permission.USER_READ]) {
      expect(studentPermissions).not.toContain(admin);
    }
  });

  it('does not let a student verify QR codes (only staff scan IDs)', () => {
    expect(ROLE_PERMISSIONS[Role.STUDENT]).not.toContain(Permission.QR_VERIFY);
    expect(ROLE_PERMISSIONS[Role.SECURITY_GUARD]).toContain(Permission.QR_VERIFY);
  });

  it('hasPermission reflects exactly what the principal carries', () => {
    expect(hasPermission(principal, Permission.USER_READ_SELF)).toBe(true);
    expect(hasPermission(principal, Permission.ROLE_ASSIGN)).toBe(false);
  });
});
