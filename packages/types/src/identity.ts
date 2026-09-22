/**
 * Identity & security contracts (Phase 2).
 *
 * Enums here are the single source of truth shared by the Mongoose models, the API layer, and
 * both clients. DTOs describe exactly what the API returns — note that no DTO ever carries a
 * password hash, MFA secret, reset token, or refresh token value.
 */
import type { Permission, Role } from './roles.js';

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const LoginResult = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;
export type LoginResult = (typeof LoginResult)[keyof typeof LoginResult];

/** Why a login attempt did not produce a session. Stored for the user's own login history. */
export const LoginFailureReason = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_FAILED: 'MFA_FAILED',
  DEVICE_VERIFICATION_REQUIRED: 'DEVICE_VERIFICATION_REQUIRED',
  DEVICE_VERIFICATION_FAILED: 'DEVICE_VERIFICATION_FAILED',
} as const;
export type LoginFailureReason = (typeof LoginFailureReason)[keyof typeof LoginFailureReason];

export const MfaType = {
  TOTP: 'TOTP',
  OTP: 'OTP',
  WEBAUTHN: 'WEBAUTHN',
} as const;
export type MfaType = (typeof MfaType)[keyof typeof MfaType];

/** Append-only audit actions. Extended by later phases; never renamed (history must stay readable). */
export const AuditAction = {
  USER_REGISTERED: 'USER_REGISTERED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  REFRESH_REUSE_DETECTED: 'REFRESH_REUSE_DETECTED',
  LOGGED_OUT: 'LOGGED_OUT',
  SESSION_REVOKED: 'SESSION_REVOKED',
  ALL_SESSIONS_REVOKED: 'ALL_SESSIONS_REVOKED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  MFA_ENROLLED: 'MFA_ENROLLED',
  MFA_DISABLED: 'MFA_DISABLED',
  DEVICE_VERIFIED: 'DEVICE_VERIFIED',
  ROLES_CHANGED: 'ROLES_CHANGED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  STUDENT_ID_ISSUED: 'STUDENT_ID_ISSUED',
  STUDENT_ID_REVOKED: 'STUDENT_ID_REVOKED',
  QR_TOKEN_ISSUED: 'QR_TOKEN_ISSUED',
  QR_TOKEN_VERIFIED: 'QR_TOKEN_VERIFIED',
  QR_TOKEN_REJECTED: 'QR_TOKEN_REJECTED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResult = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  DENIED: 'DENIED',
} as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];

export const QRPurpose = {
  STUDENT_ID: 'STUDENT_ID',
  GATE_PASS: 'GATE_PASS',
  EVENT_CHECKIN: 'EVENT_CHECKIN',
} as const;
export type QRPurpose = (typeof QRPurpose)[keyof typeof QRPurpose];

export const StudentIdStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type StudentIdStatus = (typeof StudentIdStatus)[keyof typeof StudentIdStatus];

// --- DTOs --------------------------------------------------------------------

export interface UserDTO {
  id: string;
  institutionId: string;
  email: string;
  fullName: string;
  status: UserStatus;
  roles: Role[];
  primaryRole: Role;
  /** Derived server-side from roles at request time. Clients use it for UX gating ONLY. */
  permissions: Permission[];
  mfaEnabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionDTO {
  id: string;
  device: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  /** True for the session that issued the access token making this request. */
  current: boolean;
}

export interface LoginHistoryDTO {
  id: string;
  ip: string;
  device: string;
  result: LoginResult;
  reason: LoginFailureReason | null;
  at: string;
}

export interface AuthTokensDTO {
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  /**
   * Only returned to clients that cannot use cookies (mobile). Web receives the refresh token
   * as an httpOnly/SameSite cookie and never sees its value in JS.
   */
  refreshToken?: string;
}

/** Login is a state machine: it either authenticates or returns the challenge that gates it. */
export type LoginResponseDTO =
  | { status: 'AUTHENTICATED'; user: UserDTO; tokens: AuthTokensDTO }
  | { status: 'MFA_REQUIRED'; challengeId: string; methods: MfaType[] }
  | { status: 'DEVICE_VERIFICATION_REQUIRED'; challengeId: string };

export interface StudentProfileDTO {
  id: string;
  userId: string;
  rollNo: string;
  departmentId: string | null;
  batch: string | null;
  year: number | null;
  section: string | null;
}

export interface FacultyProfileDTO {
  id: string;
  userId: string;
  departmentId: string | null;
  designation: string | null;
  subjectsTaught: string[];
}

export interface StudentIdDTO {
  id: string;
  cardNo: string;
  status: StudentIdStatus;
  validFrom: string;
  validTo: string;
  holder: { userId: string; fullName: string; rollNo: string };
}

/** The QR payload is an opaque token id — never PII (SECURITY.md §10). */
export interface QRIssueDTO {
  token: string;
  purpose: QRPurpose;
  expiresAt: string;
  /** PNG data URL rendered server-side for convenience; encodes only the opaque token. */
  qrDataUrl: string;
}

export interface QRVerifyDTO {
  valid: true;
  purpose: QRPurpose;
  subject: { userId: string; fullName: string; rollNo: string | null; primaryRole: Role };
  verifiedAt: string;
}

export interface MfaEnrollDTO {
  /** Base32 secret shown once at enrollment so the user can add it manually. */
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}
