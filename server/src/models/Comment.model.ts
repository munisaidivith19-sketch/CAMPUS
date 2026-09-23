/**
 * Comment — a reply on a discussion, optionally nested under another comment.
 *
 * Reactions are stored as the set of user ids who reacted rather than a counter, so a user
 * cannot react twice and the toggle is idempotent. The count clients display is derived from
 * the array's length.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ContentStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface CommentAttrs {
  institutionId: ObjectId;
  discussionId: ObjectId;
  parentCommentId?: ObjectId | null;
  authorUserId: ObjectId;
  body: string;
  reactedByUserIds: ObjectId[];
  reportedCount: number;
  status: ContentStatus;
  removedByUserId?: ObjectId | null;
  removedAt?: Date | null;
  removalReason?: string | null;
}

const commentSchema = new Schema<CommentAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    discussionId: { type: Schema.Types.ObjectId, ref: 'Discussion', required: true },
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    reactedByUserIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
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

commentSchema.index({ institutionId: 1, discussionId: 1, createdAt: 1 });
commentSchema.index({ institutionId: 1, reportedCount: -1 });

export type CommentDocument = HydratedDocument<CommentAttrs & Timestamps>;
export const CommentModel = defineModel<CommentAttrs & Timestamps>('Comment', commentSchema);
