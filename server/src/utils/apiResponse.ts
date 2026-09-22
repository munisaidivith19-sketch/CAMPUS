/** Helpers to build the consistent response envelope (see docs/api/API.md). */
import type { Response } from 'express';
import type { ApiSuccess, Pagination } from '@campusconnect/types';

export function sendSuccess<T>(
  res: Response,
  data: T,
  opts?: { status?: number; pagination?: Pagination },
): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    requestId: res.locals.requestId ?? 'unknown',
    ...(opts?.pagination ? { pagination: opts.pagination } : {}),
  };
  res.status(opts?.status ?? 200).json(body);
}
