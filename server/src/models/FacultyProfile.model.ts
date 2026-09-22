/** FacultyProfile — the faculty-specific half of an identity (see StudentProfile for the why). */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface FacultyProfileAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  departmentId?: ObjectId | null;
  designation?: string | null;
  subjectsTaught: string[];
}

const facultyProfileSchema = new Schema<FacultyProfileAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    designation: { type: String, default: null, trim: true, maxlength: 80 },
    subjectsTaught: { type: [String], required: true, default: [] },
  },
  { timestamps: true },
);

facultyProfileSchema.index({ institutionId: 1, userId: 1 }, { unique: true });

export type FacultyProfileDocument = HydratedDocument<FacultyProfileAttrs & Timestamps>;
export const FacultyProfileModel = model<FacultyProfileAttrs & Timestamps>(
  'FacultyProfile',
  facultyProfileSchema,
);
