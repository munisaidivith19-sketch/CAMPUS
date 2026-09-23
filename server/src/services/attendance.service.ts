/**
 * Attendance: marking, the aggregation math, and the correction workflow.
 *
 * **The math rule, stated once and enforced everywhere below:**
 *
 *     percentage = SUM(present records) / SUM(total conducted records) × 100
 *
 * Percentages are derived exactly once, by `summarize()`, from raw counts. Nothing in this file
 * ever averages two percentages together. That matters because subjects have unequal numbers of
 * conducted periods: a student who attended 1/1 of one subject and 0/20 of another is at 1/21
 * (≈4.8%), not at the mean of 100% and 0% (50%). The repository layer returns counts only, so
 * there is no percentage available to average even by accident.
 *
 * Authorization is two-layered: the route checks the *permission*, and every function here
 * additionally narrows to the caller's academic scope, so holding `attendance:read:scope` never
 * means "read everyone".
 */
import mongoose from 'mongoose';
import {
  ATTENDANCE_WARNING_THRESHOLD,
  AttendanceStatus,
  AuditAction,
  AuditResult,
  CorrectionStatus,
  NotificationType,
  type AttendanceCorrectionDTO,
  type AttendanceOverviewDTO,
  type AttendancePeriodGranularity,
  type AttendanceRecordDTO,
  type AttendanceSummaryDTO,
  type AttendanceTrendPointDTO,
} from '@campusconnect/types';
import type {
  AttendanceCorrectionDecisionInput,
  AttendanceCorrectionRequestInput,
  MarkAttendanceInput,
} from '@campusconnect/validation';
import type { Principal } from '@campusconnect/security';
import {
  attendanceCorrectionRepository,
  attendanceRepository,
  normalizeAttendanceDate,
  type AttendanceCounts,
  type AttendanceRangeFilter,
} from '../repositories/attendance.repository.js';
import { classRepository, subjectRepository } from '../repositories/academics.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { IdLike, PageRequest } from '../repositories/base.repository.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import {
  assertCanViewStudent,
  resolveAcademicScope,
  resolveVisibleClassIds,
} from './scope.service.js';
import type { AttendanceCorrectionDocument } from '../models/AttendanceCorrection.model.js';

/** The ONE place a percentage is derived. Everything else passes counts around. */
export function summarize(
  present: number,
  total: number,
  subject: AttendanceSummaryDTO['subject'] = null,
): AttendanceSummaryDTO {
  const percentage = total === 0 ? 0 : Math.round((present / total) * 10_000) / 100;
  return {
    subject,
    present,
    total,
    percentage,
    // No conducted periods is "no data", not "below threshold" — a student with nothing
    // recorded has not failed to attend anything.
    belowThreshold: total > 0 && percentage < ATTENDANCE_WARNING_THRESHOLD,
  };
}

/** Roll several per-subject count buckets into one overall figure — from COUNTS, not averages. */
export function rollUp(buckets: readonly AttendanceCounts[]): { present: number; total: number } {
  return buckets.reduce(
    (acc, bucket) => ({ present: acc.present + bucket.present, total: acc.total + bucket.total }),
    { present: 0, total: 0 },
  );
}

/** Resolve which student a request is about, and prove the caller may see them. */
async function resolveTargetStudent(
  principal: Principal,
  requestedStudentUserId: string | undefined,
): Promise<string> {
  const targetUserId = requestedStudentUserId ?? principal.userId;

  if (targetUserId === principal.userId) return targetUserId;

  const scope = await resolveAcademicScope(principal);
  await assertCanViewStudent(principal.institutionId, scope, targetUserId);
  return targetUserId;
}

// --- Marking -----------------------------------------------------------------

export interface MarkAttendanceResult {
  marked: number;
  created: number;
  changed: number;
}

/**
 * Mark a roster for one class/date/period.
 *
 * Re-marking is allowed but never silent: the before-state is read first, and any record whose
 * status actually changes produces an `ATTENDANCE_UPDATED` audit entry naming the old and new
 * values. Unchanged rows produce no noise.
 */
