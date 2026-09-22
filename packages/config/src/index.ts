/** Shared, framework-agnostic constants used by server and clients. */

/** Stable machine-readable error codes (mirror docs/api/API.md). */
export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  MFA_REQUIRED: 'MFA_REQUIRED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  MALWARE_DETECTED: 'MALWARE_DETECTED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** API surface constants. */
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

/** Pagination defaults and caps (enforced server-side). */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Upload limits (bytes). Mirror MAX_UPLOAD_BYTES in .env.example. */
export const UPLOAD = {
  MAX_BYTES: 26_214_400, // 25 MiB
  ALLOWED_DOC_MIME: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
  ],
  ALLOWED_IMAGE_MIME: ['image/png', 'image/jpeg', 'image/webp'],
} as const;
