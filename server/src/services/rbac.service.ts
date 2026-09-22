/**
 * Role → permission resolution.
 *
 * RBAC is stored as data, but reading it on every single request would put a join on the hot
 * path, so the resolved map is cached per institution in memory with a short TTL and an
 * explicit invalidation hook. `invalidate()` is called whenever a role's grants change, so an
 * administrative change takes effect immediately rather than waiting for the TTL.
 *
 * A cache miss FAILS CLOSED: if the roles cannot be read, the principal gets no permissions
 * rather than inheriting a stale or default-open set.
 */
import type { Permission, Role } from '@campusconnect/types';
import { roleRepository } from '../repositories/rbac.repository.js';
import { logger } from '../utils/logger.js';

interface CacheEntry {
  map: Map<Role, Permission[]>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

async function loadRoleMap(institutionId: string): Promise<Map<Role, Permission[]>> {
  const roles = await roleRepository.listForInstitution(institutionId);
  const map = new Map<Role, Permission[]>();
  for (const role of roles) map.set(role.key, [...role.permissions]);
  return map;
}

async function getRoleMap(institutionId: string): Promise<Map<Role, Permission[]>> {
  const cached = cache.get(institutionId);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const map = await loadRoleMap(institutionId);
  cache.set(institutionId, { map, expiresAt: Date.now() + CACHE_TTL_MS });
  return map;
}

/**
 * Resolve the effective permissions for a set of roles, within one institution.
 * Unknown roles contribute nothing (fail closed) rather than being treated as wildcards.
 */
export async function resolvePermissions(
  institutionId: string,
  roles: readonly Role[],
): Promise<Permission[]> {
  try {
    const map = await getRoleMap(institutionId);
    const out = new Set<Permission>();
    for (const role of roles) {
      for (const permission of map.get(role) ?? []) out.add(permission);
    }
    return [...out];
  } catch (err) {
    // Fail closed: an RBAC read failure must never widen access.
    logger.error({ err, institutionId }, 'RBAC resolution failed — denying all permissions');
    return [];
  }
}

/** Drop the cached map for an institution (call after any role/permission change). */
export function invalidateRbacCache(institutionId?: string): void {
  if (institutionId) cache.delete(institutionId);
  else cache.clear();
}
