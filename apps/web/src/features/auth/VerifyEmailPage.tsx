/**
 * Email-verification landing page.
 *
 * The token arrives in the query string because it comes from a link in an email. It is spent
 * exactly once, on mount, and the result is reported plainly — a failed or already-used link
 * says so rather than pretending to succeed.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useVerifyEmailMutation } from '../../store/authApi.js';
import { AuthLayout } from '../../components/ui/Surface.js';
import { Alert, Spinner } from '../../components/ui/Feedback.js';

type Outcome = 'pending' | 'verified' | 'failed';

export function VerifyEmailPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [verifyEmail] = useVerifyEmailMutation();
  const [outcome, setOutcome] = useState<Outcome>('pending');
  const [message, setMessage] = useState<string | null>(null);
  // React 18 StrictMode mounts effects twice in dev; the token is single-use, so guard it.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await verifyEmail({ token }).unwrap();
        setOutcome('verified');
      } catch (error) {
        setMessage((error as { message?: string })?.message ?? 'This link is no longer valid.');
        setOutcome('failed');
      }
    })();
  }, [token, verifyEmail]);

  if (!token) {
    return (
      <AuthLayout title="Verification link missing" subtitle="Open the link from your email.">
        <Alert tone="error">This page needs the verification link we emailed you.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Email verification"
      footer={
        <Link to="/login" className="font-medium text-brand-200 underline underline-offset-4">
          Go to sign in
        </Link>
      }
    >
      {outcome === 'pending' && <Spinner label="Verifying your email…" />}
      {outcome === 'verified' && (
        <Alert tone="success">Your email is verified. You can sign in now.</Alert>
      )}
      {outcome === 'failed' && (
        <Alert tone="error">
          {message} If you already verified this address, just sign in.
        </Alert>
      )}
    </AuthLayout>
  );
}
