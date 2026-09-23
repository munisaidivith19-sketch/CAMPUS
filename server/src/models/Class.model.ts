/**
 * Class — one subject taught to one section by one faculty member. This is the unit attendance
 * is marked against.
 *
 * There is deliberately no enrollment collection: a class identifies its roster structurally, by
 * `{ departmentId, batch, section }`, and the students are the `StudentProfile`s matching that
 * triple. One source of truth for "who is in this section" means a transfer cannot leave a
 * student enrolled in a class they no longer attend.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface ClassAttrs {
  institutionId: ObjectId;
  departmentId?: ObjectId | null;
  subjectId: ObjectId;
  facultyUserId?: ObjectId | null;
  batch: string;
  section: string;
}

const classSchema = new Schema<ClassAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    facultyUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    batch: { type: String, required: true, trim: true, maxlength: 20 },
    section: { type: String, required: true, uppercase: true, trim: true, maxlength: 10 },
  },
  { timestamps: true },
);

// One class per (subject, batch, section) within an institution.
classSchema.index({ institutionId: 1, subjectId: 1, batch: 1, section: 1 }, { unique: true });
// The faculty scope query: "which classes do I teach?"
classSchema.index({ institutionId: 1, facultyUserId: 1 });
// The mentor/HOD scope queries.
classSchema.index({ institutionId: 1, departmentId: 1, batch: 1, section: 1 });

export type ClassDocument = HydratedDocument<ClassAttrs & Timestamps>;
export const ClassModel = defineModel<ClassAttrs & Timestamps>('Class', classSchema);