export async function markAttendance(
  principal: Principal,
  input: MarkAttendanceInput,
  context: AuditContext,
): Promise<MarkAttendanceResult> {
  const { institutionId } = principal;

  const klass = await classRepository.findById(institutionId, input.classId);
  // A class outside the tenant is simply absent.
  if (!klass) throw Errors.notFound();

  // Only the assigned faculty may mark, unless the caller's scope covers the class
  // (an HOD covering for a colleague, say). Scope is resolved, never assumed.
  const scope = await resolveAcademicScope(principal);
  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);
  const classId = String(klass._id);
  if (visibleClassIds !== null && !visibleClassIds.includes(classId)) {
    throw Errors.forbidden();
  }

  // The roster is structural: the students of this class's section.
  const roster = await studentProfileRepository.listBySection(
    institutionId,
    klass.batch,
    klass.section,
    klass.departmentId,
  );
  const rosterUserIds = new Set(roster.map((profile) => String(profile.userId)));

  // Marking someone who is not in this section is a client error, not a silent no-op.
  const strangers = input.records.filter((record) => !rosterUserIds.has(record.studentUserId));
  if (strangers.length > 0) {
    throw Errors.validation(
      strangers.map((record) => ({
        path: 'records',
        message: `Student ${record.studentUserId} is not in this class`,
      })),
    );
  }

  const date = normalizeAttendanceDate(input.date);
  const before = await attendanceRepository.findExisting(institutionId, classId, date, input.period);
  const previousByStudent = new Map(
    before.map((record) => [String(record.studentUserId), record.status]),
  );

  const result = await attendanceRepository.markRoster({
    institutionId,
    classId,
    subjectId: klass.subjectId,
    date,
    period: input.period,
    markedByUserId: principal.userId,
    records: input.records,
  });

  const changed = input.records.filter((record) => {
    const previous = previousByStudent.get(record.studentUserId);
    return previous !== undefined && previous !== record.status;
  });

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.ATTENDANCE_MARKED,
    resourceType: 'Attendance',
    resourceId: classId,
    result: AuditResult.SUCCESS,
    context,
    reason: `${input.records.length} record(s) for period ${input.period}`,
  });

  // One entry per actual change, so the trail says exactly what moved and from what.
  for (const record of changed) {
    await recordAudit({
      institutionId,
      actorUserId: principal.userId,
      action: AuditAction.ATTENDANCE_UPDATED,
      resourceType: 'Attendance',
      resourceId: record.studentUserId,
      result: AuditResult.SUCCESS,
      context,
      reason: `${previousByStudent.get(record.studentUserId)} -> ${record.status} (period ${input.period})`,
    });
  }

  // Tell students whose mark changed under them; a silent change is the thing students dispute.
  if (changed.length > 0) {
    await notifyUsers(
      institutionId,
      changed.map((record) => record.studentUserId),
      {
        type: NotificationType.ATTENDANCE,
        title: 'Attendance updated',
        body: `Your attendance for period ${input.period} was updated.`,
        link: '/attendance',
      },
    );
  }

  return { marked: input.records.length, created: result.inserted, changed: changed.length };
}

/** The roster a faculty member marks against, with anything already recorded for that period. */
export async function getClassRoster(
  principal: Principal,
  classId: string,
  date: Date,
  period: number,
): Promise<{
  classId: string;
  subject: { id: string; code: string; name: string } | null;
  date: string;
  period: number;
  students: Array<{
    userId: string;
    rollNo: string;
    fullName: string;
    status: AttendanceStatus | null;
  }>;
}> {
  const { institutionId } = principal;

  const klass = await classRepository.findById(institutionId, classId);
  if (!klass) throw Errors.notFound();

  const scope = await resolveAcademicScope(principal);
  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);
  if (visibleClassIds !== null && !visibleClassIds.includes(String(klass._id))) {
    throw Errors.notFound();
  }

  const [roster, subject, existing] = await Promise.all([
    studentProfileRepository.listBySection(institutionId, klass.batch, klass.section, klass.departmentId),
    subjectRepository.findById(institutionId, klass.subjectId),
    attendanceRepository.findExisting(institutionId, String(klass._id), date, period),
  ]);

  const statusByStudent = new Map(existing.map((row) => [String(row.studentUserId), row.status]));
  const users = await userRepository.listUsers(institutionId, { page: 1, limit: 300 });
  const nameByUserId = new Map(users.items.map((user) => [String(user._id), user.fullName]));

  return {
    classId: String(klass._id),
    subject: subject
      ? { id: String(subject._id), code: subject.code, name: subject.name }
      : null,
    date: normalizeAttendanceDate(date).toISOString(),
    period,
    students: roster.map((profile) => ({
      userId: String(profile.userId),
      rollNo: profile.rollNo,
      fullName: nameByUserId.get(String(profile.userId)) ?? 'Unknown',
      status: statusByStudent.get(String(profile.userId)) ?? null,
    })),
  };
}

