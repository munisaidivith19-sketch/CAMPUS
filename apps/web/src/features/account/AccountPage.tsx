/**
 * The signed-in account page.
 *
 * Intentionally NOT a role dashboard — those belong to Phase 3. This shows the caller their own
 * identity, lets them correct their name/phone, and surfaces the digital student ID with its
 * scannable code for students.
 */
import { useState, type FormEvent } from 'react';
import { updateMeSchema } from '@campusconnect/validation';
import { Role } from '@campusconnect/types';
import {
  useGetMeQuery,
  useGetStudentIdQuery,
  useIssueStudentIdQrMutation,
  useUpdateMeMutation,
} from '../../store/authApi.js';
import { useAppDispatch } from '../../store/index.js';
import { userUpdated } from '../../store/authSlice.js';
import { useAuth } from '../../hooks/useAuth.js';
import { GlassPanel } from '../../components/ui/Surface.js';
import { Input } from '../../components/ui/Input.js';
import { Button } from '../../components/ui/Button.js';
import { Alert, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';

function ProfileCard(): JSX.Element {
  const { data: me, isLoading, isError, refetch } = useGetMeQuery();
  const [updateMe, { isLoading: isSaving }] = useUpdateMeMutation();
  const dispatch = useAppDispatch();

  const [fullName, setFullName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (isLoading) return <SkeletonRows rows={2} />;
  if (isError || !me)
    return <ErrorState message="Could not load your account." onRetry={() => void refetch()} />;

  const value = fullName ?? me.fullName;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const parsed = updateMeSchema.safeParse({ fullName: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That name is not valid');
      return;
    }

    try {
      const updated = await updateMe(parsed.data).unwrap();
      dispatch(userUpdated(updated));
      setSaved(true);
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not save your changes.');
    }
  };

  return (
    <GlassPanel>
      <h2 className="text-lg font-semibold text-neutral-50">Your details</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-neutral-400">Email</dt>
          <dd className="text-neutral-100">{me.email}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Roles</dt>
          <dd className="text-neutral-100">{me.roles.join(', ')}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Account status</dt>
          <dd className="text-neutral-100">{me.status}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Two-factor</dt>
          <dd className="text-neutral-100">{me.mfaEnabled ? 'Enabled' : 'Not enabled'}</dd>
        </div>
      </dl>

      <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Saved.</Alert>}
        <Input
          label="Full name"
          value={value}
          onChange={(e) => {
            setFullName(e.target.value);
            setSaved(false);
          }}
        />
        <Button type="submit" busy={isSaving}>
          Save changes
        </Button>
      </form>
    </GlassPanel>
  );
}

function StudentIdCard(): JSX.Element | null {
  const { data: card, isLoading, isError } = useGetStudentIdQuery();
  const [issueQr, { data: qr, isLoading: isIssuing }] = useIssueStudentIdQrMutation();

  if (isLoading) return <SkeletonRows rows={1} />;
  // A student with no card issued yet is a normal state, not an error worth shouting about.
  if (isError || !card) return null;

  return (
    <GlassPanel>
      <h2 className="text-lg font-semibold text-neutral-50">Digital student ID</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-neutral-400">Card number</dt>
          <dd className="font-mono text-neutral-100">{card.cardNo}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Roll number</dt>
          <dd className="text-neutral-100">{card.holder.rollNo}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Valid until</dt>
          <dd className="text-neutral-100">{new Date(card.validTo).toLocaleDateString()}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Status</dt>
          <dd className="text-neutral-100">{card.status}</dd>
        </div>
      </dl>

      <div className="mt-6 space-y-3">
        <Button variant="secondary" busy={isIssuing} onClick={() => void issueQr()}>
          Show scannable code
        </Button>

        {qr && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-white p-4">
            <img src={qr.qrDataUrl} alt="Scannable student ID code" className="h-44 w-44" />
            <p className="text-xs text-neutral-600">
              Expires at {new Date(qr.expiresAt).toLocaleTimeString()} · single use
            </p>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

export function AccountPage(): JSX.Element {
  const { user, hasRole } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-50">Welcome, {user?.fullName}</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Phase 2 covers identity and security. Academics, community and dashboards arrive in Phase
          3.
        </p>
      </div>

      <ProfileCard />
      {hasRole(Role.STUDENT) && <StudentIdCard />}
    </div>
  );
}
