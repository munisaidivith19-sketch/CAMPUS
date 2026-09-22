/**
 * Sign-in screen.
 *
 * Login is a state machine, not a single call: the server may answer with a session, an MFA
 * challenge, or a new-device challenge. This page routes to the matching step and never assumes
 * success. Validation reuses the shared Zod schema so the client can only reject what the
 * server would also reject — and the server re-validates regardless.
 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema } from '@campusconnect/validation';
import { useLoginMutation } from '../../store/authApi.js';
import { useAppDispatch } from '../../store/index.js';
import { sessionEstablished } from '../../store/authSlice.js';
import { AuthLayout } from '../../components/ui/Surface.js';
import { Input } from '../../components/ui/Input.js';
import { Button } from '../../components/ui/Button.js';
import { Alert } from '../../components/ui/Feedback.js';

export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [login, { isLoading }] = useLoginMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setFieldErrors({});

    try {
      const result = await login(parsed.data).unwrap();

      if (result.status === 'MFA_REQUIRED') {
        navigate('/verify-mfa', { state: { challengeId: result.challengeId } });
        return;
      }

      if (result.status === 'DEVICE_VERIFICATION_REQUIRED') {
        navigate('/verify-device', { state: { challengeId: result.challengeId } });
        return;
      }

      dispatch(sessionEstablished({ user: result.user, accessToken: result.tokens.accessToken }));
      navigate(from, { replace: true });
    } catch (error) {
      const message = (error as { message?: string })?.message;
      setFormError(message ?? 'Could not sign you in. Check your details and try again.');
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your institution email address."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-brand-200 underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
        />

        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          required
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm text-neutral-300 underline underline-offset-4 hover:text-white"
          >
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" busy={isLoading} fullWidth>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
