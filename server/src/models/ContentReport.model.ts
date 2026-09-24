/**
 * ContentReport — one person's report of one piece of content.
 *
 * Part A kept only a counter on the reported document. That was enough to rank a queue but not
 * to show moderators WHY something was reported, to keep a dismissed report from coming back, or
 * to hide reporters from moderators who should not know them. This row is the record; the
 * counters on Discussion/Comment remain for the Part A queue.
 *
 * One row per (reporter, target): reporting the same thing twice is idempotent, and a report a
 * moderator dismissed stays dismissed even if its author reports again.
 *
 * `context` says where the content lives, which is what decides who may moderate it: a club
 * chat's admins, a class chat's mentor/HOD, or the institution-wide moderators. Reports on
 * direct messages and private groups are recorded but not actionable.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export const REPORT_TARGET_TYPES = ['DISCUSSION', 'COMMENT', 'CHAT_MESSAGE'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportContext {
  /** COMMUNITY for discussions/comments; otherwise the chat's type. */
  kind: 'COMMUNITY' | 'DIRECT' | 'GROUP' | 'CLASS' | 'CLUB';
  chatId?: ObjectId | null;
  /** The class or club a derived chat belongs to. */
  sourceRef?: ObjectId | null;
}

export interface ContentReportAttrs {
  institutionId: ObjectId;
  targetType: ReportTargetType;
  targetId: ObjectId;
  reporterUserId: ObjectId;
  /** The reporter's stated reason. Shown to moderators; never content from the target. */
  reason: string;
  status: ReportStatus;
  context: ReportContext;
  decidedByUserId?: ObjectId | null;
  decidedAt?: Date | null;
}

const contextSchema = new Schema<ReportContext>(
  {
    kind: { type: String, required: true, enum: ['COMMUNITY', 'DIRECT', 'GROUP', 'CLASS', 'CLUB'] },
    chatId: { type: Schema.Types.ObjectId, default: null },
    sourceRef: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const reportSchema = new Schema<ContentReportAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    targetType: { type: String, required: true, enum: REPORT_TARGET_TYPES },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reporterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, required: true, enum: REPORT_STATUSES, default: 'OPEN' },
    context: { type: contextSchema, required: true },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** One report per person per target; a repeat is a no-op. */
reportSchema.index(
  { institutionId: 1, targetType: 1, targetId: 1, reporterUserId: 1 },
  { unique: true },
);
/** The open queue, grouped by target. */
reportSchema.index({ institutionId: 1, status: 1, targetType: 1, targetId: 1 });

export type ContentReportDocument = HydratedDocument<ContentReportAttrs & Timestamps>;
export const ContentReportModel = defineModel<ContentReportAttrs & Timestamps>(
  'ContentReport',
  reportSchema,
);
