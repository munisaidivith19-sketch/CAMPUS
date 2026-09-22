/**
 * Route tree.
 *
 * Public auth routes sit outside the shell; everything inside `RequireAuth` renders within the
 * authenticated layout. Remember that the guards are UX only — the API is what actually
 * enforces access (see routes/guards.tsx).
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell.js';
import { RedirectIfAuthenticated, RequireAuth } from './guards.js';
import { LoginPage } from '../features/auth/LoginPage.js';
import { RegisterPage } from '../features/auth/RegisterPage.js';
import { ForgotPasswordPage, ResetPasswordPage } from '../features/auth/PasswordResetPages.js';
import { DeviceVerifyPage, MfaVerifyPage } from '../features/auth/ChallengePages.js';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage.js';
import { AccountPage } from '../features/account/AccountPage.js';
import { SecurityPage } from '../features/security/SecurityPage.js';

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthenticated>
            <RegisterPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      {/* Mid-login challenge steps; they redirect out if entered without a challenge. */}
      <Route path="/verify-mfa" element={<MfaVerifyPage />} />
      <Route path="/verify-device" element={<DeviceVerifyPage />} />

      {/* Authenticated */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<AccountPage />} />
        <Route path="/security" element={<SecurityPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
