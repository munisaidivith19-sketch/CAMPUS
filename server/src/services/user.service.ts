/**
 * User-facing identity operations: reading your own account, updating it, listing users, and
 * administrative role assignment.
 *
 * `toUserDTO` is the ONLY way a user reaches the API surface. It resolves permissions from the
 * RBAC data at call time and constructs the response field by field, so a schema addition can
 * never accidentally publish a new field (and `passwordHash` is `select: false` besides).
 */
import type { Role, UserDTO } from '@campusconnect/types';
import { AuditAction, AuditResult } from '@campusconnect/types';
import type { UserDocument } from '../models/User.model.js';
import { userRepository } from '../repositories/user.repository.js';
import type { IdLike, Page, PageRequest } from '../repositories/base.repository.js';
import { resolvePermissions } from './rbac.service.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { Errors } from '../utils/errors.js';
import { realtime } from './realtimeBus.js';

export async function toUserDTO(user: UserDocument): Promise<UserDTO> {
  const institutionId = String(user.institutionId);
  const permissions = await resolvePermissions(institutionId, user.roles);

  return {
    id: String(user._id),
    institutionId,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    roles: [...user.roles],
    primaryRole: user.primaryRole,
    permissions,
    mfaEnabled: user.mfaEnabled,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function getUserById(institutionId: IdLike, userId: IdLike): Promise<UserDocument> {
  const user = await userRepository.findById(institutionId, userId);
  // A user outside the caller's tenant is simply absent — never "forbidden" (no existence leak).
  if (!user) throw Errors.notFound();
  return user;
}

export async function updateOwnProfile(
  institutionId: IdLike,
  userId: IdLike,
  fields: { fullName?: string; phone?: string },
  context: AuditContext,
): Promise<UserDTO> {
  const updated = await userRepository.updateBasicFields(institutionId, userId, fields);
  if (!updated) throw Errors.notFound();

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.PROFILE_UPDATED,
    resourceType: 'User',
    resourceId: String(userId),
    result: AuditResult.SUCCESS,
    context,
  });

  return toUserDTO(updated);
}

export async function listUsers(
  institutionId: IdLike,
  page: PageRequest,
  filters: { role?: Role } = {},
): Promise<{ items: UserDTO[]; total: number }> {
  const result: Page<UserDocument> = await userRepository.listUsers(institutionId, page, filters);
  const items = await Promise.all(result.items.map((user) => toUserDTO(user)));
  return { items, total: result.total };
}

/**
 * Assign roles (SYSTEM_ADMIN only — enforced by the route's authorize middleware).
 *
 * Always audited, including the before/after role sets, because privilege change is exactly the
 * kind of action an investigation needs to reconstruct.
 */
export async function assignRoles(
  institutionId: IdLike,
  actorUserId: IdLike,
  targetUserId: IdLike,
  roles: Role[],
  primaryRole: Role,
  context: AuditContext,
): Promise<UserDTO> {
  const target = await userRepository.findById(institutionId, targetUserId);
  if (!target) throw Errors.notFound();

  const previousRoles = [...target.roles];
  const updated = await userRepository.setRoles(institutionId, targetUserId, roles, primaryRole);
  if (!updated) throw Errors.notFound();

  // A socket resolved its permissions when it connected, so a role change has to close it:
  // otherwise a demoted user keeps the reach of their old role until they happen to reconnect.
  realtime.disconnectUser(String(institutionId), String(targetUserId), 'ROLES_CHANGED');

  await recordAudit({
    institutionId,
    actorUserId,
    action: AuditAction.ROLES_CHANGED,
    resourceType: 'User',
    resourceId: String(targetUserId),
    result: AuditResult.SUCCESS,
    context,
    reason: `${previousRoles.join(',') || 'none'} -> ${roles.join(',')}`,
  });

  return toUserDTO(updated);
}
