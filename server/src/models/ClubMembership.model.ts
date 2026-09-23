/** ClubMembership — the join request/approval record linking a user to a club. */
import { Schema, type HydratedDocument } from 'mongoose';
import { ClubMemberRole, ClubMembershipStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface ClubMembershipAttrs {
  institutionId: ObjectId;
  clubId: ObjectId;
  userId: ObjectId;
  role: ClubMemberRole;
  status: ClubMembershipStatus;
  decidedByUserId?: ObjectId | null;
  decidedAt?: Date | null;
}

const membershipSchema = new Schema<ClubMembershipAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      required: true,
      enum: Object.values(ClubMemberRole),
      default: ClubMemberRole.MEMBER,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(ClubMembershipStatus),
      default: ClubMembershipStatus.REQUESTED,
    },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One membership row per (club, user) — DATABASE.md unique index. Re-joining reuses the row.
membershipSchema.index({ clubId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ institutionId: 1, userId: 1, status: 1 });
membershipSchema.index({ institutionId: 1, clubId: 1, status: 1 });

export type ClubMembershipDocument = HydratedDocument<ClubMembershipAttrs & Timestamps>;
export const ClubMembershipModel = defineModel<ClubMembershipAttrs & Timestamps>(
  'ClubMembership',
  membershipSchema,
);
