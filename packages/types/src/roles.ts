/** The 14 platform roles. Kept as a const object + union type for safe reuse. */
export const Role = {
  STUDENT: 'STUDENT',
  FACULTY: 'FACULTY',
  CLASS_MENTOR: 'CLASS_MENTOR',
  HOD: 'HOD',
  PRINCIPAL: 'PRINCIPAL',
  CLUB_ADMIN: 'CLUB_ADMIN',
  HOSTEL_WARDEN: 'HOSTEL_WARDEN',
  MESS_INCHARGE: 'MESS_INCHARGE',
  SECURITY_GUARD: 'SECURITY_GUARD',
  PLACEMENT_OFFICER: 'PLACEMENT_OFFICER',
  MEDICAL_STAFF: 'MEDICAL_STAFF',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  COMPANY_RECRUITER: 'COMPANY_RECRUITER',
  ALUMNI: 'ALUMNI',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES: readonly Role[] = Object.values(Role);

/**
 * Permission keys follow `<resource>:<action>[:<scope>]`.
 *
 * Phase 2 finalizes the identity/security slice of the catalog. The later-phase anchors at the
 * bottom were fixed in Phase 1 and are kept so seeded role→permission data stays stable as
 * those features land; they are seeded now but only enforced by the phase that ships them.
 */
export const Permission = {
  // --- Self-service identity (Phase 2) ---------------------------------------
  USER_READ_SELF: 'user:read:self',
  USER_UPDATE_SELF: 'user:update:self',
  SESSION_READ_SELF: 'session:read:self',
  SESSION_REVOKE_SELF: 'session:revoke:self',
  LOGIN_HISTORY_READ_SELF: 'loginhistory:read:self',
  MFA_MANAGE_SELF: 'mfa:manage:self',
  PROFILE_READ_SELF: 'profile:read:self',
  PROFILE_UPDATE_SELF: 'profile:update:self',
  STUDENT_ID_READ_SELF: 'studentid:read:self',
  QR_ISSUE_SELF: 'qr:issue:self',

  // --- Tenant-wide identity administration (Phase 2) -------------------------
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  PROFILE_READ: 'profile:read',
  ROLE_READ: 'role:read',
  ROLE_ASSIGN: 'role:assign',
  PERMISSION_READ: 'permission:read',
  AUDIT_READ: 'audit:read',
  STUDENT_ID_ISSUE: 'studentid:issue',
  STUDENT_ID_READ: 'studentid:read',
  QR_VERIFY: 'qr:verify',

  // --- Later-phase anchors (seeded now, enforced by the phase that ships them)
  ATTENDANCE_READ_SELF: 'attendance:read:self',
  ATTENDANCE_MARK: 'attendance:mark',
  ANNOUNCEMENT_CREATE: 'announcement:create',
  GATEPASS_APPROVE: 'gatepass:approve',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);
