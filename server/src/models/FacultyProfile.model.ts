/** FacultyProfile — the faculty-specific half of an identity (see StudentProfile for the why). */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface FacultyProfileAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  departmentId?: ObjectId | null;
  designation?: string | null;
  subjectsTaught: string[];
  /**
   * The section this person mentors, if any (Phase 3).
   *
   * A CLASS_MENTOR's authority covers a whole section — every subject, not just the ones they
   * teach — so it cannot be derived from their class assignments. Holding the role without this
   * field resolves to an empty scope, which is the fail-closed outcome.
   */
  mentorOf?: { batch: string; section: string } | null;
}

const facultyProfileSchema = new Schema<FacultyProfileAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    designation: { type: String, default: null, trim: true, maxlength: 80 },
    subjectsTaught: { type: [String], required: true, default: [] },
    mentorOf: {
      type: new Schema(
        {
          batch: { type: String, required: true, trim: true, maxlength: 20 },
          section: { type: String, required: true, uppercase: true, trim: true, maxlength: 10 },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

facultyProfileSchema.index({ institutionId: 1, userId: 1 }, { unique: true });
facultyProfileSchema.index({ institutionId: 1, 'mentorOf.batch': 1, 'mentorOf.section': 1 });

export type FacultyProfileDocument = HydratedDocument<FacultyProfileAttrs & Timestamps>;
export const FacultyProfileModel = model<FacultyProfileAttrs & Timestamps>(
  'FacultyProfile',
  facultyProfileSchema,
);
