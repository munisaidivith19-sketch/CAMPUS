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

  [Permission.SUBJECT_READ]: 'Browse the subject catalog.',
  [Permission.CLASS_READ]: 'View classes and their rosters within your scope.',
  [Permission.CLASS_MANAGE]: 'Create classes and assign teaching faculty.',
  [Permission.TIMETABLE_READ]: 'View timetables within your scope.',
  [Permission.ATTENDANCE_READ_SELF]: 'View your own attendance record.',
  [Permission.ATTENDANCE_MARK]: 'Mark attendance for a class you teach.',
  [Permission.ATTENDANCE_READ_SCOPE]:
    'View attendance beyond your own — limited to your classes, section, department or college.',
  [Permission.ATTENDANCE_CORRECTION_REQUEST]:
    'Ask for one of your own attendance records to be corrected.',
  [Permission.ATTENDANCE_CORRECTION_REVIEW]: 'Approve or reject attendance correction requests.',

  [Permission.ANNOUNCEMENT_READ]: 'Read announcements addressed to you.',
  [Permission.ANNOUNCEMENT_CREATE]: 'Publish announcements to a scope you are authorized for.',
  [Permission.CLUB_READ]: 'Browse clubs and their profiles.',
  [Permission.CLUB_JOIN]: 'Request to join a club.',
  [Permission.CLUB_MANAGE]: 'Administer a club: approve members, publish its events.',
  [Permission.EVENT_READ]: 'Browse campus events.',
  [Permission.EVENT_CREATE]: 'Create events for a club or department you are authorized for.',
  [Permission.EVENT_REGISTER]: 'Register yourself for an event.',
  [Permission.EVENT_CHECKIN]: 'Scan and check attendees in at an event.',
  [Permission.DISCUSSION_READ]: 'Read discussion threads.',
  [Permission.DISCUSSION_CREATE]: 'Start a discussion thread.',
  [Permission.COMMENT_CREATE]: 'Comment on discussions.',
  [Permission.REPORT_CREATE]: 'Report content for moderator review.',
  [Permission.MODERATION_REVIEW]: 'Review reported content and remove it. Highly privileged.',
  [Permission.NOTIFICATION_READ_SELF]: 'Read your own notifications.',
  [Permission.SEARCH_QUERY]: 'Search across announcements, discussions, events and clubs.',

  [Permission.CHAT_READ]: 'Use chat and read the conversations you are a member of.',
  [Permission.CHAT_CREATE]: 'Start a direct message or create a group chat.',
  [Permission.CHAT_MESSAGE_SEND]: 'Send messages in chats you belong to.',
  [Permission.CHAT_MANAGE]: 'Administer a group chat you own: add or remove its members.',
  [Permission.CHAT_MODERATE]:
    'Remove someone else’s chat message, within the classes or clubs you moderate. Highly privileged.',

  [Permission.FILE_UPLOAD]:
    'Upload files of your own to attach to messages and posts. Who can then open a file is decided by what it is attached to.',
  [Permission.FILE_READ]: 'Open files attached to things you are allowed to see.',

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
