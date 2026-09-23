/**
 * StudentProfile — the student-specific half of an identity, kept separate from `User` so the
 * auth-critical document stays small (DATABASE.md modeling decisions).
 *
 * `contact` is privacy-controlled: it is only ever returned to the owner or to a caller holding
 * a tenant-wide profile permission, never in a public/QR payload.
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface StudentProfileAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  rollNo: string;
  departmentId?: ObjectId | null;
  batch?: string | null;
  year?: number | null;
  section?: string | null;
  photoRef?: string | null;
  contact?: { phone?: string | null; guardianPhone?: string | null; address?: string | null };
  /**
   * Self-declared interests, used by the RULE-BASED club and event discovery in Phase 3.
   * Matching is a plain set intersection against `Club.interests` / `Event.category` — there is
   * no model or scoring involved. AI-assisted recommendations are Phase 5 and would be labelled
   * as such rather than quietly replacing this.
   */
  interests: string[];
}

const studentProfileSchema = new Schema<StudentProfileAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rollNo: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    batch: { type: String, default: null, trim: true, maxlength: 20 },
    year: { type: Number, default: null, min: 1, max: 6 },
    section: { type: String, default: null, trim: true, maxlength: 10 },
    photoRef: { type: String, default: null },
    contact: {
      phone: { type: String, default: null, maxlength: 20 },
      guardianPhone: { type: String, default: null, maxlength: 20 },
      address: { type: String, default: null, maxlength: 300 },
    },
    interests: {
      type: [{ type: String, lowercase: true, trim: true, maxlength: 40 }],
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);

studentProfileSchema.index({ institutionId: 1, rollNo: 1 }, { unique: true });
studentProfileSchema.index({ institutionId: 1, userId: 1 }, { unique: true });
// The section roster lookup that drives class rosters and mentor/HOD scope.
studentProfileSchema.index({ institutionId: 1, departmentId: 1, batch: 1, section: 1 });

export type StudentProfileDocument = HydratedDocument<StudentProfileAttrs & Timestamps>;
export const StudentProfileModel = model<StudentProfileAttrs & Timestamps>(
  'StudentProfile',
  studentProfileSchema,
);
