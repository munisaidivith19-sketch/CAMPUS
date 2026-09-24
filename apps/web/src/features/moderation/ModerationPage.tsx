/**
 * The moderation queue.
 *
 * Everything shown here was chosen by the server for this moderator's scope: a mentor sees their
 * section's class chats, a club admin their club, the principal everything. The page never
 * filters for security — it only renders.
 *
 * Previews are plain text rendered by React (no `dangerouslySetInnerHTML`). Private
 * conversations appear as recorded-but-not-actionable, with no content, and the page says why.
 * Reporter names appear only when the server included them (audit:read holders).
 */
import { useState } from 'react';
import type { ModerationActionDTO, ModerationQueueItemDTO } from '@campusconnect/types';
import {
  useDecideReportMutation,
  useGetModerationHistoryQuery,
  useGetModerationReportsQuery,
} from '../../store/campusApi.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { TextArea } from '../../components/ui/Field.js';

const TARGET_LABEL: Record<string, string> = {
  DISCUSSION: 'Discussion',
  COMMENT: 'Comment',
  CHAT_MESSAGE: 'Chat message',
};

const CONTEXT_LABEL: Record<string, string> = {
  COMMUNITY: 'Community',
  CLASS: 'Class chat',
  CLUB: 'Club chat',
  DIRECT: 'Direct message',
  GROUP: 'Private group',
};

function QueueItem({ item }: { item: ModerationQueueItemDTO }): JSX.Element {
  const [decide, { isLoading }] = useDecideReportMutation();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const act = async (action: 'REMOVE' | 'DISMISS'): Promise<void> => {
    setError(null);
    if (action === 'REMOVE' && note.trim().length < 5) {
      setError(
        'Say why this is being removed (at least 5 characters). It is recorded in the history.',
      );
      return;
    }
    try {
      await decide({
        targetType: item.targetType,
        targetId: item.targetId,
        action,
        note: note.trim() || undefined,
      }).unwrap();
    } catch (err) {
      setError((err as { message?: string }).message ?? 'The decision could not be saved.');
    }
  };

  return (
    <li className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-neutral-100">
            {TARGET_LABEL[item.targetType] ?? item.targetType}
            <span className="ml-2 text-xs text-neutral-400">
              {CONTEXT_LABEL[item.context.kind] ?? item.context.kind}
              {item.context.name ? ` · ${item.context.name}` : ''}
            </span>
          </p>
          <p className="text-xs text-neutral-400">
            Last reported {new Date(item.lastReportedAt).toLocaleString()}
          </p>
        </div>
        <Badge tone={item.reportCount > 2 ? 'bad' : 'warn'}>
          {item.reportCount} report{item.reportCount === 1 ? '' : 's'}
        </Badge>
      </div>

      {item.preview ? (
        <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-white/15 pl-3 text-sm text-neutral-200">
          {item.preview.text}
          {item.preview.author && (
            <footer className="mt-1 text-xs text-neutral-500">— {item.preview.author}</footer>
          )}
        </blockquote>
      ) : item.alreadyRemoved ? (
        <p className="mt-3 text-sm italic text-neutral-500">
          This content has already been removed.
        </p>
      ) : !item.actionable ? (
        <Alert tone="info">
          This is a private conversation. Direct messages and private groups are not moderated, so
          the content is not shown and cannot be removed here. The report is kept on record.
        </Alert>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-neutral-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300">
          Reasons given ({item.reports.length})
        </summary>
        <ul className="mt-2 space-y-1.5">
          {item.reports.map((report, index) => (
            <li key={`${report.reportedAt}-${index}`} className="text-sm text-neutral-300">
              “{report.reason}”
              <span className="ml-2 text-xs text-neutral-500">
                {report.reporter ? report.reporter.fullName : 'Reporter hidden'} ·{' '}
                {new Date(report.reportedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {item.actionable && (
        <div className="mt-4 space-y-3">
          <TextArea
            label="Moderator note"
            hint="Required to remove. Shown in the moderation history and the audit trail."
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            {confirmingRemove ? (
              <>
                <Button variant="danger" busy={isLoading} onClick={() => void act('REMOVE')}>
                  Confirm removal
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingRemove(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingRemove(true)}>
                Remove content
              </Button>
            )}
            <Button variant="secondary" busy={isLoading} onClick={() => void act('DISMISS')}>
              Dismiss reports
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function HistoryRow({ row }: { row: ModerationActionDTO }): JSX.Element {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 py-2 text-sm">
      <span className="text-neutral-200">
        <Badge tone={row.action === 'REMOVE' ? 'bad' : 'neutral'}>
          {row.action === 'REMOVE' ? 'Removed' : 'Dismissed'}
        </Badge>{' '}
        {TARGET_LABEL[row.targetType] ?? row.targetType} ·{' '}
        {CONTEXT_LABEL[row.context.kind] ?? row.context.kind} · {row.reportCount} report
        {row.reportCount === 1 ? '' : 's'}
        {row.note && <span className="text-neutral-400"> — “{row.note}”</span>}
      </span>
      <span className="text-xs text-neutral-500">
        {row.actor.fullName} · {new Date(row.at).toLocaleString()}
      </span>
    </li>
  );
}

export function ModerationPage(): JSX.Element {
  const reports = useGetModerationReportsQuery();
  const history = useGetModerationHistoryQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moderation"
        subtitle="Reported content within your moderation scope, most-reported first."
      />

      <SectionCard title="Open reports">
        {reports.isLoading && <SkeletonRows rows={3} />}
        {reports.isError && (
          <ErrorState message="Could not load the queue." onRetry={() => void reports.refetch()} />
        )}
        {reports.data?.length === 0 && (
          <EmptyState
            title="Nothing to review"
            description="Reports within your scope will appear here."
          />
        )}
        {reports.data && reports.data.length > 0 && (
          <ul className="space-y-3">
            {reports.data.map((item) => (
              <QueueItem key={`${item.targetType}:${item.targetId}`} item={item} />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Recent decisions">
        {history.isLoading && <SkeletonRows rows={2} />}
        {history.isError && (
          <ErrorState
            message="Could not load the history."
            onRetry={() => void history.refetch()}
          />
        )}
        {history.data?.length === 0 && <EmptyState title="No decisions yet" />}
        {history.data && history.data.length > 0 && (
          <ul>
            {history.data.map((row) => (
              <HistoryRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
