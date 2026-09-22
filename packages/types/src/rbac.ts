/**
 * The role → permission catalog.
 *
 * RBAC is stored as DATA (Role/Permission collections) so roles can change without a deploy;
 * this map is the seed/baseline for that data and the contract clients use for UX-only gating.
 * The server always re-derives a principal's permissions from the database at authentication
 * time — a client must never be trusted to assert what it may do.
 */
import { ALL_PERMISSIONS, Permission, Role } from './roles.js';

/** Everything a signed-in human may do for their own account, regardless of role. */
const SELF_SERVICE: readonly Permission[] = [
  Permission.USER_READ_SELF,
  Permission.USER_UPDATE_SELF,
  Permission.SESSION_READ_SELF,
  Permission.SESSION_REVOKE_SELF,
  Permission.LOGIN_HISTORY_READ_SELF,
  Permission.MFA_MANAGE_SELF,
  Permission.PROFILE_READ_SELF,
  Permission.PROFILE_UPDATE_SELF,
];

const STAFF_BASE: readonly Permission[] = [...SELF_SERVICE, Permission.USER_READ, Permission.PROFILE_READ];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [Role.STUDENT]: [
    ...SELF_SERVICE,
    Permission.STUDENT_ID_READ_SELF,
    Permission.QR_ISSUE_SELF,
    Permission.ATTENDANCE_READ_SELF,
  ],
  [Role.FACULTY]: [...STAFF_BASE, Permission.QR_VERIFY, Permission.ATTENDANCE_MARK, Permission.ANNOUNCEMENT_CREATE],
  [Role.CLASS_MENTOR]: [
    ...STAFF_BASE,
    Permission.QR_VERIFY,
    Permission.ATTENDANCE_MARK,
    Permission.ANNOUNCEMENT_CREATE,
    Permission.GATEPASS_APPROVE,
    Permission.STUDENT_ID_READ,
  ],
  [Role.HOD]: [
    ...STAFF_BASE,
    Permission.QR_VERIFY,
    Permission.ANNOUNCEMENT_CREATE,
    Permission.GATEPASS_APPROVE,
    Permission.STUDENT_ID_READ,
  ],
  [Role.PRINCIPAL]: [
    ...STAFF_BASE,
    Permission.ANNOUNCEMENT_CREATE,
    Permission.GATEPASS_APPROVE,
    Permission.STUDENT_ID_READ,
    Permission.AUDIT_READ,
    Permission.ROLE_READ,
  ],
  [Role.CLUB_ADMIN]: [...SELF_SERVICE, Permission.ANNOUNCEMENT_CREATE],
  [Role.HOSTEL_WARDEN]: [...STAFF_BASE, Permission.GATEPASS_APPROVE, Permission.QR_VERIFY],
  [Role.MESS_INCHARGE]: [...SELF_SERVICE],
  [Role.SECURITY_GUARD]: [...SELF_SERVICE, Permission.QR_VERIFY, Permission.STUDENT_ID_READ],
  [Role.PLACEMENT_OFFICER]: [...STAFF_BASE],
  [Role.MEDICAL_STAFF]: [...STAFF_BASE],
  [Role.SYSTEM_ADMIN]: [...ALL_PERMISSIONS],
  [Role.COMPANY_RECRUITER]: [...SELF_SERVICE],
  [Role.ALUMNI]: [...SELF_SERVICE],
};

/** Resolve the union of permissions granted by a set of roles (deduplicated, stable order). */
export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const out = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) out.add(permission);
  }
  return [...out];
}
