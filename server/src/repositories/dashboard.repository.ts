/**
 * Aggregations behind the role dashboards.
 *
 * Every pipeline starts with a `$match` on `institutionId` (the tenant-leading index is the
 * access path), and every scoped query takes an explicit id list where an EMPTY list matches
 * nothing — callers pass `null` only for a genuinely institution-wide scope. Attendance is
 * returned as raw counts; percentages are derived once, in the service, from those counts.
 */
import type { PipelineStage, Types } from 'mongoose';
import {
  AttendanceStatus,
  ClubMembershipStatus,
  EventRegistrationStatus,
  EventStatus,
  LoginResult,
} from '@campusconnect/types';
import { AttendanceModel } from '../models/Attendance.model.js';
import { ClubMembershipModel } from '../models/ClubMembership.model.js';
import { EventModel } from '../models/Event.model.js';
import { EventRegistrationModel } from '../models/EventRegistration.model.js';
import { LoginHistoryModel } from '../models/LoginHistory.model.js';
import { SessionModel } from '../models/Session.model.js';
import { requireObjectId, toObjectId, type IdLike } from './base.repository.js';

export interface Counts {
  present: number;
  total: number;
}

const ids = (values: readonly IdLike[]): Types.ObjectId[] =>
  values
    .map((value) => toObjectId(value))
    .filter((value): value is Types.ObjectId => value !== null);

const countStage: PipelineStage.Group['$group'] = {
  _id: null,
  present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
  total: { $sum: 1 },
};

class DashboardRepository {
  /** Attendance counts over a set of classes (`null` = every class in the tenant). */
  async attendanceForClasses(
    institutionId: IdLike,
    classIds: readonly IdLike[] | null,
  ): Promise<Counts> {
    const match: Record<string, unknown> = { institutionId: requireObjectId(institutionId) };
    if (classIds) {
      const list = ids(classIds);
      if (list.length === 0) return { present: 0, total: 0 };
      match.classId = { $in: list };
    }
    const [row] = await AttendanceModel.aggregate<Counts>([
      { $match: match },
      { $group: countStage },
    ]).exec();
    return { present: row?.present ?? 0, total: row?.total ?? 0 };
  }

  /** Attendance counts over a set of students, across every class they attend. */
  async attendanceForStudents(
    institutionId: IdLike,
    studentUserIds: readonly IdLike[],
  ): Promise<Counts> {
    const list = ids(studentUserIds);
    if (list.length === 0) return { present: 0, total: 0 };
    const [row] = await AttendanceModel.aggregate<Counts>([
      { $match: { institutionId: requireObjectId(institutionId), studentUserId: { $in: list } } },
      { $group: countStage },
    ]).exec();
    return { present: row?.present ?? 0, total: row?.total ?? 0 };
  }

  /** Per-class counts for the given classes. */
  async attendanceByClass(
    institutionId: IdLike,
    classIds: readonly IdLike[],
  ): Promise<Array<Counts & { classId: string }>> {
    const list = ids(classIds);
    if (list.length === 0) return [];
    const rows = await AttendanceModel.aggregate<Counts & { _id: Types.ObjectId }>([
      { $match: { institutionId: requireObjectId(institutionId), classId: { $in: list } } },
      { $group: { ...countStage, _id: '$classId' } },
    ]).exec();
    return rows.map((row) => ({
      classId: String(row._id),
      present: row.present,
      total: row.total,
    }));
  }

