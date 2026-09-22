/**
 * Forgot-password and reset-password screens.
 *
 * The request screen always reports the same outcome, registered or not — matching the server's
 * generic response, so the UI cannot be used to test whether an address exists.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPasswordSchema, resetPasswordSchema } from '@campusconnect/validation';
import { useForgotPasswordMutation, useResetPasswordMutation } from '../../store/authApi.js';
import { AuthLayout } from '../../components/ui/Surface.js';
import { Input } from '../../components/ui/Input.js';
import { Button } from '../../components/ui/Button.js';
import { Alert } from '../../components/ui/Feedback.js';

export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setFieldError(null);

    try {
      await forgotPassword(parsed.data).unwrap();
      setSent(true);
    } catch (error) {
      setFormError((error as { message?: string })?.message ?? 'Could not send the reset email.');
    }
  };

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If that address has an account, a reset link is on its way."
        footer={
          <Link to="/login" className="font-medium text-brand-200 underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <Alert tone="success">The link can be used once and expires in 30 minutes.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link to="/login" className="font-medium text-brand-200 underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}
        <Input
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError}
          required
        />
        <Button type="submit" busy={isLoading} fullWidth>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const navigate = useNavigate();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    if (password !== confirm) {
      setFieldError('Both passwords must match');
      return;
    }

    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'That password is not acceptable');
      return;
    }
    setFieldError(null);

    try {
      await resetPassword(parsed.data).unwrap();
      setDone(true);
    } catch (error) {
      setFormError((error as { message?: string })?.message ?? 'Could not reset your password.');
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Reset link missing" subtitle="This page needs the link from your email.">
        <Alert tone="error">
          Open the reset link from your inbox, or{' '}
          <Link to="/forgot-password" className="underline underline-offset-4">
            request a new one
          </Link>
          .
        </Alert>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password updated" subtitle="All other devices have been signed out.">
        <Alert tone="success">You can now sign in with your new password.</Alert>
        <div className="mt-5">
          <Button fullWidth onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Signing in elsewhere will be required again.">
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 12 characters, with upper and lower case letters and a digit."
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldError}
          required
        />
        <Button type="submit" busy={isLoading} fullWidth>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
