/**
 * Registration screen.
 *
 * The success state is deliberately vague about whether the address was already registered —
 * it mirrors the server's enumeration-resistant response, so the UI cannot leak what the API
 * refused to say.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { registerSchema } from '@campusconnect/validation';
import { useRegisterMutation } from '../../store/authApi.js';
import { AuthLayout } from '../../components/ui/Surface.js';
import { Input } from '../../components/ui/Input.js';
import { Button } from '../../components/ui/Button.js';
import { Alert } from '../../components/ui/Feedback.js';

export function RegisterPage(): JSX.Element {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [register, { isLoading }] = useRegisterMutation();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({ fullName, email, password });
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])),
      );
      return;
    }
    setFieldErrors({});

    try {
      await register(parsed.data).unwrap();
      setSubmitted(true);
    } catch (error) {
      setFormError((error as { message?: string })?.message ?? 'Could not create your account.');
    }
  };

  if (submitted) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If that address can hold an account here, a verification link is on its way."
        footer={
          <Link to="/login" className="font-medium text-brand-200 underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <Alert tone="success">
          Open the link in the email to activate your account. The link is valid for 24 hours.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Registration is open to institution email addresses."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-200 underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Input
          label="Full name"
          name="fullName"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={fieldErrors.fullName}
          required
        />

        <Input
          label="Institution email"
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint="At least 12 characters, with upper and lower case letters and a digit."
          required
        />

        <Button type="submit" busy={isLoading} fullWidth>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
