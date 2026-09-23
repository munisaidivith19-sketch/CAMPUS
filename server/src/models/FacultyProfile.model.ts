/** FacultyProfile — the faculty-specific half of an identity (see StudentProfile for the why). */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

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
   *
   * INVARIANT: a mentor mentors AT MOST ONE section. This is singular deliberately, not by
   * omission — the frozen spec maps `Class Mentor → Section` (prompt.md) and SECURITY.md §4
   * states the ABAC condition as `mentor ↔ section`. Do not assume multi-section mentoring.
   *
   * If that ever changes, the migration is contained: `AcademicScope.sections` is already an
   * array and `mergeScopes` already unions sections, so only this field and the two readers
   * (scope.service resolveAcademicScope, academics.service getTimetable) need to change.
   * A mentor who also TEACHES in another section already reaches those classes through their
   * class assignments, so that case needs no schema change today.
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
export const FacultyProfileModel = defineModel<FacultyProfileAttrs & Timestamps>(
  'FacultyProfile',
  facultyProfileSchema,
);
