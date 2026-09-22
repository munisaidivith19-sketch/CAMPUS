/** Central error handler: converts anything thrown into the consistent failure envelope. */
import type { NextFunction, Request, Response } from 'express';
import { ErrorCode } from '@campusconnect/config';
import type { ApiFailure } from '@campusconnect/types';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Recognise the errors body-parser throws before any route runs. Without this they would fall
 * through to the generic 500 branch, which is both wrong (the client's request was refused, not
 * broken on our side) and unhelpful — the API contract already defines PAYLOAD_TOO_LARGE for
 * exactly this case.
 */
function fromBodyParser(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null || !('type' in err)) return null;
  const candidate = err as { type?: string };

  if (candidate.type === 'entity.too.large') {
    return new AppError({
      statusCode: 413,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: 'Request body is too large.',
    });
  }

  if (candidate.type === 'entity.parse.failed') {
    return new AppError({
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Request body is not valid JSON.',
    });
  }

  if (candidate.type === 'encoding.unsupported' || candidate.type === 'charset.unsupported') {
    return new AppError({
      statusCode: 415,
      code: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      message: 'Unsupported content encoding.',
    });
  }

  return null;
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const requestId = (res.locals.requestId as string) ?? 'unknown';
  const normalized = err instanceof AppError ? err : (fromBodyParser(err) ?? err);

  if (normalized instanceof AppError) {
    const appError = normalized;
    if (!appError.expose) logger.error({ err, requestId }, 'Unexposed AppError');
    const body: ApiFailure = {
      success: false,
      error: {
        code: appError.code,
        message: appError.expose ? appError.message : 'Something went wrong.',
        ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
      },
      requestId,
    };
    res.status(appError.statusCode).json(body);
    return;
  }

  // Unknown error: log full context, return generic message (no stack/secrets to client).
  logger.error({ err, requestId }, 'Unhandled error');
  const body: ApiFailure = {
    success: false,
    error: { code: ErrorCode.INTERNAL, message: 'Something went wrong.' },
    requestId,
  };
  res.status(500).json(body);
}

/** 404 fallthrough for unmatched routes. */
export function notFoundMiddleware(_req: Request, res: Response): void {
  const requestId = (res.locals.requestId as string) ?? 'unknown';
  const body: ApiFailure = {
    success: false,
    error: { code: ErrorCode.NOT_FOUND, message: 'Resource not found.' },
    requestId,
  };
  res.status(404).json(body);
}
