/**
 * The announcements feed.
 *
 * Only announcements addressed to the reader ever arrive here — the server evaluates the
 * audience from who they are, so there is nothing to filter client-side.
 */
import { useState } from 'react';
import { Permission, type AnnouncementDTO } from '@campusconnect/types';
import { useGetAnnouncementsQuery } from '../../store/campusApi.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';

const PRIORITY_TONE = {
  URGENT: 'bad',
  HIGH: 'warn',
  NORMAL: 'neutral',
  LOW: 'neutral',
} as const;

function AnnouncementCard({ announcement }: { announcement: AnnouncementDTO }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-neutral-100">
            {announcement.title}
            {!announcement.read && (
              <span className="ml-2 align-middle">
                <Badge tone="info">New</Badge>
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {announcement.author.fullName} · {new Date(announcement.publishAt).toLocaleString()} ·{' '}
            {announcement.target.scope.toLowerCase()}
          </p>
        </div>
        <Badge tone={PRIORITY_TONE[announcement.priority]}>{announcement.priority}</Badge>
      </div>

      <p className={`mt-3 whitespace-pre-line text-sm text-neutral-300 ${expanded ? '' : 'line-clamp-2'}`}>
        {announcement.body}
      </p>

      <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Show less' : 'Read more'}
      </Button>
    </li>
  );
}

export function AnnouncementsPage(): JSX.Element {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const announcements = useGetAnnouncementsQuery({ unreadOnly });
  const { can } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        subtitle="Notices addressed to you."
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/5"
              />
              Unread only
            </label>
            {/* UX only — the server re-checks who may publish to which audience. */}
            {can(Permission.ANNOUNCEMENT_CREATE) && <Badge tone="info">You can publish</Badge>}
          </div>
        }
      />

      <SectionCard title={unreadOnly ? 'Unread' : 'All announcements'}>
        {announcements.isLoading && <SkeletonRows rows={3} />}
        {announcements.isError && (
          <ErrorState message="Could not load announcements." onRetry={() => void announcements.refetch()} />
        )}
        {announcements.data?.length === 0 && (
          <EmptyState
            title={unreadOnly ? 'Nothing unread' : 'No announcements yet'}
            description="Notices addressed to your section, department or college appear here."
          />
        )}

        {announcements.data && announcements.data.length > 0 && (
          <ul className="space-y-3">
            {announcements.data.map((announcement) => (
              <AnnouncementCard key={announcement.id} announcement={announcement} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
