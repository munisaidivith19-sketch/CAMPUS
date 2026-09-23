/**
 * Attendance and correction data access, including the aggregation pipelines.
 *
 * **The aggregation contract:** every pipeline returns RAW COUNTS (`present`, `total`) and never
 * a percentage. Percentages are derived once, at the edge of the service layer, from summed
 * counts. This is the structural guarantee behind "never average percentages" — there is simply
 * no percentage in the data layer to average.
 *
 * Every pipeline starts with a `$match` that includes `institutionId`, so the tenant filter is
 * the first stage and can use the tenant-leading indexes (docs/architecture/06-multi-tenancy.md).
 */
import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { AttendanceStatus, CorrectionStatus } from '@campusconnect/types';
import {
  AttendanceModel,
  type AttendanceAttrs,
  type AttendanceDocument,
} from '../models/Attendance.model.js';
import {
  AttendanceCorrectionModel,
  type AttendanceCorrectionAttrs,
  type AttendanceCorrectionDocument,
} from '../models/AttendanceCorrection.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type AttendanceEntity = AttendanceAttrs & Timestamps;
type CorrectionEntity = AttendanceCorrectionAttrs & Timestamps;

/** Raw counts for one grouping key. Deliberately percentage-free. */
export interface AttendanceCounts {
  key: string | null;
  present: number;
  total: number;
}

export interface AttendanceRangeFilter {
  from?: Date;
  to?: Date;
}

/** Normalize a date to UTC midnight so a period is keyed by calendar day, not clock time. */
export function normalizeAttendanceDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateRangeFilter(range: AttendanceRangeFilter): Record<string, Date> | undefined {
  if (!range.from && !range.to) return undefined;
  const filter: Record<string, Date> = {};
  if (range.from) filter.$gte = normalizeAttendanceDate(range.from);
  if (range.to) filter.$lte = normalizeAttendanceDate(range.to);
  return filter;
}

