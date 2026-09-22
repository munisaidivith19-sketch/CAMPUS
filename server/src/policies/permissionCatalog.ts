/**
 * The permission catalog: every permission key with a human description.
 *
 * This is what gets seeded into the `Permission` collection and shown in an admin UI, so each
 * description is written for a person deciding whether a role should hold it — not for a
 * developer reading code.
 *
 * The role→permission grants live in `@campusconnect/types` (`ROLE_PERMISSIONS`) so both
 * clients and server share one definition; this file only describes what each key means.
 */
import { ALL_PERMISSIONS, Permission } from '@campusconnect/types';

export const PERMISSION_DESCRIPTIONS: Readonly<Record<Permission, string>> = {
  [Permission.USER_READ_SELF]: 'View your own account details.',
  [Permission.USER_UPDATE_SELF]: 'Update your own name and contact details.',
  [Permission.SESSION_READ_SELF]: 'See the devices currently signed in to your account.',
  [Permission.SESSION_REVOKE_SELF]: 'Sign out your own devices.',
  [Permission.LOGIN_HISTORY_READ_SELF]: 'Review sign-in attempts on your own account.',
  [Permission.MFA_MANAGE_SELF]: 'Turn two-factor authentication on or off for your account.',
  [Permission.PROFILE_READ_SELF]: 'View your own student or faculty profile.',
  [Permission.PROFILE_UPDATE_SELF]: 'Update the editable parts of your own profile.',
  [Permission.STUDENT_ID_READ_SELF]: 'View your own digital student ID card.',
  [Permission.QR_ISSUE_SELF]: 'Generate a scannable code for your own student ID.',

  [Permission.USER_READ]: 'Browse the user directory for your institution.',
  [Permission.USER_UPDATE]: 'Update other users’ account details within your institution.',
  [Permission.PROFILE_READ]: 'View other users’ profiles within your institution.',
  [Permission.ROLE_READ]: 'View the roles configured for your institution.',
  [Permission.ROLE_ASSIGN]: 'Change which roles a user holds. Highly privileged.',
  [Permission.PERMISSION_READ]: 'View the permission catalog.',
  [Permission.AUDIT_READ]: 'Read the institution’s audit trail.',
  [Permission.STUDENT_ID_ISSUE]: 'Issue or re-issue digital student ID cards.',
  [Permission.STUDENT_ID_READ]: 'View student ID cards issued in your institution.',
  [Permission.QR_VERIFY]: 'Scan and verify a student ID code.',

  [Permission.ATTENDANCE_READ_SELF]: 'View your own attendance record. (Phase 3)',
  [Permission.ATTENDANCE_MARK]: 'Mark attendance for a class you teach. (Phase 3)',
  [Permission.ANNOUNCEMENT_CREATE]: 'Publish announcements. (Phase 3)',
  [Permission.GATEPASS_APPROVE]: 'Approve student gate passes. (Phase 4)',
};

/** Guard against a permission being added to the enum without a description. */
export function describePermission(key: Permission): string {
  return PERMISSION_DESCRIPTIONS[key] ?? key;
}

export const PERMISSION_CATALOG = ALL_PERMISSIONS.map((key) => ({
  key,
  description: describePermission(key),
}));
