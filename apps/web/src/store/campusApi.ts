/**
 * The Phase 3 API slice: academics and community.
 *
 * Kept separate from `authApi` so identity concerns and campus data stay apart, but it runs
 * through the same axios instance, so it inherits the silent 401-refresh behaviour without
 * knowing anything about it.
 *
 * Types are imported from `@campusconnect/types` — the same module the server builds its
 * responses from, so a contract change breaks both sides of the build at once.
 */
import { createApi } from '@reduxjs/toolkit/query/react';
import type {
  AnnouncementDTO,
  AttendanceCorrectionDTO,
  AttendanceOverviewDTO,
  AttendanceRecordDTO,
  AttendanceStatus,
  AttendanceTrendPointDTO,
  ClassDTO,
  ClubDTO,
  ClubMembershipDTO,
  CommentDTO,
  DiscussionDTO,
  EventDTO,
  EventRegistrationDTO,
  NotificationDTO,
  SearchResultDTO,
  SubjectDTO,
  TimetableDTO,
} from '@campusconnect/types';
import { axiosBaseQuery } from './axiosBaseQuery.js';

/** The per-student cohort view a mentor, HOD or principal sees. */
export interface ScopeAttendanceSummary {
  threshold: number;
  students: Array<{
    userId: string;
    fullName: string;
    rollNo: string | null;
    present: number;
    total: number;
    percentage: number;
    belowThreshold: boolean;
  }>;
}

export interface ClassRoster {
  classId: string;
  subject: { id: string; code: string; name: string } | null;
  date: string;
  period: number;
  students: Array<{ userId: string; rollNo: string; fullName: string; status: AttendanceStatus | null }>;
}

export interface ModerationQueue {
  discussions: DiscussionDTO[];
  comments: CommentDTO[];
}