  /** Per-department counts across the whole tenant, joined through each record's class. */
  async attendanceByDepartment(
    institutionId: IdLike,
  ): Promise<Array<Counts & { departmentId: string | null }>> {
    const tenant = requireObjectId(institutionId);
    const rows = await AttendanceModel.aggregate<Counts & { _id: Types.ObjectId | null }>([
      { $match: { institutionId: tenant } },
      // Class counts first (small), then one lookup per class rather than per record.
      { $group: { ...countStage, _id: '$classId' } },
      {
        $lookup: {
          from: 'classes',
          let: { classId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$_id', '$$classId'] }, { $eq: ['$institutionId', tenant] }],
                },
              },
            },
            { $project: { departmentId: 1 } },
          ],
          as: 'klass',
        },
      },
      {
        $group: {
          _id: { $ifNull: [{ $first: '$klass.departmentId' }, null] },
          present: { $sum: '$present' },
          total: { $sum: '$total' },
        },
      },
    ]).exec();
    return rows.map((row) => ({
      departmentId: row._id ? String(row._id) : null,
      present: row.present,
      total: row.total,
    }));
  }

  /** `classId:period` keys already marked on one date, for the given classes. */
  async markedSlots(
    institutionId: IdLike,
    classIds: readonly IdLike[],
    date: Date,
  ): Promise<Set<string>> {
    const list = ids(classIds);
    if (list.length === 0) return new Set();
    const rows = await AttendanceModel.aggregate<{
      _id: { classId: Types.ObjectId; period: number };
    }>([
      { $match: { institutionId: requireObjectId(institutionId), classId: { $in: list }, date } },
      { $group: { _id: { classId: '$classId', period: '$period' } } },
    ]).exec();
    return new Set(rows.map((row) => `${String(row._id.classId)}:${row._id.period}`));
  }

  async loginsSince(
    institutionId: IdLike,
    since: Date,
  ): Promise<{ total: number; failed: number }> {
    const rows = await LoginHistoryModel.aggregate<{ _id: string; count: number }>([
      { $match: { institutionId: requireObjectId(institutionId), at: { $gte: since } } },
      { $group: { _id: '$result', count: { $sum: 1 } } },
    ]).exec();
    const failed = rows.find((row) => row._id === LoginResult.FAILURE)?.count ?? 0;
    return { total: rows.reduce((sum, row) => sum + row.count, 0), failed };
  }

  async activeSessions(institutionId: IdLike, now: Date): Promise<number> {
    return SessionModel.countDocuments({
      institutionId: requireObjectId(institutionId),
      revokedAt: null,
      expiresAt: { $gt: now },
    }).exec();
  }

  /** Published events starting in a window, optionally for given clubs or departments. */
  async eventsBetween(
    institutionId: IdLike,
    from: Date,
    to: Date,
    filter: { clubIds?: readonly IdLike[]; departmentIds?: readonly IdLike[] } = {},
    limit = 5,
  ): Promise<
    Array<{
      id: string;
      title: string;
      startsAt: Date;
      venue: string;
      capacity: number | null;
      clubId: string | null;
    }>
  > {
    const match: Record<string, unknown> = {
      institutionId: requireObjectId(institutionId),
      status: EventStatus.PUBLISHED,
      startsAt: { $gte: from, $lt: to },
    };
    if (filter.clubIds) {
      const list = ids(filter.clubIds);
      if (list.length === 0) return [];
      match.clubId = { $in: list };
    }
    if (filter.departmentIds) {
      const list = ids(filter.departmentIds);
      if (list.length === 0) return [];
      match.departmentId = { $in: list };
    }
    const rows = await EventModel.find(match).sort({ startsAt: 1 }).limit(limit).lean().exec();
    return rows.map((row) => ({
      id: String(row._id),
      title: row.title,
      startsAt: row.startsAt,
      venue: row.venue,
      capacity: row.capacity ?? null,
      clubId: row.clubId ? String(row.clubId) : null,
    }));
  }

  async countEventsBetween(institutionId: IdLike, from: Date, to: Date): Promise<number> {
    return EventModel.countDocuments({
      institutionId: requireObjectId(institutionId),
      status: EventStatus.PUBLISHED,
      startsAt: { $gte: from, $lt: to },
    }).exec();
  }

  /** Published events per club in a window. */
  async eventsPerClub(institutionId: IdLike, from: Date, to: Date): Promise<Map<string, number>> {
    const rows = await EventModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          institutionId: requireObjectId(institutionId),
          status: EventStatus.PUBLISHED,
          startsAt: { $gte: from, $lt: to },
          clubId: { $ne: null },
        },
      },
      { $group: { _id: '$clubId', count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  /** Registrations and check-ins per event. */
  async registrationStats(
    institutionId: IdLike,
    eventIds: readonly IdLike[],
  ): Promise<Map<string, { registrations: number; checkIns: number }>> {
    const list = ids(eventIds);
    if (list.length === 0) return new Map();
    const rows = await EventRegistrationModel.aggregate<{
      _id: Types.ObjectId;
      registrations: number;
      checkIns: number;
    }>([
      {
        $match: {
          institutionId: requireObjectId(institutionId),
          eventId: { $in: list },
          status: { $ne: EventRegistrationStatus.CANCELLED },
        },
      },
      {
        $group: {
          _id: '$eventId',
          registrations: { $sum: 1 },
          checkIns: { $sum: { $cond: [{ $ne: ['$checkInAt', null] }, 1, 0] } },
        },
      },
    ]).exec();
    return new Map(
      rows.map((row) => [
        String(row._id),
        { registrations: row.registrations, checkIns: row.checkIns },
      ]),
    );
  }

  async pendingRequestsPerClub(
    institutionId: IdLike,
    clubIds: readonly IdLike[],
  ): Promise<Map<string, number>> {
    const list = ids(clubIds);
    if (list.length === 0) return new Map();
    const rows = await ClubMembershipModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          institutionId: requireObjectId(institutionId),
          clubId: { $in: list },
          status: ClubMembershipStatus.REQUESTED,
        },
      },
      { $group: { _id: '$clubId', count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }
}

export const dashboardRepository = new DashboardRepository();
