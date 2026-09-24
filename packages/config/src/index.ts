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
  /** The malware scanner could not be reached; the upload is held and is not downloadable. */
  SCAN_FAILED: 'SCAN_FAILED',
  /** The caller's own storage allowance would be exceeded. */
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
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

/**
 * Upload limits shared with clients for UX (pre-checking a file before sending it). The server
 * enforces its own configured values — MAX_UPLOAD_BYTES and UPLOAD_ALLOWED_TYPES in .env — and
 * verifies every file's real type from its bytes; nothing here is trusted on the way in.
 */
export const UPLOAD = {
  MAX_BYTES: 26_214_400, // 25 MiB
  /** The default allowlist, by extension. Anything else is refused. */
  ALLOWED_EXTENSIONS: [
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'docx',
    'xlsx',
    'pptx',
    'txt',
    'csv',
    'zip',
  ],
  CHAT_MAX_ATTACHMENTS: 5,
  ANNOUNCEMENT_MAX_ATTACHMENTS: 10,
} as const;
