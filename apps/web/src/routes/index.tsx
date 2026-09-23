/**
 * Route tree.
 *
 * Public auth routes sit outside the shell; everything inside `RequireAuth` renders within the
 * authenticated layout. Remember that the guards are UX only — the API is what actually
 * enforces access (see routes/guards.tsx).
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { Permission } from '@campusconnect/types';
import { AppShell } from '../components/layout/AppShell.js';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission } from './guards.js';
import { LoginPage } from '../features/auth/LoginPage.js';
import { RegisterPage } from '../features/auth/RegisterPage.js';
import { ForgotPasswordPage, ResetPasswordPage } from '../features/auth/PasswordResetPages.js';
import { DeviceVerifyPage, MfaVerifyPage } from '../features/auth/ChallengePages.js';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage.js';
import { AccountPage } from '../features/account/AccountPage.js';
import { SecurityPage } from '../features/security/SecurityPage.js';
import { DashboardPage } from '../features/dashboard/DashboardPage.js';
import { AttendancePage } from '../features/attendance/AttendancePage.js';
import { CorrectionsPage, MarkAttendancePage } from '../features/attendance/MarkAttendancePage.js';
import { TimetablePage } from '../features/timetable/TimetablePage.js';
import { AnnouncementsPage } from '../features/announcements/AnnouncementsPage.js';
import { ClubsPage } from '../features/clubs/ClubsPage.js';
import { EventsPage } from '../features/events/EventsPage.js';
import { DiscussionsPage } from '../features/discussions/DiscussionsPage.js';
import { NotificationsPage } from '../features/notifications/NotificationsPage.js';
import { SearchPage } from '../features/search/SearchPage.js';

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
        <Route path="/" element={<DashboardPage />} />

        {/* Academics */}
        <Route path="/attendance" element={<AttendancePage />} />
        <Route
          path="/attendance/mark"
          element={
            <RequirePermission permission={Permission.ATTENDANCE_MARK}>
              <MarkAttendancePage />
            </RequirePermission>
          }
        />
        <Route
          path="/attendance/corrections"
          element={
            <RequirePermission permission={Permission.ATTENDANCE_CORRECTION_REVIEW}>
              <CorrectionsPage />
            </RequirePermission>
          }
        />
        <Route path="/timetable" element={<TimetablePage />} />

        {/* Community */}
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/announcements/:id" element={<AnnouncementsPage />} />
        <Route path="/clubs" element={<ClubsPage />} />
        <Route path="/clubs/:id" element={<ClubsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventsPage />} />
        <Route path="/discussions" element={<DiscussionsPage />} />
        <Route path="/discussions/:id" element={<DiscussionsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/search" element={<SearchPage />} />

        {/* Identity */}
        <Route path="/account" element={<AccountPage />} />
        <Route path="/security" element={<SecurityPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
