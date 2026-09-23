/**
 * AttendanceCorrection — the request/review workflow for changing a marked record.
 *
 * The request captures `oldValue` at submission time, so the audit trail shows what the record
 * actually said when the student disputed it, even if it changes again later. Approving is
 * transactional with the attendance update (see attendance.service.ts): the record and the
 * decision move together or not at all.
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { AttendanceStatus, CorrectionStatus } from '@campusconnect/types';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface AttendanceCorrectionAttrs {
  institutionId: ObjectId;
  attendanceId: ObjectId;
  classId: ObjectId;
  requestedByUserId: ObjectId;
  oldValue: AttendanceStatus;
  newValue: AttendanceStatus;
  reason: string;
  status: CorrectionStatus;
  reviewedByUserId?: ObjectId | null;
  reviewNote?: string | null;
  decidedAt?: Date | null;
}

const correctionSchema = new Schema<AttendanceCorrectionAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    attendanceId: { type: Schema.Types.ObjectId, ref: 'Attendance', required: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    oldValue: { type: String, required: true, enum: Object.values(AttendanceStatus) },
    newValue: { type: String, required: true, enum: Object.values(AttendanceStatus) },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      required: true,
      enum: Object.values(CorrectionStatus),
      default: CorrectionStatus.PENDING,
    },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote: { type: String, default: null, trim: true, maxlength: 500 },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

correctionSchema.index({ institutionId: 1, status: 1, createdAt: -1 });
correctionSchema.index({ institutionId: 1, requestedByUserId: 1, createdAt: -1 });
correctionSchema.index({ institutionId: 1, classId: 1, status: 1 });
// At most one open request per attendance record — a student cannot queue duplicates.
correctionSchema.index(
  { attendanceId: 1 },
  { unique: true, partialFilterExpression: { status: CorrectionStatus.PENDING } },
);

export type AttendanceCorrectionDocument = HydratedDocument<AttendanceCorrectionAttrs & Timestamps>;
export const AttendanceCorrectionModel = model<AttendanceCorrectionAttrs & Timestamps>(
  'AttendanceCorrection',
  correctionSchema,
);
