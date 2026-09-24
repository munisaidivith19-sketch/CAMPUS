/**
 * The notifications inbox.
 *
 * Part A delivers the in-app channel only; push and email are Part B and are not claimed here.
 */
import { Link } from 'react-router-dom';
import {
  useGetNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from '../../store/campusApi.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';

const TYPE_TONE = {
  ANNOUNCEMENT: 'info',
  ATTENDANCE: 'warn',
  EVENT: 'good',
  CLUB: 'neutral',
  ACADEMIC: 'neutral',
  CHAT: 'info',
} as const;

export function NotificationsPage(): JSX.Element {
  const notifications = useGetNotificationsQuery();
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead, { isLoading: isClearing }] = useMarkAllNotificationsReadMutation();

  const unread = notifications.data?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'You are all caught up.'}
        action={
          unread > 0 && (
            <Button variant="secondary" busy={isClearing} onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )
        }
      />

      <SectionCard title="Inbox">
        {notifications.isLoading && <SkeletonRows rows={4} />}
        {notifications.isError && (
          <ErrorState
            message="Could not load notifications."
            onRetry={() => void notifications.refetch()}
          />
        )}
        {notifications.data?.length === 0 && (
          <EmptyState
            title="Nothing yet"
            description="Updates about your account and campus appear here."
          />
        )}

        {notifications.data && notifications.data.length > 0 && (
          <ul className="space-y-2">
            {notifications.data.map((notification) => (
              <li
                key={notification.id}
                className={`rounded-lg border px-4 py-3 ${
                  notification.read ? 'border-white/10' : 'border-brand-400/40 bg-brand-500/5'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-100">{notification.title}</p>
                    <p className="mt-0.5 text-sm text-neutral-300">{notification.body}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge tone={TYPE_TONE[notification.type]}>{notification.type}</Badge>
                    {!notification.read && (
                      <Button variant="ghost" onClick={() => void markRead(notification.id)}>
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>

                {notification.link && (
                  <Link
                    to={notification.link}
                    className="mt-2 inline-block text-xs text-brand-200 underline underline-offset-4"
                  >
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
