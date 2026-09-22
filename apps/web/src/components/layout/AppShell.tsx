/**
 * The minimal authenticated shell: a top bar with the signed-in identity and sign-out, plus the
 * page outlet.
 *
 * Deliberately not a dashboard — role dashboards and the full navigation arrive in Phase 3.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { useAppDispatch } from '../../store/index.js';
import { sessionEnded } from '../../store/authSlice.js';
import { useLogoutMutation } from '../../store/authApi.js';
import { Button } from '../ui/Button.js';

export function AppShell(): JSX.Element {
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [logout, { isLoading }] = useLogoutMutation();

  const signOut = async (): Promise<void> => {
    // Even if the server call fails, the local session must not linger.
    try {
      await logout().unwrap();
    } finally {
      dispatch(sessionEnded());
      navigate('/login', { replace: true });
    }
  };

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    [
      'rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5 hover:text-white',
    ].join(' ');

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 via-neutral-950 to-neutral-900">
      <header className="glass sticky top-0 z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-bold uppercase tracking-widest text-accent-400">
              CampusConnect
            </span>
            <nav className="flex gap-1" aria-label="Main">
              <NavLink to="/" end className={linkClass}>
                Account
              </NavLink>
              <NavLink to="/security" className={linkClass}>
                Security
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-300">
              {user?.fullName}
              <span className="ml-2 rounded-full bg-brand-500/20 px-2 py-0.5 text-xs text-brand-200">
                {user?.primaryRole}
              </span>
            </span>
            <Button variant="secondary" onClick={() => void signOut()} busy={isLoading}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
