/** Subject — a course in the curriculum, owned by a department. */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface SubjectAttrs {
  institutionId: ObjectId;
  departmentId?: ObjectId | null;
  code: string;
  name: string;
  credits: number;
}

const subjectSchema = new Schema<SubjectAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    credits: { type: Number, required: true, min: 0, max: 20, default: 3 },
  },
  { timestamps: true },
);

subjectSchema.index({ institutionId: 1, code: 1 }, { unique: true });
subjectSchema.index({ institutionId: 1, departmentId: 1 });

export type SubjectDocument = HydratedDocument<SubjectAttrs & Timestamps>;
export const SubjectModel = defineModel<SubjectAttrs & Timestamps>('Subject', subjectSchema);
