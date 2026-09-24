/**
 * Role dashboards (Phase 3 completion).
 *
 * Every dashboard is an aggregate built server-side and narrowed to the caller's scope — counts
 * plus SHORT lists (each capped), never an unbounded array. Attendance figures follow the
 * SUM/SUM contract: `present` and `total` travel with every percentage, and a combined figure is
 * always re-derived from counts, never averaged from percentages.
 */
import type { AnnouncementPriority } from './community.js';

/** An attendance figure with the counts it was derived from. */
export interface AttendanceFigure {
  present: number;
  total: number;
  /** present / total × 100, rounded to 2 dp; 0 when nothing was conducted. */
  percentage: number;
  belowThreshold: boolean;
}

export interface DashboardClassSlot {
  period: number;
  classId: string;
  subject: { code: string; name: string };
  room: string | null;
  batch?: string;
  section?: string;
  /** Faculty view: whether today's attendance for this slot is already marked. */
  marked?: boolean;
}

export interface DashboardStudentRow {
  userId: string;
  fullName: string;
  rollNo: string | null;
  attendance: AttendanceFigure;
}

export interface StudentDashboardDTO {
  attendance: {
    overall: AttendanceFigure;
    bySubject: Array<{ subject: { code: string; name: string } | null } & AttendanceFigure>;
    threshold: number;
  };
  today: DashboardClassSlot[];
  announcements: {
    unread: number;
    latest: Array<{
      id: string;
      title: string;
      priority: AnnouncementPriority;
      publishAt: string;
      read: boolean;
    }>;
  };
  upcomingEvents: Array<{ id: string; title: string; startsAt: string; venue: string }>;
  clubs: Array<{ id: string; name: string; role: string }>;
  unreadNotifications: number;
  unreadChats: number;
}

export interface FacultyDashboardDTO {
  today: DashboardClassSlot[];
  /** Today's slots with no attendance marked yet. */
  pendingToMark: number;
  corrections: {
    pending: number;
    latest: Array<{
      id: string;
      studentName: string;
      subjectCode: string | null;
      date: string;
      createdAt: string;
    }>;
  };
  classCount: number;
  lowAttendance: DashboardStudentRow[];
  threshold: number;
}

export interface MentorDashboardDTO {
  /** Null when the mentor has no section assigned — the rest is then empty, not wider. */
  section: { batch: string; section: string } | null;
  rosterSize: number;
  sectionAttendance: AttendanceFigure;
  lowAttendance: DashboardStudentRow[];
  pendingCorrections: number;
  recentAnnouncements: Array<{ id: string; title: string; publishAt: string }>;
  threshold: number;
}

export interface HodDashboardDTO {
  department: { id: string; name: string; code: string } | null;
  attendance: AttendanceFigure;
  byClass: Array<
    { classId: string; subjectCode: string; batch: string; section: string } & AttendanceFigure
  >;
  faculty: Array<{ userId: string; fullName: string; classCount: number }>;
  upcomingEvents: Array<{ id: string; title: string; startsAt: string; venue: string }>;
  pendingCorrections: number;
  threshold: number;
}

export interface PrincipalDashboardDTO {
  attendance: AttendanceFigure;
  byDepartment: Array<
    { departmentId: string | null; name: string; code: string } & AttendanceFigure
  >;
  eventsThisMonth: number;
  clubActivity: Array<{
    clubId: string;
    name: string;
    memberCount: number;
    eventsThisMonth: number;
  }>;
  moderationQueue: number;
  security: { activeSessions: number; loginsLast24h: number; failedLoginsLast24h: number };
  threshold: number;
}

export interface ClubAdminDashboardDTO {
  clubs: Array<{
    id: string;
    name: string;
    memberCount: number;
    pendingRequests: number;
    events: Array<{
      id: string;
      title: string;
      startsAt: string;
      capacity: number | null;
      registrations: number;
      checkIns: number;
    }>;
  }>;
}

export const DashboardKind = {
  STUDENT: 'student',
  FACULTY: 'faculty',
  MENTOR: 'mentor',
  HOD: 'hod',
  PRINCIPAL: 'principal',
  CLUB_ADMIN: 'club-admin',
} as const;
export type DashboardKind = (typeof DashboardKind)[keyof typeof DashboardKind];