export const campusApi = createApi({
  reducerPath: 'campusApi',
  baseQuery: axiosBaseQuery(),
  tagTypes: [
    'Attendance',
    'Corrections',
    'Classes',
    'Timetable',
    'Announcements',
    'Clubs',
    'Events',
    'Discussions',
    'Comments',
    'Notifications',
    'Moderation',
  ],
  endpoints: (builder) => ({
    // --- Academics -----------------------------------------------------------
    getSubjects: builder.query<SubjectDTO[], void>({
      query: () => ({ url: '/subjects', params: { limit: 100 } }),
    }),
    getClasses: builder.query<ClassDTO[], void>({
      query: () => ({ url: '/classes', params: { limit: 100 } }),
      providesTags: ['Classes'],
    }),
    getTimetable: builder.query<TimetableDTO, { scope?: 'SECTION' | 'FACULTY' } | void>({
      query: (args) => ({ url: '/timetable', params: args ?? undefined }),
      providesTags: ['Timetable'],
    }),

    // --- Attendance ----------------------------------------------------------
    getAttendanceSummary: builder.query<AttendanceOverviewDTO, { studentUserId?: string } | void>({
      query: (args) => ({ url: '/attendance/summary', params: args ?? undefined }),
      providesTags: ['Attendance'],
    }),
    getAttendanceTrend: builder.query<
      AttendanceTrendPointDTO[],
      { granularity?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEMESTER' } | void
    >({
      query: (args) => ({ url: '/attendance/trend', params: args ?? { granularity: 'WEEKLY' } }),
      providesTags: ['Attendance'],
    }),
    getAttendanceRecords: builder.query<AttendanceRecordDTO[], { limit?: number } | void>({
      query: (args) => ({ url: '/attendance', params: { limit: args?.limit ?? 50 } }),
      providesTags: ['Attendance'],
    }),
    getScopeAttendance: builder.query<ScopeAttendanceSummary, void>({
      query: () => ({ url: '/attendance/scope-summary' }),
      providesTags: ['Attendance'],
    }),
    getClassRoster: builder.query<ClassRoster, { classId: string; date: string; period: number }>({
      query: ({ classId, date, period }) => ({
        url: `/attendance/roster/${classId}`,
        params: { date, period },
      }),
      providesTags: ['Attendance'],
    }),
    markAttendance: builder.mutation<
      { marked: number; created: number; changed: number },
      {
        classId: string;
        date: string;
        period: number;
        records: Array<{ studentUserId: string; status: AttendanceStatus }>;
      }
    >({
      query: (body) => ({ url: '/attendance', method: 'POST', data: body }),
      invalidatesTags: ['Attendance'],
    }),

    // --- Corrections ---------------------------------------------------------
    getMyCorrections: builder.query<AttendanceCorrectionDTO[], void>({
      query: () => ({ url: '/attendance/corrections/mine', params: { limit: 50 } }),
      providesTags: ['Corrections'],
    }),
    getCorrectionQueue: builder.query<AttendanceCorrectionDTO[], { status?: string } | void>({
      query: (args) => ({ url: '/attendance/corrections', params: { limit: 50, ...(args ?? {}) } }),
      providesTags: ['Corrections'],
    }),
    requestCorrection: builder.mutation<
      AttendanceCorrectionDTO,
      { attendanceId: string; newValue: AttendanceStatus; reason: string }
    >({
      query: (body) => ({ url: '/attendance/corrections', method: 'POST', data: body }),
      invalidatesTags: ['Corrections'],
    }),
    decideCorrection: builder.mutation<
      AttendanceCorrectionDTO,
      { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/attendance/corrections/${id}`,
        method: 'PATCH',
        data: body,
      }),
      invalidatesTags: ['Corrections', 'Attendance'],
    }),

    // --- Announcements -------------------------------------------------------
    getAnnouncements: builder.query<AnnouncementDTO[], { unreadOnly?: boolean } | void>({
      query: (args) => ({
        url: '/announcements',
        params: { limit: 30, ...(args?.unreadOnly ? { unreadOnly: 'true' } : {}) },
      }),
      providesTags: ['Announcements'],
    }),
    getAnnouncement: builder.query<AnnouncementDTO, string>({
      query: (id) => ({ url: `/announcements/${id}` }),
      providesTags: ['Announcements'],
    }),
    createAnnouncement: builder.mutation<AnnouncementDTO, Record<string, unknown>>({
      query: (body) => ({ url: '/announcements', method: 'POST', data: body }),
      invalidatesTags: ['Announcements', 'Notifications'],
    }),

    // --- Clubs ---------------------------------------------------------------
    getClubs: builder.query<ClubDTO[], { suggested?: boolean } | void>({
      query: (args) => ({
        url: '/clubs',
        params: { limit: 50, ...(args?.suggested ? { suggested: 'true' } : {}) },
      }),
      providesTags: ['Clubs'],
    }),
    joinClub: builder.mutation<ClubMembershipDTO, string>({
      query: (id) => ({ url: `/clubs/${id}/join`, method: 'POST' }),
      invalidatesTags: ['Clubs'],
    }),

    // --- Events --------------------------------------------------------------
    getEvents: builder.query<EventDTO[], { suggested?: boolean; upcomingOnly?: boolean } | void>({
      query: (args) => ({
        url: '/events',
        params: {
          limit: 50,
          ...(args?.suggested ? { suggested: 'true' } : {}),
          ...(args?.upcomingOnly ? { upcomingOnly: 'true' } : {}),
        },
      }),
      providesTags: ['Events'],
    }),
    registerForEvent: builder.mutation<EventRegistrationDTO, string>({
      query: (id) => ({ url: `/events/${id}/register`, method: 'POST' }),
      invalidatesTags: ['Events'],
    }),
    issueEventQr: builder.mutation<{ token: string; expiresAt: string; qrDataUrl: string }, string>({
      query: (id) => ({ url: `/events/${id}/qr`, method: 'POST' }),
    }),
    checkInAttendee: builder.mutation<
      { eventTitle: string; attendee: { fullName: string; rollNo: string | null } },
      { eventId: string; token: string }
    >({
      query: ({ eventId, token }) => ({
        url: `/events/${eventId}/check-in`,
        method: 'POST',
        data: { token },
      }),
      invalidatesTags: ['Events'],
    }),

    // --- Discussions ---------------------------------------------------------
    getDiscussions: builder.query<DiscussionDTO[], void>({
      query: () => ({ url: '/discussions', params: { limit: 30 } }),
      providesTags: ['Discussions'],
    }),
    getDiscussion: builder.query<DiscussionDTO, string>({
      query: (id) => ({ url: `/discussions/${id}` }),
      providesTags: ['Discussions'],
    }),
    createDiscussion: builder.mutation<
      DiscussionDTO,
      { title: string; body: string; category: string; tags: string[] }
    >({
      query: (body) => ({ url: '/discussions', method: 'POST', data: body }),
      invalidatesTags: ['Discussions'],
    }),
    getComments: builder.query<CommentDTO[], string>({
      query: (id) => ({ url: `/discussions/${id}/comments`, params: { limit: 100 } }),
      providesTags: ['Comments'],
    }),
    addComment: builder.mutation<CommentDTO, { discussionId: string; body: string }>({
      query: ({ discussionId, body }) => ({
        url: `/discussions/${discussionId}/comments`,
        method: 'POST',
        data: { body },
      }),
      invalidatesTags: ['Comments', 'Discussions'],
    }),
    toggleReaction: builder.mutation<CommentDTO, string>({
      query: (id) => ({ url: `/comments/${id}/reactions`, method: 'POST' }),
      invalidatesTags: ['Comments'],
    }),
    reportContent: builder.mutation<
      { status: string },
      { targetType: 'DISCUSSION' | 'COMMENT'; targetId: string; reason: string }
    >({
      query: (body) => ({ url: '/reports', method: 'POST', data: body }),
      invalidatesTags: ['Discussions', 'Comments', 'Moderation'],
    }),

    // --- Notifications & search ----------------------------------------------
    getNotifications: builder.query<NotificationDTO[], { unreadOnly?: boolean } | void>({
      query: (args) => ({
        url: '/notifications',
        params: { limit: 30, ...(args?.unreadOnly ? { unreadOnly: 'true' } : {}) },
      }),
      providesTags: ['Notifications'],
    }),
    markNotificationRead: builder.mutation<{ status: string }, string>({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'PATCH' }),
      invalidatesTags: ['Notifications'],
    }),
    markAllNotificationsRead: builder.mutation<{ count: number }, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),
      invalidatesTags: ['Notifications'],
    }),
    search: builder.query<SearchResultDTO[], string>({
      query: (q) => ({ url: '/search', params: { q, limit: 30 } }),
    }),
  }),
});

export const {
  useGetSubjectsQuery,
  useGetClassesQuery,
  useGetTimetableQuery,
  useGetAttendanceSummaryQuery,
  useGetAttendanceTrendQuery,
  useGetAttendanceRecordsQuery,
  useGetScopeAttendanceQuery,
  useGetClassRosterQuery,
  useMarkAttendanceMutation,
  useGetMyCorrectionsQuery,
  useGetCorrectionQueueQuery,
  useRequestCorrectionMutation,
  useDecideCorrectionMutation,
  useGetAnnouncementsQuery,
  useGetAnnouncementQuery,
  useCreateAnnouncementMutation,
  useGetClubsQuery,
  useJoinClubMutation,
  useGetEventsQuery,
  useRegisterForEventMutation,
  useIssueEventQrMutation,
  useCheckInAttendeeMutation,
  useGetDiscussionsQuery,
  useGetDiscussionQuery,
  useCreateDiscussionMutation,
  useGetCommentsQuery,
  useAddCommentMutation,
  useToggleReactionMutation,
  useReportContentMutation,
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useSearchQuery,
} = campusApi;
