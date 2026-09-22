/**
 * Pure authorization decisions — the single implementation of the pipeline described in
 * docs/security/SECURITY.md §4:
 *
 *     identity → role → permission → tenant → resource ownership → business rule
 *
 * Every step FAILS CLOSED: anything missing, empty, or ambiguous is a denial. Keeping this
 * pure (no Express, no database) is what lets the authorization rules be unit-tested directly
 * and reused unchanged by the Socket.IO layer in a later phase.
 */
import type { Permission } from '@campusconnect/types';
import type { Principal, PolicyDecision, ResourceRef } from './index.js';

/** Machine-readable denial reasons. The HTTP layer maps these to codes/status. */
export const DenyReason = {
  NO_PRINCIPAL: 'NO_PRINCIPAL',
  NO_POLICY: 'NO_POLICY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  NOT_RESOURCE_OWNER: 'NOT_RESOURCE_OWNER',
  CONDITION_FAILED: 'CONDITION_FAILED',
} as const;
export type DenyReason = (typeof DenyReason)[keyof typeof DenyReason];

export const allow = (): PolicyDecision => ({ allow: true });
export const deny = (reason: DenyReason): PolicyDecision => ({ allow: false, reason });

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return principal.permissions.includes(permission);
}

export function hasAnyPermission(principal: Principal, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => principal.permissions.includes(p));
}

export interface AuthorizationRequest {
  principal: Principal | undefined;
  /** Holding ANY of these permissions satisfies the role/permission step. Empty = deny. */
  anyOf: readonly Permission[];
  /** The resource being acted on. Omitted for collection-level actions with no single target. */
  resource?: ResourceRef;
  /**
   * When true the principal must own `resource` (BOLA/IDOR defense). Used by `*:self`
   * permissions, where holding the permission only grants access to your own records.
   */
  requireOwnership?: boolean;
  /** Extra ABAC business rule (e.g. faculty ↔ assigned class). Must return true to allow. */
  condition?: (principal: Principal, resource?: ResourceRef) => boolean;
}

export function authorize(request: AuthorizationRequest): PolicyDecision {
  const { principal, anyOf, resource, requireOwnership, condition } = request;

  // 1. identity
  if (!principal) return deny(DenyReason.NO_PRINCIPAL);

  // 2 + 3. role → permission (roles are resolved into permissions at authentication time)
  if (anyOf.length === 0) return deny(DenyReason.NO_POLICY);
  if (!hasAnyPermission(principal, anyOf)) return deny(DenyReason.PERMISSION_DENIED);

  // 4. tenant — checked BEFORE resource permission so cross-tenant access never gets further.
  if (resource && resource.institutionId !== principal.institutionId) {
    return deny(DenyReason.TENANT_MISMATCH);
  }

  // 5. resource ownership
  if (requireOwnership) {
    if (!resource?.ownerUserId) return deny(DenyReason.NOT_RESOURCE_OWNER);
    if (resource.ownerUserId !== principal.userId) return deny(DenyReason.NOT_RESOURCE_OWNER);
  }

  // 6. business rule
  if (condition && !condition(principal, resource)) return deny(DenyReason.CONDITION_FAILED);

  return allow();
}
