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

/**
 * Turn an access token into a principal, or throw.
 *
 * This is the ONE place a token becomes an identity. The socket handshake calls it too, so
 * there is no second implementation of "who is this?" to drift — a socket and a request agree
 * on the caller by construction. Permissions are resolved from the RBAC data here as well, so
 * a role change takes effect on the next connection without waiting for tokens to expire.
 */
export async function principalFromAccessToken(token: string): Promise<Principal> {
  const claims = verifyAccessToken(token);
  if (!claims) throw Errors.authInvalid('Your session is no longer valid. Sign in again.');

  try {
    const permissions = await resolvePermissions(claims.iid, claims.roles);
    return {
      userId: claims.sub,
      institutionId: claims.iid,
      roles: claims.roles,
      permissions,
      sessionId: claims.sid,
    };
  } catch (err) {
    // Fail closed: if permissions cannot be resolved, the caller is not authorized.
    logger.error({ err }, 'Failed to resolve principal permissions');
    throw Errors.forbidden();
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    next(Errors.authRequired());
    return;
  }

  void principalFromAccessToken(token)
    .then((principal) => {
      req.principal = principal;
      next();
    })
    .catch((err: unknown) => {
      next(err);
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
