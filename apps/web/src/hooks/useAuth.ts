/**
 * Convenience access to the signed-in user.
 *
 * `can()` drives UX only — hiding a button the server would refuse anyway. Never treat a true
 * result as permission to do something; the API re-checks every call (docs/architecture/
 * 04-frontend-architecture.md).
 */
import type { Permission, Role } from '@campusconnect/types';
import { useAppSelector } from '../store/index.js';

export function useAuth() {
  const { user, status } = useAppSelector((state) => state.auth);

  return {
    user,
    status,
    isAuthenticated: status === 'authenticated' && user !== null,
    isBooting: status === 'booting',
    can: (permission: Permission): boolean => user?.permissions.includes(permission) ?? false,
    hasRole: (...roles: Role[]): boolean =>
      roles.some((role) => user?.roles.includes(role)) ?? false,
  };
}
