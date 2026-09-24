/**
 * Club discovery and joining.
 *
 * The "Suggested" tab shows rule-based matches and prints the reason each club matched. That
 * labelling is deliberate: these are deterministic rules over declared interests and prior
 * membership, not a recommendation model.
 */
import { useState } from 'react';
import { ClubMembershipStatus, type ClubDTO } from '@campusconnect/types';
import {
  useGetClubsQuery,
  useJoinClubMutation,
  useLeaveClubMutation,
} from '../../store/campusApi.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';

function ClubCard({
  club,
  onJoin,
  onLeave,
  busy,
}: {
  club: ClubDTO;
  onJoin: () => void;
  onLeave: () => void;
  busy: boolean;
}): JSX.Element {
  const status = club.membership?.status;

  return (
    <li className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-neutral-100">{club.name}</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {club.category} · {club.memberCount} member{club.memberCount === 1 ? '' : 's'}
          </p>
        </div>

        {status === ClubMembershipStatus.APPROVED || status === ClubMembershipStatus.REQUESTED ? (
          <div className="flex items-center gap-2">
            <Badge tone={status === ClubMembershipStatus.APPROVED ? 'good' : 'info'}>
              {status === ClubMembershipStatus.APPROVED ? 'Member' : 'Requested'}
            </Badge>
            <Button variant="ghost" busy={busy} onClick={onLeave}>
              {status === ClubMembershipStatus.APPROVED ? 'Leave' : 'Withdraw'}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" busy={busy} onClick={onJoin}>
            Request to join
          </Button>
        )}
      </div>

      <p className="mt-3 text-sm text-neutral-300">{club.description}</p>

      {club.interests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {club.interests.map((interest) => (
            <Badge key={interest}>{interest}</Badge>
          ))}
        </div>
      )}

      {club.matchReasons.length > 0 && (
        <ul className="mt-3 space-y-1 border-l-2 border-brand-400/40 pl-3">
          {club.matchReasons.map((reason) => (
            <li key={reason} className="text-xs text-brand-200">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ClubsPage(): JSX.Element {
  const [suggested, setSuggested] = useState(false);
  const clubs = useGetClubsQuery({ suggested });
  const [joinClub, { isLoading }] = useJoinClubMutation();
  const [leaveClub, { isLoading: leaving }] = useLeaveClubMutation();
  const [error, setError] = useState<string | null>(null);

  const join = async (id: string): Promise<void> => {
    setError(null);
    try {
      await joinClub(id).unwrap();
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not send your request.');
    }
  };

  const leave = async (club: ClubDTO): Promise<void> => {
    setError(null);
    // Leaving also removes you from the club chat straight away; say so before doing it.
    if (!window.confirm(`Leave ${club.name}? You will also lose access to its chat.`)) return;
    try {
      await leaveClub(club.id).unwrap();
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not leave the club.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clubs"
        subtitle="Browse societies or see rule-based suggestions."
        action={
          <div className="flex gap-2">
            {[
              { key: false, label: 'All clubs' },
              { key: true, label: 'Suggested for you' },
            ].map((tab) => (
              <button
                key={String(tab.key)}
                type="button"
                aria-pressed={suggested === tab.key}
                onClick={() => setSuggested(tab.key)}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm transition',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
                  suggested === tab.key
                    ? 'bg-brand-500/20 text-white'
                    : 'text-neutral-300 hover:bg-white/10',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {suggested && (
        <Alert tone="info">
          Suggestions are rule-based: your declared interests, the categories you already joined,
          and what peers in your department joined. Each card shows why it matched.
        </Alert>
      )}

      <SectionCard title={suggested ? 'Suggested' : 'All clubs'}>
        {clubs.isLoading && <SkeletonRows rows={3} />}
        {clubs.isError && (
          <ErrorState message="Could not load clubs." onRetry={() => void clubs.refetch()} />
        )}
        {clubs.data?.length === 0 && (
          <EmptyState
            title={suggested ? 'No suggestions yet' : 'No clubs yet'}
            description={
              suggested
                ? 'Add interests to your profile, or browse all clubs.'
                : 'Clubs will appear here once they are created.'
            }
          />
        )}

        {clubs.data && clubs.data.length > 0 && (
          <ul className="space-y-3">
            {clubs.data.map((club) => (
              <ClubCard
                key={club.id}
                club={club}
                busy={isLoading || leaving}
                onJoin={() => void join(club.id)}
                onLeave={() => void leave(club)}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
