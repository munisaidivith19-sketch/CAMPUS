/**
 * Discussion — a forum thread.
 *
 * Moderation is a soft state (`status: REMOVED`) rather than a delete: removing content must not
 * destroy the evidence an investigation or appeal would need, and the audit entry that records
 * the removal has to point at something that still exists.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ContentStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface DiscussionAttrs {
  institutionId: ObjectId;
  authorUserId: ObjectId;
  title: string;
  body: string;
  category: string;
  tags: string[];
  commentCount: number;
  reportedCount: number;
  status: ContentStatus;
  removedByUserId?: ObjectId | null;
  removedAt?: Date | null;
  removalReason?: string | null;
}

const discussionSchema = new Schema<DiscussionAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 10_000 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    tags: { type: [{ type: String, lowercase: true, trim: true }], required: true, default: [] },
    commentCount: { type: Number, required: true, default: 0, min: 0 },
    reportedCount: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      required: true,
      enum: Object.values(ContentStatus),
      default: ContentStatus.VISIBLE,
    },
    removedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    removedAt: { type: Date, default: null },
    removalReason: { type: String, default: null, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

discussionSchema.index({ institutionId: 1, status: 1, createdAt: -1 });
discussionSchema.index({ institutionId: 1, category: 1, createdAt: -1 });
discussionSchema.index({ institutionId: 1, tags: 1 });
// Reported-content queue for moderators.
discussionSchema.index({ institutionId: 1, reportedCount: -1 });
discussionSchema.index({ title: 'text', body: 'text' });

export type DiscussionDocument = HydratedDocument<DiscussionAttrs & Timestamps>;
export const DiscussionModel = defineModel<DiscussionAttrs & Timestamps>('Discussion', discussionSchema);
