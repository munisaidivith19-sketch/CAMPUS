/**
 * Academics request schemas (Phase 3).
 *
 * Note what is NOT accepted from the client: `markAttendanceSchema` takes no `institutionId`,
 * no `markedByUserId` and no percentage — the tenant and the marker come from the principal,
 * and every aggregate is derived server-side from stored records. A client can state what it
 * observed, never what the totals are.
 */
import { z } from 'zod';
import { AttendanceStatus, CorrectionStatus, DayOfWeek } from '@campusconnect/types';
import { objectIdSchema, paginationQuerySchema } from './common.js';

export const attendanceStatusSchema = z.nativeEnum(AttendanceStatus);
export const dayOfWeekSchema = z.nativeEnum(DayOfWeek);

/** Periods in a teaching day. Bounded so a typo cannot create period 9999. */
export const periodSchema = z.coerce.number().int().min(1).max(12);

/**
 * Marking is submitted per class/date/period for a roster of students in one call, which is how
 * a faculty member actually takes attendance — and makes the whole roster one atomic decision
 * rather than a race of individual writes.
 */
export const markAttendanceSchema = z.object({
  classId: objectIdSchema,
  date: z.coerce.date(),
  period: periodSchema,
  records: z
    .array(
      z.object({
        studentUserId: objectIdSchema,
        status: attendanceStatusSchema,
      }),
    )
    .min(1, 'Mark at least one student')
    .max(300, 'Too many students in one submission'),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const attendanceGranularitySchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'SEMESTER']);

/** Allowlisted filters only — arbitrary query operators are never accepted (API.md). */
export const attendanceQuerySchema = paginationQuerySchema.extend({
  classId: objectIdSchema.optional(),
  subjectId: objectIdSchema.optional(),
  studentUserId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const attendanceSummaryQuerySchema = z.object({
  studentUserId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const attendanceTrendQuerySchema = z.object({
  studentUserId: objectIdSchema.optional(),
  granularity: attendanceGranularitySchema.default('WEEKLY'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const classQuerySchema = paginationQuerySchema.extend({
  departmentId: objectIdSchema.optional(),
  subjectId: objectIdSchema.optional(),
  batch: z.string().trim().max(20).optional(),
  section: z.string().trim().max(10).optional(),
});

export const subjectQuerySchema = paginationQuerySchema.extend({
  departmentId: objectIdSchema.optional(),
});

export const timetableQuerySchema = z.object({
  classId: objectIdSchema.optional(),
  batch: z.string().trim().max(20).optional(),
  section: z.string().trim().max(10).optional(),
  /** Faculty members ask for their own teaching schedule with `scope=faculty`. */
  scope: z.enum(['SECTION', 'FACULTY']).optional(),
});

/** A student asks for a record to be changed; they may not set the outcome. */
export const attendanceCorrectionRequestSchema = z.object({
  attendanceId: objectIdSchema,
  newValue: attendanceStatusSchema,
  reason: z.string().trim().min(10, 'Explain why the record is wrong').max(500),
});
export type AttendanceCorrectionRequestInput = z.infer<typeof attendanceCorrectionRequestSchema>;

export const attendanceCorrectionDecisionSchema = z.object({
  decision: z.enum([CorrectionStatus.APPROVED, CorrectionStatus.REJECTED]),
  note: z.string().trim().max(500).optional(),
});
export type AttendanceCorrectionDecisionInput = z.infer<typeof attendanceCorrectionDecisionSchema>;

export const correctionQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(CorrectionStatus).optional(),
});

export const assignFacultySchema = z.object({ facultyUserId: objectIdSchema });

/** The roster a faculty member marks against, for one class/date/period. */
export const rosterQuerySchema = z.object({
  date: z.coerce.date(),
  period: periodSchema,
});
