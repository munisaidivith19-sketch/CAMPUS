/**
 * Global search across announcements, discussions, events and clubs.
 *
 * Results are already authorization-filtered server-side — an announcement the caller was not
 * addressed in never appears here, so search cannot be used as a side channel.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSearchQuery } from '../../store/campusApi.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

const KIND_TONE = {
  ANNOUNCEMENT: 'info',
  DISCUSSION: 'neutral',
  EVENT: 'good',
  CLUB: 'warn',
} as const;

export function SearchPage(): JSX.Element {
  const [draft, setDraft] = useState('');
  const [term, setTerm] = useState('');

  // `skip` keeps the query from firing until there is something worth searching for.
  const results = useSearchQuery(term, { skip: term.trim().length < 2 });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTerm(draft.trim());
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Search" subtitle="Announcements, discussions, events and clubs." />

      <SectionCard title="Find something">
        <form onSubmit={submit} className="flex gap-2">
          <div className="flex-1">
            <Input
              label="Search term"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              hint="At least 2 characters."
            />
          </div>
          <div className="self-end">
            <Button type="submit">Search</Button>
          </div>
        </form>
      </SectionCard>

      {term.trim().length >= 2 && (
        <SectionCard title={`Results for “${term}”`}>
          {results.isLoading && <SkeletonRows rows={3} />}
          {results.isError && <ErrorState message="Search failed." onRetry={() => void results.refetch()} />}
          {results.data?.length === 0 && (
            <EmptyState title="No matches" description="Try a different word." />
          )}

          {results.data && results.data.length > 0 && (
            <ul className="space-y-2">
              {results.data.map((result) => (
                <li key={`${result.kind}-${result.id}`} className="rounded-lg border border-white/10 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={result.link} className="text-sm font-medium text-neutral-100 hover:underline">
                        {result.title}
                      </Link>
                      <p className="mt-1 text-sm text-neutral-400">{result.snippet}</p>
                    </div>
                    <Badge tone={KIND_TONE[result.kind]}>{result.kind}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
