/**
 * Discussions: browse, post, comment, react and report.
 *
 * Reporting is available to everyone; acting on a report is not, and the UI does not pretend
 * otherwise — the moderation queue is Part B, so this page only submits reports.
 */
import { useState, type FormEvent } from 'react';
import type { DiscussionDTO } from '@campusconnect/types';
import {
  useAddCommentMutation,
  useCreateDiscussionMutation,
  useGetCommentsQuery,
  useGetDiscussionsQuery,
  useReportContentMutation,
  useToggleReactionMutation,
} from '../../store/campusApi.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

function CommentThread({ discussionId }: { discussionId: string }): JSX.Element {
  const comments = useGetCommentsQuery(discussionId);
  const [addComment, { isLoading }] = useAddCommentMutation();
  const [toggleReaction] = useToggleReactionMutation();
  const [reportContent] = useReportContentMutation();
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (body.trim().length === 0) return;
    await addComment({ discussionId, body: body.trim() }).unwrap();
    setBody('');
  };

  const report = async (commentId: string): Promise<void> => {
    await reportContent({
      targetType: 'COMMENT',
      targetId: commentId,
      reason: 'Reported from the discussion view for moderator review.',
    }).unwrap();
    setNotice('Reported for review.');
  };

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      {comments.isLoading && <SkeletonRows rows={2} />}
      {comments.data?.length === 0 && <p className="text-sm text-neutral-400">No comments yet.</p>}

      {comments.data && comments.data.length > 0 && (
        <ul className="space-y-2">
          {comments.data.map((comment) => (
            <li key={comment.id} className="rounded-lg bg-white/5 p-3">
              <p className="text-sm text-neutral-200">{comment.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                <span>{comment.author.fullName}</span>
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
                <button
                  type="button"
                  onClick={() => void toggleReaction(comment.id)}
                  aria-pressed={comment.reactedByMe}
                  className={`rounded px-2 py-0.5 transition hover:bg-white/10 ${
                    comment.reactedByMe ? 'text-brand-200' : ''
                  }`}
                >
                  ▲ {comment.reactionCount}
                </button>
                <button
                  type="button"
                  onClick={() => void report(comment.id)}
                  className="rounded px-2 py-0.5 transition hover:bg-white/10 hover:text-danger-500"
                >
                  Report
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void submit(e)} className="mt-3 flex gap-2">
        <div className="flex-1">
          <Input label="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="self-end">
          <Button type="submit" busy={isLoading}>
            Post
          </Button>
        </div>
      </form>
    </div>
  );
}

function DiscussionCard({ discussion }: { discussion: DiscussionDTO }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reportContent] = useReportContentMutation();
  const [notice, setNotice] = useState<string | null>(null);

  const report = async (): Promise<void> => {
    await reportContent({
      targetType: 'DISCUSSION',
      targetId: discussion.id,
      reason: 'Reported from the discussion list for moderator review.',
    }).unwrap();
    setNotice('Reported for review.');
  };

  return (
    <li className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-neutral-100">{discussion.title}</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {discussion.author.fullName} · {new Date(discussion.createdAt).toLocaleString()} ·{' '}
            {discussion.commentCount} comment{discussion.commentCount === 1 ? '' : 's'}
          </p>
        </div>
        <Badge>{discussion.category}</Badge>
      </div>

      <p className="mt-3 text-sm text-neutral-300">{discussion.body}</p>

      {discussion.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {discussion.tags.map((tag) => (
            <Badge key={tag}>#{tag}</Badge>
          ))}
        </div>
      )}

      {notice && (
        <div className="mt-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide comments' : 'View comments'}
        </Button>
        <Button variant="ghost" onClick={() => void report()}>
          Report
        </Button>
      </div>

      {open && <CommentThread discussionId={discussion.id} />}
    </li>
  );
}

export function DiscussionsPage(): JSX.Element {
  const discussions = useGetDiscussionsQuery();
  const [createDiscussion, { isLoading }] = useCreateDiscussionMutation();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('Academics');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    try {
      await createDiscussion({ title, body, category, tags: [] }).unwrap();
      setTitle('');
      setBody('');
      setComposing(false);
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not post your discussion.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discussions"
        subtitle="Ask questions and help each other out."
        action={
          <Button variant={composing ? 'ghost' : 'primary'} onClick={() => setComposing((v) => !v)}>
            {composing ? 'Cancel' : 'Start a discussion'}
          </Button>
        }
      />

      {composing && (
        <SectionCard title="New discussion">
          <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <Input label="Body" value={body} onChange={(e) => setBody(e.target.value)} required />
            <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} required />
            <Button type="submit" busy={isLoading}>
              Post discussion
            </Button>
          </form>
        </SectionCard>
      )}

      <SectionCard title="Recent">
        {discussions.isLoading && <SkeletonRows rows={3} />}
        {discussions.isError && (
          <ErrorState message="Could not load discussions." onRetry={() => void discussions.refetch()} />
        )}
        {discussions.data?.length === 0 && (
          <EmptyState title="No discussions yet" description="Be the first to start one." />
        )}

        {discussions.data && discussions.data.length > 0 && (
          <ul className="space-y-3">
            {discussions.data.map((discussion) => (
              <DiscussionCard key={discussion.id} discussion={discussion} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
