/** Attach a request id to res.locals for correlation across logs and the response envelope. */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : `req_${randomUUID()}`;
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
