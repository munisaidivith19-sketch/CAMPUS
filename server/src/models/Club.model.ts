/**
 * Club — a student society.
 *
 * `memberCount` is denormalized so listings do not need a per-club count query; it is maintained
 * by the membership service on approval/leave, and the `ClubMembership` collection remains the
 * source of truth if the two ever disagree.
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface ClubAttrs {
  institutionId: ObjectId;
  name: string;
  category: string;
  description: string;
  /** Club admins can approve memberships and create club events/announcements. */
  adminUserIds: ObjectId[];
  interests: string[];
  memberCount: number;
}

const clubSchema = new Schema<ClubAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    adminUserIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    // Lower-cased so rule-based discovery can match a student's interests exactly.
    interests: { type: [{ type: String, lowercase: true, trim: true }], required: true, default: [] },
    memberCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

clubSchema.index({ institutionId: 1, name: 1 }, { unique: true });
clubSchema.index({ institutionId: 1, category: 1 });
clubSchema.index({ institutionId: 1, interests: 1 });
clubSchema.index({ name: 'text', description: 'text' });

export type ClubDocument = HydratedDocument<ClubAttrs & Timestamps>;
export const ClubModel = model<ClubAttrs & Timestamps>('Club', clubSchema);
