/**
 * Announcement — a targeted broadcast.
 *
 * `target` is stored structurally (scope + the reference that scope needs) rather than as a
 * precomputed recipient list. That means a student who transfers section stops seeing the old
 * section's announcements immediately, and a new student starts seeing them — the audience is
 * evaluated at read time against who the reader actually is.
 *
 * `readBy` is an array of user ids on the document. Bounded in practice by institution size and
 * far cheaper than a row per (announcement, reader); if an institution ever outgrows it, the
 * read state moves to its own collection without changing the API.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { AnnouncementPriority, AnnouncementScope, ALL_ROLES } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface AnnouncementTarget {
  scope: AnnouncementScope;
  departmentId?: ObjectId | null;
  batch?: string | null;
  section?: string | null;
  clubId?: ObjectId | null;
  role?: string | null;
}

export interface AnnouncementAttrs {
  institutionId: ObjectId;
  authorUserId: ObjectId;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  target: AnnouncementTarget;
  publishAt: Date;
  expireAt?: Date | null;
  readBy: ObjectId[];
}

const targetSchema = new Schema<AnnouncementTarget>(
  {
    scope: { type: String, required: true, enum: Object.values(AnnouncementScope) },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    batch: { type: String, default: null, trim: true, maxlength: 20 },
    section: { type: String, default: null, uppercase: true, trim: true, maxlength: 10 },
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', default: null },
    role: { type: String, default: null, enum: [...ALL_ROLES, null] },
  },
  { _id: false },
);

const announcementSchema = new Schema<AnnouncementAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 10_000 },
    priority: {
      type: String,
      required: true,
      enum: Object.values(AnnouncementPriority),
      default: AnnouncementPriority.NORMAL,
    },
    target: { type: targetSchema, required: true },
    publishAt: { type: Date, required: true, default: () => new Date() },
    expireAt: { type: Date, default: null },
    readBy: { type: [Schema.Types.ObjectId], required: true, default: [] },
  },
  { timestamps: true },
);

announcementSchema.index({ institutionId: 1, publishAt: -1 });
announcementSchema.index({ institutionId: 1, 'target.scope': 1, publishAt: -1 });
// Search facade (DATABASE.md: text indexes on Announcement/Discussion/Event/Club).
announcementSchema.index({ title: 'text', body: 'text' });

export type AnnouncementDocument = HydratedDocument<AnnouncementAttrs & Timestamps>;
export const AnnouncementModel = defineModel<AnnouncementAttrs & Timestamps>(
  'Announcement',
  announcementSchema,
);