class AttendanceRepository extends TenantRepository<AttendanceEntity> {
  constructor() {
    super(AttendanceModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<AttendanceDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  /**
   * Mark a whole roster for one class/date/period.
   *
   * Uses a bulk upsert keyed on the unique index, so a re-mark updates in place rather than
   * creating a second row. The caller is responsible for auditing which rows actually changed —
   * `findExisting` gives it the before-state to compare against.
   */
  async markRoster(data: {
    institutionId: IdLike;
    classId: IdLike;
    subjectId: IdLike;
    date: Date;
    period: number;
    markedByUserId: IdLike;
    records: Array<{ studentUserId: string; status: AttendanceStatus }>;
  }): Promise<{ inserted: number; updated: number }> {
    const institutionId = requireObjectId(data.institutionId);
    const classId = requireObjectId(data.classId);
    const subjectId = requireObjectId(data.subjectId);
    const markedByUserId = requireObjectId(data.markedByUserId);
    const date = normalizeAttendanceDate(data.date);

    const operations = data.records.map((record) => ({
      updateOne: {
        filter: {
          institutionId,
          classId,
          studentUserId: requireObjectId(record.studentUserId),
          date,
          period: data.period,
        },
        update: {
          $set: { status: record.status, markedByUserId, subjectId },
          $setOnInsert: { institutionId, classId, date, period: data.period },
        },
        upsert: true,
      },
    }));

    const result = await AttendanceModel.bulkWrite(operations, { ordered: false });
    return { inserted: result.upsertedCount, updated: result.modifiedCount };
  }

  /** The before-state for a marking submission, so changes can be audited precisely. */
  async findExisting(
    institutionId: IdLike,
    classId: IdLike,
    date: Date,
    period: number,
  ): Promise<AttendanceDocument[]> {
    return AttendanceModel.find(
      this.scoped(institutionId, {
        classId: requireObjectId(classId),
        date: normalizeAttendanceDate(date),
        period,
      }),
    ).exec();
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: {
      classId?: string;
      subjectId?: string;
      studentUserId?: string;
      visibleClassIds?: string[] | null;
    } & AttendanceRangeFilter,
  ): Promise<Page<AttendanceDocument>> {
    return this.pageScoped(institutionId, this.buildFilter(filters), page, { date: -1, period: 1 });
  }

  /**
   * Per-subject counts for one student.
   *
   * `$group` sums booleans into counts; nothing here divides. Two students with different
   * numbers of conducted periods therefore stay comparable only through their raw totals.
   */
  async countsBySubject(
    institutionId: IdLike,
    studentUserId: IdLike,
    range: AttendanceRangeFilter = {},
  ): Promise<AttendanceCounts[]> {
    const match: Record<string, unknown> = {
      institutionId: requireObjectId(institutionId),
      studentUserId: requireObjectId(studentUserId),
    };
    const dateFilter = dateRangeFilter(range);
    if (dateFilter) match.date = dateFilter;

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          _id: '$subjectId',
          present: {
            $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] },
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const rows = await AttendanceModel.aggregate<{ _id: Types.ObjectId; present: number; total: number }>(
      pipeline,
    ).exec();

    return rows.map((row) => ({ key: String(row._id), present: row.present, total: row.total }));
  }

  /** Time-bucketed counts for the trend view. Buckets are produced by Mongo, not by the client. */
  async countsByPeriodBucket(
    institutionId: IdLike,
    studentUserId: IdLike,
    granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEMESTER',
    range: AttendanceRangeFilter = {},
  ): Promise<AttendanceCounts[]> {
    const match: Record<string, unknown> = {
      institutionId: requireObjectId(institutionId),
      studentUserId: requireObjectId(studentUserId),
    };
    const dateFilter = dateRangeFilter(range);
    if (dateFilter) match.date = dateFilter;

    // SEMESTER is a single bucket over the requested range rather than a calendar unit.
    const unit = granularity === 'DAILY' ? 'day' : granularity === 'WEEKLY' ? 'week' : 'month';

    const groupId: PipelineStage.Group['$group']['_id'] =
      granularity === 'SEMESTER' ? null : { $dateTrunc: { date: '$date', unit } };

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          _id: groupId,
          present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const rows = await AttendanceModel.aggregate<{ _id: Date | null; present: number; total: number }>(
      pipeline,
    ).exec();

    return rows.map((row) => ({
      key: row._id ? new Date(row._id).toISOString().slice(0, 10) : 'ALL',
      present: row.present,
      total: row.total,
    }));
  }

  /**
   * Per-student counts across a set of classes — the roster view a mentor, HOD or principal
   * sees. Aggregated server-side so a large section never ships raw rows to the client.
   */
  async countsByStudent(
    institutionId: IdLike,
    classIds: string[] | null,
    range: AttendanceRangeFilter = {},
  ): Promise<AttendanceCounts[]> {
    const match: Record<string, unknown> = { institutionId: requireObjectId(institutionId) };

    if (classIds) {
      const ids = classIds
        .map((id) => toObjectId(id))
        .filter((id): id is Types.ObjectId => id !== null);
      // An explicit empty scope must match nothing — never fall through to "everything".
      if (ids.length === 0) return [];
      match.classId = { $in: ids };
    }

    const dateFilter = dateRangeFilter(range);
    if (dateFilter) match.date = dateFilter;

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          _id: '$studentUserId',
          present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ];

    const rows = await AttendanceModel.aggregate<{ _id: Types.ObjectId; present: number; total: number }>(
      pipeline,
    ).exec();

    return rows.map((row) => ({ key: String(row._id), present: row.present, total: row.total }));
  }

  /** Apply an approved correction to the underlying record. Accepts a session for transactions. */
  async applyCorrection(
    institutionId: IdLike,
    attendanceId: IdLike,
    newStatus: AttendanceStatus,
    correctedByUserId: IdLike,
    session?: import('mongoose').ClientSession,
  ): Promise<AttendanceDocument | null> {
    return AttendanceModel.findOneAndUpdate(
      { _id: requireObjectId(attendanceId), institutionId: requireObjectId(institutionId) },
      {
        $set: {
          status: newStatus,
          correctedAt: new Date(),
          correctedByUserId: requireObjectId(correctedByUserId),
        },
      },
      { new: true, session },
    ).exec();
  }

