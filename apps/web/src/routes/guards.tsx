/**
 * Route guards.
 *
 * **These are UX only.** They decide what to render, not what is permitted: hiding a route
 * prevents a confusing dead end, it does not protect anything. Every request the guarded pages
 * make is independently authenticated and authorized server-side, and a user who edits the
 * Redux store to walk past a guard will simply meet 401/403 from the API
 * (docs/architecture/04-frontend-architecture.md, SECURITY.md §1).
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission, Role } from '@campusconnect/types';
import { useAuth } from '../hooks/useAuth.js';
import { Spinner } from '../components/ui/Feedback.js';

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, isBooting } = useAuth();
  const location = useLocation();

  // Wait for the silent refresh to finish before deciding — otherwise a reload would bounce a
  // signed-in user to the login screen.
  if (isBooting) return <Spinner label="Restoring your session…" />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}): JSX.Element {
  const { isAuthenticated, isBooting, hasRole } = useAuth();

  if (isBooting) return <Spinner label="Restoring your session…" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasRole(...roles)) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/**
 * Hide a route the caller has no permission for.
 *
 * Same caveat as the others: this prevents a confusing dead end, it does not protect the data.
 * The endpoints behind the page re-check the same permission and answer 403 regardless.
 */
export function RequirePermission({
  permission,
  children,
}: {
  /** One permission, or several of which any one is enough. */
  permission: Permission | readonly Permission[];
  children: ReactNode;
}): JSX.Element {
  const { isAuthenticated, isBooting, can } = useAuth();
  const required: readonly Permission[] = Array.isArray(permission)
    ? permission
    : [permission as Permission];

  if (isBooting) return <Spinner label="Restoring your session…" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!required.some((item) => can(item))) return <Navigate to="/" replace />;

  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, isBooting } = useAuth();

  if (isBooting) return <Spinner label="Loading…" />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}