// --- Student-facing aggregates ------------------------------------------------

/**
 * A student's attendance overview: per subject plus an overall roll-up.
 *
 * The overall figure is computed from summed COUNTS across subjects — never from the per-subject
 * percentages sitting right next to it in the response.
 */
export async function getAttendanceOverview(
  principal: Principal,
  requestedStudentUserId: string | undefined,
  range: AttendanceRangeFilter = {},
): Promise<AttendanceOverviewDTO> {
  const { institutionId } = principal;
  const studentUserId = await resolveTargetStudent(principal, requestedStudentUserId);

  const counts = await attendanceRepository.countsBySubject(institutionId, studentUserId, range);

  const subjects = await subjectRepository.findManyByIds(
    institutionId,
    counts.map((bucket) => bucket.key).filter((key): key is string => key !== null),
  );
  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));

  const bySubject = counts.map((bucket) => {
    const subject = bucket.key ? subjectById.get(bucket.key) : undefined;
    return summarize(
      bucket.present,
      bucket.total,
      subject ? { id: String(subject._id), code: subject.code, name: subject.name } : null,
    );
  });

  const totals = rollUp(counts);
  const overall = summarize(totals.present, totals.total);

  return {
    overall,
    bySubject: bySubject.sort((a, b) => (a.subject?.code ?? '').localeCompare(b.subject?.code ?? '')),
    threshold: ATTENDANCE_WARNING_THRESHOLD,
    warning: overall.belowThreshold,
  };
}

export async function getAttendanceTrend(
  principal: Principal,
  requestedStudentUserId: string | undefined,
  granularity: AttendancePeriodGranularity,
  range: AttendanceRangeFilter = {},
): Promise<AttendanceTrendPointDTO[]> {
  const { institutionId } = principal;
  const studentUserId = await resolveTargetStudent(principal, requestedStudentUserId);

  const buckets = await attendanceRepository.countsByPeriodBucket(
    institutionId,
    studentUserId,
    granularity,
    range,
  );

  return buckets.map((bucket) => {
    const summary = summarize(bucket.present, bucket.total);
    return {
      bucket: bucket.key ?? 'ALL',
      present: bucket.present,
      total: bucket.total,
      percentage: summary.percentage,
    };
  });
}

export async function listAttendanceRecords(
  principal: Principal,
  page: PageRequest,
  filters: {
    classId?: string;
    subjectId?: string;
    studentUserId?: string;
  } & AttendanceRangeFilter,
): Promise<{ items: AttendanceRecordDTO[]; total: number }> {
  const { institutionId } = principal;
  const scope = await resolveAcademicScope(principal);

  // A student may only ever list their own rows.
  const isSelfOnly = scope.institutionWide === false && scope.selfUserId !== null && scope.classIds.length === 0 && scope.sections.length === 0 && scope.departmentIds.length === 0;
  if (isSelfOnly && filters.studentUserId && filters.studentUserId !== principal.userId) {
    throw Errors.notFound();
  }

  const effectiveFilters = { ...filters };
  if (isSelfOnly) effectiveFilters.studentUserId = principal.userId;
  else if (filters.studentUserId) {
    await assertCanViewStudent(institutionId, scope, filters.studentUserId);
  }

  const visibleClassIds = isSelfOnly ? null : await resolveVisibleClassIds(institutionId, scope);

  const result = await attendanceRepository.list(institutionId, page, {
    ...effectiveFilters,
    visibleClassIds,
  });

  const subjects = await subjectRepository.findManyByIds(
    institutionId,
    [...new Set(result.items.map((row) => String(row.subjectId)))],
  );
  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));

  return {
    items: result.items.map((row) => {
      const subject = subjectById.get(String(row.subjectId));
      return {
        id: String(row._id),
        classId: String(row.classId),
        subject: subject
          ? { id: String(subject._id), code: subject.code, name: subject.name }
          : { id: String(row.subjectId), code: '?', name: 'Unknown subject' },
        studentUserId: String(row.studentUserId),
        date: row.date.toISOString(),
        period: row.period,
        status: row.status,
        markedByUserId: String(row.markedByUserId),
      };
    }),
    total: result.total,
  };
}

