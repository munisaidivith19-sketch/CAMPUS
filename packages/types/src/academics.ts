/**
 * Academics contracts (Phase 3): subjects, classes, timetable, attendance and corrections.
 *
 * The attendance DTOs deserve a note. `AttendanceSummaryDTO` reports `present` and `total` as
 * RAW COUNTS alongside the derived percentage, deliberately: a client that wants a combined
 * figure across subjects must re-derive it from the counts, because averaging the per-subject
 * percentages gives a different — and wrong — answer whenever subjects have unequal numbers of
 * conducted periods. The server never averages percentages either (see attendance.service.ts).
 */

export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const CorrectionStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type CorrectionStatus = (typeof CorrectionStatus)[keyof typeof CorrectionStatus];

export const DayOfWeek = {
  MON: 'MON',
  TUE: 'TUE',
  WED: 'WED',
  THU: 'THU',
  FRI: 'FRI',
  SAT: 'SAT',
} as const;
export type DayOfWeek = (typeof DayOfWeek)[keyof typeof DayOfWeek];

export const ALL_DAYS: readonly DayOfWeek[] = Object.values(DayOfWeek);

/** The institution-wide attendance threshold below which a student is flagged. */
export const ATTENDANCE_WARNING_THRESHOLD = 75;

export interface SubjectDTO {
  id: string;
  code: string;
  name: string;
  credits: number;
  departmentId: string | null;
}

export interface ClassDTO {
  id: string;
  subject: { id: string; code: string; name: string };
  departmentId: string | null;
  batch: string;
  section: string;
  faculty: { userId: string; fullName: string } | null;
  studentCount: number;
}

export interface TimetableEntryDTO {
  day: DayOfWeek;
  period: number;
  classId: string;
  subject: { id: string; code: string; name: string };
  facultyName: string | null;
  room: string | null;
}

export interface TimetableDTO {
  /** Whose timetable this is — a section's, or a faculty member's teaching schedule. */
  scope: 'SECTION' | 'FACULTY';
  label: string;
  entries: TimetableEntryDTO[];
}

export interface AttendanceRecordDTO {
  id: string;
  classId: string;
  subject: { id: string; code: string; name: string };
  studentUserId: string;
  date: string;
  period: number;
  status: AttendanceStatus;
  markedByUserId: string;
}

/**
 * Attendance for one subject (or one overall roll-up).
 *
 * `percentage` is computed as present/total — never as a mean of other percentages.
 */
export interface AttendanceSummaryDTO {
  subject: { id: string; code: string; name: string } | null;
  present: number;
  total: number;
  percentage: number;
  belowThreshold: boolean;
}

export interface AttendanceOverviewDTO {
  overall: AttendanceSummaryDTO;
  bySubject: AttendanceSummaryDTO[];
  threshold: number;
  /** True when the OVERALL figure is below the threshold. */
  warning: boolean;
}

export type AttendancePeriodGranularity = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEMESTER';

export interface AttendanceTrendPointDTO {
  bucket: string;
  present: number;
  total: number;
  percentage: number;
}

export interface AttendanceCorrectionDTO {
  id: string;
  attendanceId: string;
  requestedByUserId: string;
  requestedByName: string;
  subject: { id: string; code: string; name: string } | null;
  date: string;
  period: number;
  oldValue: AttendanceStatus;
  newValue: AttendanceStatus;
  reason: string;
  status: CorrectionStatus;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}
