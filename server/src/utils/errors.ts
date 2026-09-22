/** Single application error type carrying a safe public code + message. */
import { ErrorCode } from '@campusconnect/config';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(params: {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
    expose?: boolean;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details;
    this.expose = params.expose ?? true;
  }
}

/** Common factories — keep messages generic to avoid leaking internals/enumeration. */
export const Errors = {
  authRequired: () =>
    new AppError({ statusCode: 401, code: ErrorCode.AUTH_REQUIRED, message: 'Authentication required.' }),
  authInvalid: (message = 'Invalid credentials.') =>
    new AppError({ statusCode: 401, code: ErrorCode.AUTH_INVALID, message }),
  /**
   * The caller proved knowledge of the password but the login is gated by a second factor.
   * Carries no user detail — the challenge id is the only thing that advances the flow.
   */
  mfaRequired: () =>
    new AppError({ statusCode: 401, code: ErrorCode.MFA_REQUIRED, message: 'Multi-factor authentication required.' }),
  conflict: (message = 'Resource already exists.') =>
    new AppError({ statusCode: 409, code: ErrorCode.CONFLICT, message }),
  forbidden: () =>
    new AppError({
      statusCode: 403,
      code: ErrorCode.AUTHORIZATION_DENIED,
      message: 'You are not authorized to perform this action.',
    }),
  notFound: () =>
    new AppError({ statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Resource not found.' }),
  validation: (details: unknown) =>
    new AppError({
      statusCode: 422,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed.',
      details,
    }),
  rateLimited: () =>
    new AppError({ statusCode: 429, code: ErrorCode.RATE_LIMITED, message: 'Too many requests.' }),
  internal: () =>
    new AppError({
      statusCode: 500,
      code: ErrorCode.INTERNAL,
      message: 'Something went wrong.',
      expose: false,
    }),
};