  private buildFilter(filters: {
    classId?: string;
    subjectId?: string;
    studentUserId?: string;
    visibleClassIds?: string[] | null;
    from?: Date;
    to?: Date;
  }): FilterQuery<AttendanceEntity> {
    const filter: FilterQuery<AttendanceEntity> = {};

    if (filters.classId) {
      const classId = toObjectId(filters.classId);
      if (classId) filter.classId = classId;
    }
    if (filters.subjectId) {
      const subjectId = toObjectId(filters.subjectId);
      if (subjectId) filter.subjectId = subjectId;
    }
    if (filters.studentUserId) {
      const studentUserId = toObjectId(filters.studentUserId);
      if (studentUserId) filter.studentUserId = studentUserId;
    }

    // Scope narrowing: intersects with any explicit classId above rather than replacing it.
    if (filters.visibleClassIds) {
      const ids = filters.visibleClassIds
        .map((id) => toObjectId(id))
        .filter((id): id is Types.ObjectId => id !== null);
      filter.classId = filter.classId ? { $in: ids.filter((id) => id.equals(filter.classId as Types.ObjectId)) } : { $in: ids };
    }

    const dateFilter = dateRangeFilter(filters);
    if (dateFilter) filter.date = dateFilter;

    return filter;
  }
}

class AttendanceCorrectionRepository extends TenantRepository<CorrectionEntity> {
  constructor() {
    super(AttendanceCorrectionModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<AttendanceCorrectionDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async create(data: {
    institutionId: IdLike;
    attendanceId: IdLike;
    classId: IdLike;
    requestedByUserId: IdLike;
    oldValue: AttendanceStatus;
    newValue: AttendanceStatus;
    reason: string;
  }): Promise<AttendanceCorrectionDocument> {
    return AttendanceCorrectionModel.create({
      institutionId: requireObjectId(data.institutionId),
      attendanceId: requireObjectId(data.attendanceId),
      classId: requireObjectId(data.classId),
      requestedByUserId: requireObjectId(data.requestedByUserId),
      oldValue: data.oldValue,
      newValue: data.newValue,
      reason: data.reason,
      status: CorrectionStatus.PENDING,
    });
  }

  async listForReviewer(
    institutionId: IdLike,
    page: PageRequest,
    visibleClassIds: string[] | null,
    status?: CorrectionStatus,
  ): Promise<Page<AttendanceCorrectionDocument>> {
    const filter: FilterQuery<CorrectionEntity> = {};
    if (status) filter.status = status;

    if (visibleClassIds) {
      const ids = visibleClassIds
        .map((id) => toObjectId(id))
        .filter((id): id is Types.ObjectId => id !== null);
      if (ids.length === 0) return { items: [], total: 0 };
      filter.classId = { $in: ids };
    }

    return this.pageScoped(institutionId, filter, page, { createdAt: -1 });
  }

  async listForStudent(
    institutionId: IdLike,
    studentUserId: IdLike,
    page: PageRequest,
    status?: CorrectionStatus,
  ): Promise<Page<AttendanceCorrectionDocument>> {
    const filter: FilterQuery<CorrectionEntity> = {
      requestedByUserId: requireObjectId(studentUserId),
    };
    if (status) filter.status = status;
    return this.pageScoped(institutionId, filter, page, { createdAt: -1 });
  }

  /**
   * Atomically claim a pending request for a decision. The `PENDING` guard in the filter means
   * two reviewers deciding at once cannot both win.
   */
  async decide(
    institutionId: IdLike,
    correctionId: IdLike,
    decision: CorrectionStatus,
    reviewedByUserId: IdLike,
    note: string | null,
    session?: import('mongoose').ClientSession,
  ): Promise<AttendanceCorrectionDocument | null> {
    return AttendanceCorrectionModel.findOneAndUpdate(
      {
        _id: requireObjectId(correctionId),
        institutionId: requireObjectId(institutionId),
        status: CorrectionStatus.PENDING,
      },
      {
        $set: {
          status: decision,
          reviewedByUserId: requireObjectId(reviewedByUserId),
          reviewNote: note,
          decidedAt: new Date(),
        },
      },
      { new: true, session },
    ).exec();
  }
}

export const attendanceRepository = new AttendanceRepository();
export const attendanceCorrectionRepository = new AttendanceCorrectionRepository();
