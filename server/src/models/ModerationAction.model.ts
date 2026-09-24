/**
 * ModerationAction — the history of moderator decisions, for the moderation UI.
 *
 * The audit log already records every removal for the institution's record; this collection is
 * the moderators' own working history (what was decided, by whom, on what, with which note),
 * readable by moderators without granting them the whole audit trail. It never stores the
 * removed content itself.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';
import {
  REPORT_TARGET_TYPES,
  type ReportContext,
  type ReportTargetType,
} from './ContentReport.model.js';

export interface ModerationActionAttrs {
  institutionId: ObjectId;
  targetType: ReportTargetType;
  targetId: ObjectId;
  action: 'REMOVE' | 'DISMISS';
  actorUserId: ObjectId;
  note?: string | null;
  /** How many open reports the decision closed. */
  reportCount: number;
  context: ReportContext;
}

const actionSchema = new Schema<ModerationActionAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    targetType: { type: String, required: true, enum: REPORT_TARGET_TYPES },
    targetId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true, enum: ['REMOVE', 'DISMISS'] },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: null, maxlength: 500 },
    reportCount: { type: Number, required: true, default: 0 },
    context: {
      kind: { type: String, required: true },
      chatId: { type: Schema.Types.ObjectId, default: null },
      sourceRef: { type: Schema.Types.ObjectId, default: null },
    },
  },
  { timestamps: true },
);

actionSchema.index({ institutionId: 1, createdAt: -1 });

export type ModerationActionDocument = HydratedDocument<ModerationActionAttrs & Timestamps>;
export const ModerationActionModel = defineModel<ModerationActionAttrs & Timestamps>(
  'ModerationAction',
  actionSchema,
);
