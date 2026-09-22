/**
 * Authentication + tenant resolution.
 *
 * `authenticate` verifies the access token and builds the `Principal`. Permissions are NOT read
 * from the token — they are resolved from the RBAC data for the roles the token carries, so
 * changing what a role may do takes effect without waiting for tokens to expire.
 *
 * `resolveTenant` binds the tenant from that principal and actively discards any tenant the
 * client tried to supply. Per docs/architecture/06-multi-tenancy.md the tenant may only ever
 * come from the authenticated identity.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Principal } from '@campusconnect/security';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { verifyAccessToken } from '../services/token.service.js';
import { resolvePermissions } from '../services/rbac.service.js';

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    next(Errors.authRequired());
    return;
  }

  const claims = verifyAccessToken(token);
  if (!claims) {
    next(Errors.authInvalid('Your session is no longer valid. Sign in again.'));
    return;
  }

  void resolvePermissions(claims.iid, claims.roles)
    .then((permissions) => {
      const principal: Principal = {
        userId: claims.sub,
        institutionId: claims.iid,
        roles: claims.roles,
        permissions,
        sessionId: claims.sid,
      };
      req.principal = principal;
      next();
    })
    .catch((err: unknown) => {
      // Fail closed: if permissions cannot be resolved, the request is not authorized.
      logger.error({ err }, 'Failed to resolve principal permissions');
      next(Errors.forbidden());
    });
}

export function resolveTenant(req: Request, _res: Response, next: NextFunction): void {
  const principal = req.principal;
  if (!principal) {
    next(Errors.authRequired());
    return;
  }

  // Defense in depth: a client may not nominate its own tenant, in any form.
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object' && 'institutionId' in body) {
    delete body.institutionId;
    logger.warn({ path: req.path }, 'Ignored client-supplied institutionId in body');
  }
  if (req.header('x-institution-id')) {
    logger.warn({ path: req.path }, 'Ignored client-supplied x-institution-id header');
  }

  req.tenantId = principal.institutionId;
  next();
}

/** Convenience accessor for handlers that run after `authenticate`. */
export function requirePrincipal(req: Request): Principal {
  const principal = req.principal;
  if (!principal) throw Errors.authRequired();
  return principal;
}
