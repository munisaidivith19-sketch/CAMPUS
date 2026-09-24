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

  // --- Academics (Phase 3) ---------------------------------------------------
  SUBJECT_READ: 'subject:read',
  CLASS_READ: 'class:read',
  CLASS_MANAGE: 'class:manage',
  TIMETABLE_READ: 'timetable:read',
  ATTENDANCE_READ_SELF: 'attendance:read:self',
  ATTENDANCE_MARK: 'attendance:mark',
  /**
   * Read attendance beyond your own. Holding it does NOT mean "read everyone": the service
   * narrows every query to the caller's academic scope (own classes / section / department /
   * college). The permission opens the door; the scope decides the room.
   */
  ATTENDANCE_READ_SCOPE: 'attendance:read:scope',
  ATTENDANCE_CORRECTION_REQUEST: 'attendance:correction:request',
  ATTENDANCE_CORRECTION_REVIEW: 'attendance:correction:review',

  // --- Community (Phase 3 Part A) --------------------------------------------
  ANNOUNCEMENT_READ: 'announcement:read',
  ANNOUNCEMENT_CREATE: 'announcement:create',
  CLUB_READ: 'club:read',
  CLUB_JOIN: 'club:join',
  CLUB_MANAGE: 'club:manage',
  EVENT_READ: 'event:read',
  EVENT_CREATE: 'event:create',
  EVENT_REGISTER: 'event:register',
  EVENT_CHECKIN: 'event:checkin',
  DISCUSSION_READ: 'discussion:read',
  DISCUSSION_CREATE: 'discussion:create',
  COMMENT_CREATE: 'comment:create',
  REPORT_CREATE: 'report:create',
  MODERATION_REVIEW: 'moderation:review',
  NOTIFICATION_READ_SELF: 'notification:read:self',
  SEARCH_QUERY: 'search:query',

  // --- Chat (Phase 3 Part C-2) -----------------------------------------------
  /**
   * These open the door; membership decides the room. Holding `chat:read` lets you use chat at
   * all — it never grants sight of a conversation you are not a member of.
   */
  CHAT_READ: 'chat:read',
  CHAT_CREATE: 'chat:create',
  CHAT_MESSAGE_SEND: 'chat:message:send',
  CHAT_MANAGE: 'chat:manage',
  CHAT_MODERATE: 'chat:moderate',

  // --- Files (Phase 3 Part C-3) ----------------------------------------------
  /**
   * Upload a file of your own. It stays private to you until you attach it to something; who
   * may then read it is decided by the thing it is attached to, never by this permission.
   */
  FILE_UPLOAD: 'file:upload',
  /** Use the download endpoints at all. Access to a given file is still decided per file. */
  FILE_READ: 'file:read',

  // --- Later-phase anchors (seeded now, enforced by the phase that ships them)
  GATEPASS_APPROVE: 'gatepass:approve',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);
