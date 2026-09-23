/**
 * The authenticated shell: navigation, the unread-notification badge, and the page outlet.
 *
 * Navigation is filtered by permission so people are not shown doors that will not open for
 * them. That is a courtesy, not a control — the routes behind these links are guarded, and the
 * API behind those refuses regardless of what the nav rendered.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Permission } from '@campusconnect/types';
import { useAuth } from '../../hooks/useAuth.js';
import { useAppDispatch } from '../../store/index.js';
import { sessionEnded } from '../../store/authSlice.js';
import { useLogoutMutation } from '../../store/authApi.js';
import { useGetNotificationsQuery } from '../../store/campusApi.js';
import { Button } from '../ui/Button.js';

interface NavItem {
  to: string;
  label: string;
  /** When set, the link only renders for a caller holding this permission. */
  permission?: Permission;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/attendance', label: 'Attendance' },
  { to: '/attendance/mark', label: 'Mark', permission: Permission.ATTENDANCE_MARK },
  { to: '/attendance/corrections', label: 'Corrections', permission: Permission.ATTENDANCE_CORRECTION_REVIEW },
  { to: '/timetable', label: 'Timetable' },
  { to: '/announcements', label: 'Announcements' },
  { to: '/clubs', label: 'Clubs' },
  { to: '/events', label: 'Events' },
  { to: '/discussions', label: 'Discussions' },
  { to: '/chat', label: 'Chat', permission: Permission.CHAT_READ },
  { to: '/search', label: 'Search' },
];

export function AppShell(): JSX.Element {
  const { user, can } = useAuth();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [logout, { isLoading }] = useLogoutMutation();
  const notifications = useGetNotificationsQuery({ unreadOnly: true });

  const unread = notifications.data?.length ?? 0;

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

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 via-neutral-950 to-neutral-900">
      <header className="glass sticky top-0 z-10 border-b border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-sm font-bold uppercase tracking-widest text-accent-400">
              CampusConnect
            </span>

            <div className="flex items-center gap-3">
              <NavLink to="/notifications" className={linkClass}>
                Notifications
                {unread > 0 && (
                  <span
                    className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-xs text-white"
                    aria-label={`${unread} unread notifications`}
                  >
                    {unread}
                  </span>
                )}
              </NavLink>

              <NavLink to="/account" className={linkClass}>
                {user?.fullName}
              </NavLink>
              <NavLink to="/security" className={linkClass}>
                Security
              </NavLink>

              <Button variant="secondary" onClick={() => void signOut()} busy={isLoading}>
                Sign out
              </Button>
            </div>
          </div>

          <nav className="mt-3 flex flex-wrap gap-1" aria-label="Main">
            {visibleItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
