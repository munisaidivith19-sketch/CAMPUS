/**
 * Administrative identity handlers.
 *
 * Every route reaching these is gated by a tenant-wide permission, and every handler still
 * scopes its work to `principal.institutionId` — the permission grants reach *within* your own
 * institution, never across institutions.
 */
import type { NextFunction, Request, Response } from 'express';
import type {
  assignRolesSchema,
  issueStudentIdSchema,
  paginationQuerySchema,
  userIdParamSchema,
} from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import { assignRoles, listUsers } from '../services/user.service.js';
import { listAuditLog } from '../services/audit.service.js';
import { issueStudentId } from '../services/studentId.service.js';
import { roleRepository } from '../repositories/rbac.repository.js';
import { invalidateRbacCache } from '../services/rbac.service.js';

export async function getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const result = await listUsers(principal.institutionId, { page, limit });

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function putUserRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof userIdParamSchema>(res);
    const { roles, primaryRole } = validatedBody<typeof assignRolesSchema>(res);

    const updated = await assignRoles(
      principal.institutionId,
      principal.userId,
      id,
      roles,
      primaryRole,
      getRequestContext(req),
    );

    // The target's permissions change immediately rather than waiting for the cache TTL.
    invalidateRbacCache(principal.institutionId);

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function getRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const roles = await roleRepository.listForInstitution(principal.institutionId);

    sendSuccess(
      res,
      roles.map((role) => ({
        key: role.key,
        label: role.label,
        permissions: [...role.permissions],
        isSystem: role.isSystem,
      })),
    );
  } catch (err) {
    next(err);
  }
}

export async function getAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const result = await listAuditLog(principal.institutionId, { page, limit });

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function postStudentId(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { userId, validTo } = validatedBody<typeof issueStudentIdSchema>(res);

    sendSuccess(
      res,
      await issueStudentId(
        principal.institutionId,
        principal.userId,
        userId,
        validTo,
        getRequestContext(req),
      ),
      { status: 201 },
    );
  } catch (err) {
    next(err);
  }
}
