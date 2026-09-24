/**
 * The identity API slice (RTK Query).
 *
 * Types come from `@campusconnect/types`, which is the same module the server builds its
 * responses from — so a contract change breaks the build on both sides at once instead of
 * failing silently at runtime.
 */
import { createApi } from '@reduxjs/toolkit/query/react';
import type {
  FacultyProfileDTO,
  LoginHistoryDTO,
  LoginResponseDTO,
  MfaEnrollDTO,
  SessionDTO,
  StudentIdDTO,
  StudentProfileDTO,
  UserDTO,
} from '@campusconnect/types';
import { axiosBaseQuery } from './axiosBaseQuery.js';

export interface SecurityOverview {
  mfaEnabled: boolean;
  activeSessions: SessionDTO[];
  recentLogins: LoginHistoryDTO[];
  failedAttemptsLast7Days: number;
}

export type MyProfile =
  { type: 'STUDENT'; profile: StudentProfileDTO } | { type: 'FACULTY'; profile: FacultyProfileDTO };

export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery: axiosBaseQuery(),
  tagTypes: ['Me', 'Sessions', 'Security', 'LoginHistory', 'StudentId'],
  endpoints: (builder) => ({
    // --- Public auth flows ---------------------------------------------------
    login: builder.mutation<LoginResponseDTO, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', data: body }),
      invalidatesTags: ['Me', 'Sessions', 'Security'],
    }),
    register: builder.mutation<
      { status: string },
      { email: string; password: string; fullName: string }
    >({
      query: (body) => ({ url: '/auth/register', method: 'POST', data: body }),
    }),
    verifyEmail: builder.mutation<{ status: string }, { token: string }>({
      query: (body) => ({ url: '/auth/verify-email', method: 'POST', data: body }),
    }),
    forgotPassword: builder.mutation<{ status: string }, { email: string }>({
      query: (body) => ({ url: '/auth/forgot-password', method: 'POST', data: body }),
    }),
    resetPassword: builder.mutation<{ status: string }, { token: string; password: string }>({
      query: (body) => ({ url: '/auth/reset-password', method: 'POST', data: body }),
    }),
    verifyMfa: builder.mutation<LoginResponseDTO, { challengeId: string; code: string }>({
      query: (body) => ({ url: '/auth/mfa/verify', method: 'POST', data: body }),
      invalidatesTags: ['Me', 'Sessions', 'Security'],
    }),
    verifyDevice: builder.mutation<LoginResponseDTO, { challengeId: string; code: string }>({
      query: (body) => ({ url: '/auth/device/verify', method: 'POST', data: body }),
      invalidatesTags: ['Me', 'Sessions', 'Security'],
    }),
    logout: builder.mutation<{ status: string }, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      invalidatesTags: ['Me', 'Sessions', 'Security'],
    }),

    // --- Authenticated identity ---------------------------------------------
    getMe: builder.query<UserDTO, void>({
      query: () => ({ url: '/me' }),
      providesTags: ['Me'],
    }),
    updateMe: builder.mutation<UserDTO, { fullName?: string; phone?: string }>({
      query: (body) => ({ url: '/me', method: 'PATCH', data: body }),
      invalidatesTags: ['Me'],
    }),
    getMyProfile: builder.query<MyProfile, void>({
      query: () => ({ url: '/me/profile' }),
    }),
    getSessions: builder.query<SessionDTO[], void>({
      query: () => ({ url: '/me/sessions' }),
      providesTags: ['Sessions'],
    }),
    revokeSession: builder.mutation<{ status: string }, string>({
      query: (id) => ({ url: `/me/sessions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Sessions', 'Security'],
    }),
    revokeOtherSessions: builder.mutation<{ status: string; revoked: number }, void>({
      query: () => ({ url: '/me/sessions/revoke-others', method: 'POST' }),
      invalidatesTags: ['Sessions', 'Security'],
    }),
    getLoginHistory: builder.query<LoginHistoryDTO[], { page?: number; limit?: number } | void>({
      query: (params) => ({ url: '/me/login-history', params: params ?? { page: 1, limit: 20 } }),
      providesTags: ['LoginHistory'],
    }),
    getSecurityOverview: builder.query<SecurityOverview, void>({
      query: () => ({ url: '/me/security' }),
      providesTags: ['Security'],
    }),

    // --- Student ID + MFA management ----------------------------------------
    getStudentId: builder.query<StudentIdDTO, void>({
      query: () => ({ url: '/me/student-id' }),
      providesTags: ['StudentId'],
    }),
    issueStudentIdQr: builder.mutation<
      { token: string; expiresAt: string; qrDataUrl: string },
      void
    >({
      query: () => ({ url: '/me/student-id/qr', method: 'POST' }),
    }),
    enrollMfa: builder.mutation<MfaEnrollDTO, void>({
      query: () => ({ url: '/me/mfa/enroll', method: 'POST' }),
    }),
    confirmMfa: builder.mutation<{ status: string }, { code: string }>({
      query: (body) => ({ url: '/me/mfa/confirm', method: 'POST', data: body }),
      invalidatesTags: ['Me', 'Security'],
    }),
    disableMfa: builder.mutation<{ status: string }, { password: string }>({
      query: (body) => ({ url: '/me/mfa/disable', method: 'POST', data: body }),
      invalidatesTags: ['Me', 'Security'],
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useVerifyEmailMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useVerifyMfaMutation,
  useVerifyDeviceMutation,
  useLogoutMutation,
  useGetMeQuery,
  useUpdateMeMutation,
  useGetMyProfileQuery,
  useGetSessionsQuery,
  useRevokeSessionMutation,
  useRevokeOtherSessionsMutation,
  useGetLoginHistoryQuery,
  useGetSecurityOverviewQuery,
  useGetStudentIdQuery,
  useIssueStudentIdQrMutation,
  useEnrollMfaMutation,
  useConfirmMfaMutation,
  useDisableMfaMutation,
} = authApi;
