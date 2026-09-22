/**
 * The security-dashboard foundation: "My Devices", recent sign-in activity, and two-factor
 * management.
 *
 * This is the user's own view of access to their own account — not an administrative console.
 * Every query here is self-scoped server-side; there is no id this page could point elsewhere.
 */
import { useState, type FormEvent } from 'react';
import type { SessionDTO } from '@campusconnect/types';
import {
  useConfirmMfaMutation,
  useDisableMfaMutation,
  useEnrollMfaMutation,
  useGetLoginHistoryQuery,
  useGetSecurityOverviewQuery,
  useRevokeOtherSessionsMutation,
  useRevokeSessionMutation,
} from '../../store/authApi.js';
import { GlassPanel } from '../../components/ui/Surface.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

function SessionRow({ session, onRevoke, busy }: { session: SessionDTO; onRevoke: () => void; busy: boolean }): JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-100">
          {session.device}
          {session.current && (
            <span className="ml-2 rounded-full bg-success-500/20 px-2 py-0.5 text-xs text-success-500">
              This device
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-neutral-400">
          {session.ip} · last active {formatWhen(session.lastActiveAt)}
        </p>
      </div>

      {!session.current && (
        <Button variant="danger" busy={busy} onClick={onRevoke}>
          Sign out
        </Button>
      )}
    </li>
  );
}

function DevicesCard(): JSX.Element {
  const { data, isLoading, isError, refetch } = useGetSecurityOverviewQuery();
  const [revokeSession, { isLoading: isRevoking }] = useRevokeSessionMutation();
  const [revokeOthers, { isLoading: isRevokingOthers }] = useRevokeOtherSessionsMutation();
  const [notice, setNotice] = useState<string | null>(null);

  if (isLoading) return <SkeletonRows rows={3} />;
  if (isError || !data) return <ErrorState message="Could not load your devices." onRetry={() => void refetch()} />;

  const others = data.activeSessions.filter((session) => !session.current);

  return (
    <GlassPanel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-50">My devices</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Everywhere your account is currently signed in.
          </p>
        </div>

        {others.length > 0 && (
          <Button
            variant="secondary"
            busy={isRevokingOthers}
            onClick={() => {
              void (async () => {
                const result = await revokeOthers().unwrap();
                setNotice(`Signed out ${result.revoked} other device(s).`);
              })();
            }}
          >
            Sign out all other devices
          </Button>
        )}
      </div>

      {notice && (
        <div className="mt-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <ul className="mt-5 space-y-3">
        {data.activeSessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            busy={isRevoking}
            onRevoke={() => {
              void revokeSession(session.id);
              setNotice(null);
            }}
          />
        ))}
      </ul>
    </GlassPanel>
  );
}

function ActivityCard(): JSX.Element {
  const { data, isLoading, isError, refetch } = useGetLoginHistoryQuery({ page: 1, limit: 10 });
  const { data: overview } = useGetSecurityOverviewQuery();

  if (isLoading) return <SkeletonRows rows={3} />;
  if (isError || !data) return <ErrorState message="Could not load your sign-in activity." onRetry={() => void refetch()} />;

  return (
    <GlassPanel>
      <h2 className="text-lg font-semibold text-neutral-50">Recent sign-in activity</h2>
      <p className="mt-1 text-sm text-neutral-400">
        {overview ? `${overview.failedAttemptsLast7Days} failed attempt(s) in the last 7 days.` : ''}
      </p>

      {data.length === 0 ? (
        <div className="mt-5">
          <EmptyState title="No sign-in activity yet" />
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {data.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
            >
              <span className="text-neutral-200">{entry.device}</span>
              <span className="text-neutral-400">{entry.ip}</span>
              <span className="text-neutral-400">{formatWhen(entry.at)}</span>
              <span
                className={
                  entry.result === 'SUCCESS'
                    ? 'rounded-full bg-success-500/20 px-2 py-0.5 text-xs text-success-500'
                    : 'rounded-full bg-warning-500/20 px-2 py-0.5 text-xs text-warning-500'
                }
              >
                {entry.result === 'SUCCESS' ? 'Signed in' : (entry.reason ?? 'Failed')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function TwoFactorCard(): JSX.Element {
  const { data: overview, refetch } = useGetSecurityOverviewQuery();
  const [enrollMfa, { data: enrollment, isLoading: isEnrolling }] = useEnrollMfaMutation();
  const [confirmMfa, { isLoading: isConfirming }] = useConfirmMfaMutation();
  const [disableMfa, { isLoading: isDisabling }] = useDisableMfaMutation();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirm = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      await confirmMfa({ code }).unwrap();
      setNotice('Two-factor authentication is now on.');
      setCode('');
      void refetch();
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'That code was not accepted.');
    }
  };

  const disable = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      await disableMfa({ password }).unwrap();
      setNotice('Two-factor authentication is off.');
      setPassword('');
      void refetch();
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not turn two-factor off.');
    }
  };

  return (
    <GlassPanel>
      <h2 className="text-lg font-semibold text-neutral-50">Two-factor authentication</h2>
      <p className="mt-1 text-sm text-neutral-400">
        An authenticator app code is required at sign-in when this is on.
      </p>

      <div className="mt-5 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {overview?.mfaEnabled ? (
          <form onSubmit={(e) => void disable(e)} className="space-y-4" noValidate>
            <Alert tone="info">Two-factor authentication is enabled on your account.</Alert>
            <Input
              label="Confirm your password to turn it off"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="danger" busy={isDisabling}>
              Turn off two-factor
            </Button>
          </form>
        ) : enrollment ? (
          <form onSubmit={(e) => void confirm(e)} className="space-y-4" noValidate>
            <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-4">
              <img src={enrollment.qrDataUrl} alt="Two-factor setup code" className="h-44 w-44" />
              <p className="break-all text-center font-mono text-xs text-neutral-600">
                {enrollment.secret}
              </p>
            </div>
            <p className="text-sm text-neutral-400">
              Scan the code in your authenticator app, then enter the 6-digit code it shows.
            </p>
            <Input
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
            <Button type="submit" busy={isConfirming}>
              Confirm and enable
            </Button>
          </form>
        ) : (
          <Button variant="secondary" busy={isEnrolling} onClick={() => void enrollMfa()}>
            Set up two-factor authentication
          </Button>
        )}
      </div>
    </GlassPanel>
  );
}

export function SecurityPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-50">Security</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Review where your account is signed in and how it is protected.
        </p>
      </div>

      <DevicesCard />
      <TwoFactorCard />
      <ActivityCard />
    </div>
  );
}
