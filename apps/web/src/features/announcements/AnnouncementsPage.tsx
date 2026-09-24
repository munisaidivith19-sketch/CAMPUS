/**
 * The announcements feed.
 *
 * Only announcements addressed to the reader ever arrive here — the server evaluates the
 * audience from who they are, so there is nothing to filter client-side.
 */
import { useState, type FormEvent } from 'react';
import { UPLOAD } from '@campusconnect/config';
import {
  AnnouncementPriority,
  AnnouncementScope,
  Permission,
  type AnnouncementDTO,
} from '@campusconnect/types';
import { useCreateAnnouncementMutation, useGetAnnouncementsQuery } from '../../store/campusApi.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select, TextArea } from '../../components/ui/Field.js';
import { Alert } from '../../components/ui/Feedback.js';
import { AttachmentList, AttachmentPicker, useAttachmentUploads } from '../files/Attachments.js';

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

      <p
        className={`mt-3 whitespace-pre-line text-sm text-neutral-300 ${expanded ? '' : 'line-clamp-2'}`}
      >
        {announcement.body}
      </p>

      <AttachmentList attachments={announcement.attachments} />

      <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Show less' : 'Read more'}
      </Button>
    </li>
  );
}

/** Which reference each audience needs; the server re-checks the author's authority for it. */
const SCOPE_FIELD: Partial<Record<AnnouncementScope, { key: string; label: string }>> = {
  DEPARTMENT: { key: 'departmentId', label: 'Department id' },
  BATCH: { key: 'batch', label: 'Batch (e.g. 2024-2028)' },
  SECTION: { key: 'section', label: 'Section' },
  CLUB: { key: 'clubId', label: 'Club id' },
  ROLE: { key: 'role', label: 'Role (e.g. FACULTY)' },
};

function PublishForm(): JSX.Element {
  const [createAnnouncement, { isLoading }] = useCreateAnnouncementMutation();
  const attachments = useAttachmentUploads(UPLOAD.ANNOUNCEMENT_MAX_ATTACHMENTS);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<AnnouncementPriority>(AnnouncementPriority.NORMAL);
  const [scope, setScope] = useState<AnnouncementScope>(AnnouncementScope.COLLEGE);
  const [reference, setReference] = useState('');
  const [batch, setBatch] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const field = SCOPE_FIELD[scope];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setResult(null);
    const target: Record<string, string> = { scope };
    if (field) target[field.key] = reference.trim();
    if (scope === AnnouncementScope.SECTION && batch.trim()) target.batch = batch.trim();
    try {
      await createAnnouncement({
        title,
        body,
        priority,
        target,
        attachmentFileIds: attachments.readyIds,
      }).unwrap();
      setTitle('');
      setBody('');
      setReference('');
      attachments.reset();
      setResult({ tone: 'success', text: 'Published.' });
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Could not publish.';
      setResult({ tone: 'error', text: message });
    }
  };

  return (
    <SectionCard title="Publish an announcement">
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={3}
          maxLength={200}
        />
        <TextArea
          label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={10_000}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as AnnouncementPriority)}
            options={Object.values(AnnouncementPriority).map((value) => ({
              value,
              label: value.toLowerCase(),
            }))}
          />
          <Select
            label="Audience"
            value={scope}
            onChange={(e) => setScope(e.target.value as AnnouncementScope)}
            hint="You can only publish to audiences you are responsible for."
            options={Object.values(AnnouncementScope).map((value) => ({
              value,
              label: value.toLowerCase(),
            }))}
          />
        </div>
        {field && (
          <Input
            label={field.label}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required
          />
        )}
        {scope === AnnouncementScope.SECTION && (
          <Input
            label="Batch (optional)"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
          />
        )}
        <AttachmentPicker
          uploads={attachments.uploads}
          onAdd={attachments.add}
          onRemove={attachments.remove}
        />
        <Button type="submit" busy={isLoading} disabled={attachments.busy}>
          {attachments.busy ? 'Uploading…' : 'Publish'}
        </Button>
      </form>
    </SectionCard>
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

      {/* UX only — the server re-checks who may publish to which audience. */}
      {can(Permission.ANNOUNCEMENT_CREATE) && <PublishForm />}

      <SectionCard title={unreadOnly ? 'Unread' : 'All announcements'}>
        {announcements.isLoading && <SkeletonRows rows={3} />}
        {announcements.isError && (
          <ErrorState
            message="Could not load announcements."
            onRetry={() => void announcements.refetch()}
          />
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