/**
 * Per-student attendance across the caller's scope — the mentor/HOD/principal roster view.
 * Aggregated in the database so a large cohort never ships raw rows to a dashboard.
 */
export async function getScopeAttendanceSummary(
  principal: Principal,
  range: AttendanceRangeFilter = {},
): Promise<{
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
}> {
  const { institutionId } = principal;
  const scope = await resolveAcademicScope(principal);
  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);

  const counts = await attendanceRepository.countsByStudent(institutionId, visibleClassIds, range);

  const studentUserIds = counts.map((bucket) => bucket.key).filter((key): key is string => key !== null);
  const [profiles, users] = await Promise.all([
    studentProfileRepository.findManyByUserIds(institutionId, studentUserIds),
    userRepository.listUsers(institutionId, { page: 1, limit: 300 }),
  ]);

  const profileByUserId = new Map(profiles.map((profile) => [String(profile.userId), profile]));
  const nameByUserId = new Map(users.items.map((user) => [String(user._id), user.fullName]));

  const students = counts.map((bucket) => {
    const summary = summarize(bucket.present, bucket.total);
    const userId = bucket.key ?? '';
    return {
      userId,
      fullName: nameByUserId.get(userId) ?? 'Unknown',
      rollNo: profileByUserId.get(userId)?.rollNo ?? null,
      present: bucket.present,
      total: bucket.total,
      percentage: summary.percentage,
      belowThreshold: summary.belowThreshold,
    };
  });

  return {
    threshold: ATTENDANCE_WARNING_THRESHOLD,
    students: students.sort((a, b) => a.percentage - b.percentage),
  };
}

// --- Corrections --------------------------------------------------------------

async function toCorrectionDTO(
  institutionId: string,
  correction: AttendanceCorrectionDocument,
): Promise<AttendanceCorrectionDTO> {
  const [attendance, requester] = await Promise.all([
    attendanceRepository.findById(institutionId, correction.attendanceId),
    userRepository.findById(institutionId, correction.requestedByUserId),
  ]);

  const subject = attendance
    ? await subjectRepository.findById(institutionId, attendance.subjectId)
    : null;

  return {
    id: String(correction._id),
    attendanceId: String(correction.attendanceId),
    requestedByUserId: String(correction.requestedByUserId),
    requestedByName: requester?.fullName ?? 'Unknown',
    subject: subject ? { id: String(subject._id), code: subject.code, name: subject.name } : null,
    date: attendance ? attendance.date.toISOString() : '',
    period: attendance?.period ?? 0,
    oldValue: correction.oldValue,
    newValue: correction.newValue,
    reason: correction.reason,
    status: correction.status,
    reviewedByUserId: correction.reviewedByUserId ? String(correction.reviewedByUserId) : null,
    reviewNote: correction.reviewNote ?? null,
    decidedAt: correction.decidedAt ? correction.decidedAt.toISOString() : null,
    createdAt: correction.createdAt.toISOString(),
  };
}

/** A student disputes one of their own records. They may not request a change to anyone else's. */
export async function requestCorrection(
  principal: Principal,
  input: AttendanceCorrectionRequestInput,
  context: AuditContext,
): Promise<AttendanceCorrectionDTO> {
  const { institutionId } = principal;

  const attendance = await attendanceRepository.findById(institutionId, input.attendanceId);
  if (!attendance) throw Errors.notFound();

  // Ownership: the record must be the caller's own.
  if (String(attendance.studentUserId) !== principal.userId) throw Errors.notFound();

  if (attendance.status === input.newValue) {
    throw Errors.validation([
      { path: 'newValue', message: 'That is already the recorded value.' },
    ]);
  }

  let correction: AttendanceCorrectionDocument;
  try {
    correction = await attendanceCorrectionRepository.create({
      institutionId,
      attendanceId: input.attendanceId,
      classId: attendance.classId,
      requestedByUserId: principal.userId,
      // Captured now, so the trail shows what the record said when it was disputed.
      oldValue: attendance.status,
      newValue: input.newValue,
      reason: input.reason,
    });
  } catch (err) {
    // The partial unique index rejects a second open request for the same record.
    if ((err as { code?: number }).code === 11000) {
      throw Errors.conflict('You already have a pending request for this record.');
    }
    throw err;
  }

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.ATTENDANCE_CORRECTION_REQUESTED,
    resourceType: 'AttendanceCorrection',
    resourceId: String(correction._id),
    result: AuditResult.SUCCESS,
    context,
    reason: `${attendance.status} -> ${input.newValue}`,
  });

  // Let the class's faculty know there is something to review.
  const klass = await classRepository.findById(institutionId, attendance.classId);
  if (klass?.facultyUserId) {
    await notifyUsers(institutionId, [String(klass.facultyUserId)], {
      type: NotificationType.ATTENDANCE,
      title: 'Attendance correction requested',
      body: 'A student has requested a correction to an attendance record.',
      link: '/attendance/corrections',
    });
  }

  return toCorrectionDTO(institutionId, correction);
}

