/**
 * Zod validation at the boundary.
 *
 * Parsed values are written to `res.locals`, not back onto the request: `req.query` is a getter
 * in Express 4, and mutating request objects in place makes it ambiguous later whether a
 * handler is reading raw or validated input. Controllers read exclusively through the
 * `validatedBody/Query/Params` accessors, so "validated" is the only shape they ever see.
 *
 * Failures return VALIDATION_FAILED with field-level details (docs/api/API.md).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Errors } from '../utils/errors.js';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function toDetails(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) res.locals.validatedBody = schemas.body.parse(req.body);
      if (schemas.query) res.locals.validatedQuery = schemas.query.parse(req.query);
      if (schemas.params) res.locals.validatedParams = schemas.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(Errors.validation(toDetails(err)));
        return;
      }
      next(err);
    }
  };
}

export function validatedBody<T extends ZodTypeAny>(res: Response): z.infer<T> {
  return res.locals.validatedBody as z.infer<T>;
}

export function validatedQuery<T extends ZodTypeAny>(res: Response): z.infer<T> {
  return res.locals.validatedQuery as z.infer<T>;
}

export function validatedParams<T extends ZodTypeAny>(res: Response): z.infer<T> {
  return res.locals.validatedParams as z.infer<T>;
}
