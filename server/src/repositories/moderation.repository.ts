/**
 * Report and moderation-history data access. Tenant-scoped like every repository; the grouping
 * of the queue is an aggregation that starts with the tenant `$match`.
 */
import type { FilterQuery, Types } from 'mongoose';
import {
  ContentReportModel,
  type ContentReportAttrs,
  type ContentReportDocument,
  type ReportContext,
  type ReportStatus,
  type ReportTargetType,
} from '../models/ContentReport.model.js';
import {
  ModerationActionModel,
  type ModerationActionAttrs,
  type ModerationActionDocument,
} from '../models/ModerationAction.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type ReportEntity = ContentReportAttrs & Timestamps;
type ActionEntity = ModerationActionAttrs & Timestamps;

export interface ReportGroup {
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  count: number;
  firstAt: Date;
  lastAt: Date;
  context: ReportContext;
  reports: Array<{ reason: string; at: Date; reporterUserId: Types.ObjectId }>;
}

/** Bound on groups read per queue request; the queue is a work list, not an archive. */
const MAX_GROUPS = 500;

class ContentReportRepository extends TenantRepository<ReportEntity> {
  constructor() {
    super(ContentReportModel);
  }

  /**
   * Record a report, once per reporter per target. Returns true only when this is a NEW report,
   * so counters are bumped once, and a report a moderator already dismissed is not reopened.
   */
  async recordOnce(
    institutionId: IdLike,
    input: {
      targetType: ReportTargetType;
      targetId: IdLike;
      reporterUserId: IdLike;
      reason: string;
      context: ReportContext;
    },
  ): Promise<boolean> {
    const result = await ContentReportModel.updateOne(
      {
        institutionId: requireObjectId(institutionId),
        targetType: input.targetType,
        targetId: requireObjectId(input.targetId),
        reporterUserId: requireObjectId(input.reporterUserId),
      },
      {
        $setOnInsert: {
          reason: input.reason,
          status: 'OPEN',
          context: {
            kind: input.context.kind,
            chatId: input.context.chatId ? requireObjectId(input.context.chatId) : null,
            sourceRef: input.context.sourceRef ? requireObjectId(input.context.sourceRef) : null,
          },
        },
      },
      { upsert: true },
    ).exec();
    return result.upsertedCount === 1;
  }

  /** Reports grouped by target, most-reported first. */
  async groupByTarget(institutionId: IdLike, status: ReportStatus): Promise<ReportGroup[]> {
    return ContentReportModel.aggregate<ReportGroup>([
      { $match: this.scoped(institutionId, { status } as FilterQuery<ReportEntity>) },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { targetType: '$targetType', targetId: '$targetId' },
          count: { $sum: 1 },
          firstAt: { $min: '$createdAt' },
          lastAt: { $max: '$createdAt' },
          context: { $first: '$context' },
          reports: {
            $push: { reason: '$reason', at: '$createdAt', reporterUserId: '$reporterUserId' },
          },
        },
      },
      { $sort: { count: -1, lastAt: -1 } },
      { $limit: MAX_GROUPS },
      {
        $project: {
          _id: 0,
          targetType: '$_id.targetType',
          targetId: '$_id.targetId',
          count: 1,
          firstAt: 1,
          lastAt: 1,
          context: 1,
          reports: 1,
        },
      },
    ]).exec();
  }

  async findOpenForTarget(
    institutionId: IdLike,
    targetType: ReportTargetType,
    targetId: IdLike,
  ): Promise<ContentReportDocument[]> {
    return ContentReportModel.find(
      this.scoped(institutionId, {
        targetType,
        targetId: requireObjectId(targetId),
        status: 'OPEN',
      } as FilterQuery<ReportEntity>),
    ).exec();
  }

  /** Close every open report on a target. Returns how many this call closed. */
  async closeOpen(
    institutionId: IdLike,
    targetType: ReportTargetType,
    targetId: IdLike,
    status: 'ACTIONED' | 'DISMISSED',
    decidedByUserId: IdLike,
  ): Promise<number> {
    return this.updateManyScoped(
      institutionId,
      {
        targetType,
        targetId: requireObjectId(targetId),
        status: 'OPEN',
      } as FilterQuery<ReportEntity>,
      {
        $set: { status, decidedByUserId: requireObjectId(decidedByUserId), decidedAt: new Date() },
      },
    );
  }
}

class ModerationActionRepository extends TenantRepository<ActionEntity> {
  constructor() {
    super(ModerationActionModel);
  }

  async record(
    institutionId: IdLike,
    input: {
      targetType: ReportTargetType;
      targetId: IdLike;
      action: 'REMOVE' | 'DISMISS';
      actorUserId: IdLike;
      note: string | null;
      reportCount: number;
      context: ReportContext;
    },
  ): Promise<ModerationActionDocument> {
    return ModerationActionModel.create({
      institutionId: requireObjectId(institutionId),
      targetType: input.targetType,
      targetId: requireObjectId(input.targetId),
      action: input.action,
      actorUserId: requireObjectId(input.actorUserId),
      note: input.note,
      reportCount: input.reportCount,
      context: {
        kind: input.context.kind,
        chatId: input.context.chatId ?? null,
        sourceRef: input.context.sourceRef ?? null,
      },
    });
  }

  async list(institutionId: IdLike, page: PageRequest): Promise<Page<ModerationActionDocument>> {
    return this.pageScoped(institutionId, {}, page, { createdAt: -1 });
  }
}

export const contentReportRepository = new ContentReportRepository();
export const moderationActionRepository = new ModerationActionRepository();