/**
 * Approve or reject a correction.
 *
 * Approval is transactional: the decision and the attendance record move together, so a failure
 * cannot leave a request marked APPROVED while the record it was meant to fix is unchanged.
 * MongoDB runs as a replica set precisely so this is available (ADR-0001 / compose).
 */
export async function decideCorrection(
  principal: Principal,
  correctionId: string,
  input: AttendanceCorrectionDecisionInput,
  context: AuditContext,
): Promise<AttendanceCorrectionDTO> {
  const { institutionId } = principal;

  const correction = await attendanceCorrectionRepository.findById(institutionId, correctionId);
  if (!correction) throw Errors.notFound();

  // The reviewer must have the class in scope — a mentor cannot decide another section's cases.
  const scope = await resolveAcademicScope(principal);
  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);
  if (visibleClassIds !== null && !visibleClassIds.includes(String(correction.classId))) {
    throw Errors.notFound();
  }

  if (correction.status !== CorrectionStatus.PENDING) {
    throw Errors.conflict('This request has already been decided.');
  }

  const approving = input.decision === CorrectionStatus.APPROVED;
  let decided: AttendanceCorrectionDocument | null = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      decided = await attendanceCorrectionRepository.decide(
        institutionId,
        correctionId,
        input.decision,
        principal.userId,
        input.note ?? null,
        session,
      );

      // Lost the race to another reviewer: abort rather than apply a second decision.
      if (!decided) throw Errors.conflict('This request has already been decided.');

      if (approving) {
        const updated = await attendanceRepository.applyCorrection(
          institutionId,
          correction.attendanceId,
          correction.newValue,
          principal.userId,
          session,
        );
        if (!updated) throw Errors.notFound();
      }
    });
  } finally {
    await session.endSession();
  }

  if (!decided) throw Errors.conflict('This request has already been decided.');
  const settled: AttendanceCorrectionDocument = decided;

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.ATTENDANCE_CORRECTION_DECIDED,
    resourceType: 'AttendanceCorrection',
    resourceId: String(settled._id),
    result: AuditResult.SUCCESS,
    context,
    // The trail carries the original value, the new value, the actor and the outcome.
    reason: `${input.decision}: ${correction.oldValue} -> ${correction.newValue}`,
  });

  await notifyUsers(institutionId, [String(correction.requestedByUserId)], {
    type: NotificationType.ATTENDANCE,
    title: `Attendance correction ${approving ? 'approved' : 'rejected'}`,
    body: approving
      ? 'Your attendance record has been corrected.'
      : 'Your correction request was not approved.',
    link: '/attendance',
  });

  logger.info(
    { correctionId: String(settled._id), decision: input.decision },
    'Attendance correction decided',
  );

  return toCorrectionDTO(institutionId, settled);
}

export async function listCorrectionsForReviewer(
  principal: Principal,
  page: PageRequest,
  status?: CorrectionStatus,
): Promise<{ items: AttendanceCorrectionDTO[]; total: number }> {
  const { institutionId } = principal;
  const scope = await resolveAcademicScope(principal);
  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);

  const result = await attendanceCorrectionRepository.listForReviewer(
    institutionId,
    page,
    visibleClassIds,
    status,
  );

  return {
    items: await Promise.all(result.items.map((row) => toCorrectionDTO(institutionId, row))),
    total: result.total,
  };
}

export async function listOwnCorrections(
  principal: Principal,
  page: PageRequest,
  status?: CorrectionStatus,
): Promise<{ items: AttendanceCorrectionDTO[]; total: number }> {
  const { institutionId } = principal;
  const result = await attendanceCorrectionRepository.listForStudent(
    institutionId,
    principal.userId,
    page,
    status,
  );

  return {
    items: await Promise.all(result.items.map((row) => toCorrectionDTO(institutionId, row))),
    total: result.total,
  };
}

export { AttendanceStatus };
export type { IdLike };
