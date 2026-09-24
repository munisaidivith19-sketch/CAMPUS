/**
 * Events: browse, register, and show the check-in code.
 *
 * The QR is rendered from a data URL the server produced for an opaque, single-use token. The
 * page never sees or constructs identity — it just displays what it was handed, and the code
 * expires in minutes.
 */
import { useState } from 'react';
import { EventRegistrationStatus, Permission, type EventDTO } from '@campusconnect/types';
import {
  useCheckInAttendeeMutation,
  useGetEventsQuery,
  useIssueEventQrMutation,
  useRegisterForEventMutation,
} from '../../store/campusApi.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

function EventCard({ event }: { event: EventDTO }): JSX.Element {
  const { can } = useAuth();
  const [register, { isLoading: isRegistering }] = useRegisterForEventMutation();
  const [issueQr, { data: qr, isLoading: isIssuing }] = useIssueEventQrMutation();
  const [error, setError] = useState<string | null>(null);

  const registered = event.registration !== null;
  const checkedIn = event.registration?.status === EventRegistrationStatus.CHECKED_IN;

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Something went wrong.');
    }
  };

  return (
    <li className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-neutral-100">{event.title}</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {new Date(event.startsAt).toLocaleString()} · {event.venue} · {event.organizer.name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge>{event.category}</Badge>
          {event.seatsRemaining !== null && (
            <Badge tone={event.seatsRemaining === 0 ? 'bad' : 'neutral'}>
              {event.seatsRemaining} seat{event.seatsRemaining === 1 ? '' : 's'} left
            </Badge>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm text-neutral-300">{event.description}</p>

      {event.matchReasons.length > 0 && (
        <ul className="mt-3 space-y-1 border-l-2 border-brand-400/40 pl-3">
          {event.matchReasons.map((reason) => (
            <li key={reason} className="text-xs text-brand-200">
              {reason}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {checkedIn ? (
          <Badge tone="good">Checked in</Badge>
        ) : registered ? (
          <>
            <Badge tone="info">Registered</Badge>
            <Button
              variant="secondary"
              busy={isIssuing}
              onClick={() => void act(() => issueQr(event.id).unwrap())}
            >
              Show check-in code
            </Button>
          </>
        ) : (
          can(Permission.EVENT_REGISTER) && (
            <Button
              busy={isRegistering}
              onClick={() => void act(() => register(event.id).unwrap())}
            >
              Register
            </Button>
          )
        )}
      </div>

      {qr && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg bg-white p-4">
          <img src={qr.qrDataUrl} alt="Event check-in code" className="h-44 w-44" />
          <p className="text-xs text-neutral-600">
            Single use · expires {new Date(qr.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </li>
  );
}

/** The door scanner, for staff who hold `event:checkin`. */
function CheckInPanel({ events }: { events: EventDTO[] }): JSX.Element {
  const [eventId, setEventId] = useState(events[0]?.id ?? '');
  const [token, setToken] = useState('');
  const [checkIn, { isLoading }] = useCheckInAttendeeMutation();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    setResult(null);
    try {
      const response = await checkIn({ eventId, token: token.trim() }).unwrap();
      setResult(`${response.attendee.fullName} (${response.attendee.rollNo ?? '—'}) checked in.`);
      setToken('');
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'That code was not accepted.');
    }
  };

  return (
    <SectionCard title="Check in an attendee">
      <div className="space-y-4">
        {result && <Alert tone="success">{result}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <label htmlFor="checkin-event" className="block text-sm font-medium text-neutral-200">
          Event
        </label>
        <select
          id="checkin-event"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-neutral-100"
        >
          {events.map((event) => (
            <option key={event.id} value={event.id} className="bg-neutral-900">
              {event.title}
            </option>
          ))}
        </select>

        <Input
          label="Scanned code"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint="Paste the value read from the attendee's QR."
        />

        <Button
          busy={isLoading}
          onClick={() => void submit()}
          disabled={!eventId || token.length < 20}
        >
          Check in
        </Button>
      </div>
    </SectionCard>
  );
}

export function EventsPage(): JSX.Element {
  const [suggested, setSuggested] = useState(false);
  const events = useGetEventsQuery({ suggested, upcomingOnly: true });
  const { can } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        subtitle="What is happening on campus."
        action={
          <div className="flex gap-2">
            {[
              { key: false, label: 'All upcoming' },
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

      <SectionCard title={suggested ? 'Suggested' : 'Upcoming events'}>
        {events.isLoading && <SkeletonRows rows={3} />}
        {events.isError && (
          <ErrorState message="Could not load events." onRetry={() => void events.refetch()} />
        )}
        {events.data?.length === 0 && (
          <EmptyState
            title={suggested ? 'No suggestions yet' : 'No upcoming events'}
            description={suggested ? 'Add interests or join a club to get suggestions.' : undefined}
          />
        )}

        {events.data && events.data.length > 0 && (
          <ul className="space-y-3">
            {events.data.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        )}
      </SectionCard>

      {can(Permission.EVENT_CHECKIN) && events.data && events.data.length > 0 && (
        <CheckInPanel events={events.data} />
      )}
    </div>
  );
}
