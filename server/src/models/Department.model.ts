/** Department — tenant-scoped organizational unit that student/faculty profiles hang off. */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface DepartmentAttrs {
  institutionId: ObjectId;
  name: string;
  code: string;
  hodUserId?: ObjectId | null;
}

const departmentSchema = new Schema<DepartmentAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 16 },
    hodUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

departmentSchema.index({ institutionId: 1, code: 1 }, { unique: true });

export type DepartmentDocument = HydratedDocument<DepartmentAttrs & Timestamps>;
export const DepartmentModel = model<DepartmentAttrs & Timestamps>('Department', departmentSchema);
