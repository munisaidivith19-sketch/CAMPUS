/**
 * The two second-step screens: MFA (authenticator code) and new-device verification (emailed
 * code). They share one component because the interaction is identical — only the copy and the
 * endpoint differ.
 *
 * The challenge id arrives via router state rather than the URL, so it does not end up in
 * browser history, bookmarks, or a referrer header.
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { otpCodeSchema } from '@campusconnect/validation';
import { useVerifyDeviceMutation, useVerifyMfaMutation } from '../../store/authApi.js';
import { useAppDispatch } from '../../store/index.js';
import { sessionEstablished } from '../../store/authSlice.js';
import { AuthLayout } from '../../components/ui/Surface.js';
import { Input } from '../../components/ui/Input.js';
import { Button } from '../../components/ui/Button.js';
import { Alert } from '../../components/ui/Feedback.js';

type Mode = 'MFA' | 'DEVICE';

function ChallengeScreen({ mode }: { mode: Mode }): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const challengeId = (location.state as { challengeId?: string } | null)?.challengeId;

  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [verifyMfa, mfaState] = useVerifyMfaMutation();
  const [verifyDevice, deviceState] = useVerifyDeviceMutation();
  const isLoading = mode === 'MFA' ? mfaState.isLoading : deviceState.isLoading;

  // Landing here directly (no challenge in hand) means the flow was not started.
  if (!challengeId) return <Navigate to="/login" replace />;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code');
      return;
    }
    setFieldError(null);

    try {
      const verify = mode === 'MFA' ? verifyMfa : verifyDevice;
      const result = await verify({ challengeId, code: parsed.data }).unwrap();

      if (result.status !== 'AUTHENTICATED') {
        // e.g. MFA cleared but the device still needs verifying.
        setFormError('One more verification step is required. Start again from sign in.');
        return;
      }

      dispatch(sessionEstablished({ user: result.user, accessToken: result.tokens.accessToken }));
      navigate('/', { replace: true });
    } catch (error) {
      setFormError((error as { message?: string })?.message ?? 'That code was not accepted.');
    }
  };

  const copy =
    mode === 'MFA'
      ? {
          title: 'Two-factor verification',
          subtitle: 'Enter the 6-digit code from your authenticator app.',
          label: 'Authenticator code',
        }
      : {
          title: 'Verify this device',
          subtitle: 'We emailed a 6-digit code because this device is new.',
          label: 'Emailed code',
        };

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        <Link to="/login" className="font-medium text-brand-200 underline underline-offset-4">
          Cancel and sign in again
        </Link>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}
        <Input
          label={copy.label}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          error={fieldError}
          required
        />
        <Button type="submit" busy={isLoading} fullWidth>
          Verify
        </Button>
      </form>
    </AuthLayout>
  );
}

export function MfaVerifyPage(): JSX.Element {
  return <ChallengeScreen mode="MFA" />;
}

export function DeviceVerifyPage(): JSX.Element {
  return <ChallengeScreen mode="DEVICE" />;
}
