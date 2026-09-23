/**
 * StudentID — the digital student ID card record.
 *
 * The card itself carries no verifiable secret: verification happens by scanning a QRToken
 * (opaque, revocable, short-lived) which the server resolves back to this record. No PII is
 * ever encoded into the QR (SECURITY.md §10).
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { StudentIdStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface StudentIDAttrs {
  institutionId: ObjectId;
  studentProfileId: ObjectId;
  userId: ObjectId;
  cardNo: string;
  validFrom: Date;
  validTo: Date;
  photoRef?: string | null;
  status: StudentIdStatus;
  issuedByUserId: ObjectId;
}

const studentIdSchema = new Schema<StudentIDAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    studentProfileId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cardNo: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    validFrom: { type: Date, required: true, default: () => new Date() },
    validTo: { type: Date, required: true },
    photoRef: { type: String, default: null },
    status: {
      type: String,
      required: true,
      enum: Object.values(StudentIdStatus),
      default: StudentIdStatus.ACTIVE,
    },
    issuedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

studentIdSchema.index({ institutionId: 1, cardNo: 1 }, { unique: true });
studentIdSchema.index({ institutionId: 1, studentProfileId: 1 });

export type StudentIDDocument = HydratedDocument<StudentIDAttrs & Timestamps>;
export const StudentIDModel = defineModel<StudentIDAttrs & Timestamps>('StudentID', studentIdSchema);
