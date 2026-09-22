/**
 * Authorization middleware — the HTTP adapter around the pure policy function.
 *
 * The decision itself lives in `@campusconnect/security`'s `authorize()`; this file only maps a
 * request to a policy question and a denial to an HTTP response. Keeping it that way means the
 * rules are unit-testable without Express and can be reused unchanged by the realtime layer.
 *
 * The mapping of denial → response is a security decision in itself:
 *  - **TENANT_MISMATCH → 404.** A caller must not be able to learn that a resource exists in
 *    another institution, so cross-tenant denial is indistinguishable from "no such thing".
 *  - Everything else → 403, because within your own tenant a refusal is honest and actionable.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Permission } from '@campusconnect/types';
import { DenyReason, authorize as decide, type ResourceRef } from '@campusconnect/security';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { requirePrincipal } from './auth.middleware.js';

export interface AuthorizeOptions {
  /** Holding ANY of these permissions passes the permission step. */
  anyOf: readonly Permission[];
  /**
   * Loads the resource under test. Returning null means "not found", which is reported as 404
   * before any permission detail is revealed.
   */
  resource?: (req: Request) => Promise<ResourceRef | null> | ResourceRef | null;
  /** Require the principal to own the resource (used with `*:self` permissions). */
  requireOwnership?: boolean;
}

export function authorize(options: AuthorizeOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const principal = requirePrincipal(req);

        const resource = options.resource ? await options.resource(req) : undefined;
        if (options.resource && !resource) {
          next(Errors.notFound());
          return;
        }

        const decision = decide({
          principal,
          anyOf: options.anyOf,
          resource: resource ?? undefined,
          requireOwnership: options.requireOwnership,
        });

        if (decision.allow) {
          next();
          return;
        }

        logger.warn(
          { reason: decision.reason, path: req.path, userId: principal.userId },
          'Authorization denied',
        );

        next(decision.reason === DenyReason.TENANT_MISMATCH ? Errors.notFound() : Errors.forbidden());
      } catch (err) {
        next(err);
      }
    })();
  };
}

/**
 * Shorthand for "acting on your own account": the resource is the caller themselves, so the
 * tenant and ownership checks are satisfied by construction and the permission is what decides.
 */
export function authorizeSelf(anyOf: readonly Permission[]): RequestHandler {
  return authorize({
    anyOf,
    requireOwnership: true,
    resource: (req) => {
      const principal = requirePrincipal(req);
      return {
        type: 'Self',
        institutionId: principal.institutionId,
        ownerUserId: principal.userId,
        id: principal.userId,
      };
    },
  });
}
