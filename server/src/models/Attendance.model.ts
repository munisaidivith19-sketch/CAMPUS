/**
 * Attendance — ONE document per (student, class, date, period).
 *
 * This granularity is the whole point (DATABASE.md modeling decisions): because every conducted
 * period is a row, a percentage can be computed as `SUM(present) / SUM(total)` over any slice.
 * Storing a per-subject percentage instead would make combining subjects an average of averages,
 * which is wrong whenever subjects have different numbers of conducted periods.
 *
 * The unique index makes a duplicate row impossible, so re-marking is necessarily an *update* —
 * which the service audits rather than performing silently.
 *
 * `date` is normalized to UTC midnight by the service so a period is keyed by calendar day and
 * not by the marker's clock time.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { AttendanceStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface AttendanceAttrs {
  institutionId: ObjectId;
  classId: ObjectId;
  subjectId: ObjectId;
  studentUserId: ObjectId;
  date: Date;
  period: number;
  status: AttendanceStatus;
  markedByUserId: ObjectId;
  /** Set when a correction changed the record, so history is visible on the row itself. */
  correctedAt?: Date | null;
  correctedByUserId?: ObjectId | null;
}

const attendanceSchema = new Schema<AttendanceAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    studentUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    period: { type: Number, required: true, min: 1, max: 12 },
    status: { type: String, required: true, enum: Object.values(AttendanceStatus) },
    markedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    correctedAt: { type: Date, default: null },
    correctedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Exactly one record per student per period — the guarantee the aggregation math relies on.
attendanceSchema.index(
  { institutionId: 1, classId: 1, studentUserId: 1, date: 1, period: 1 },
  { unique: true },
);
// The student's own view (DATABASE.md indexing strategy).
attendanceSchema.index({ institutionId: 1, studentUserId: 1, subjectId: 1, date: 1 });
// The faculty roster view for one class on one day.
attendanceSchema.index({ institutionId: 1, classId: 1, date: 1 });

export type AttendanceDocument = HydratedDocument<AttendanceAttrs & Timestamps>;
export const AttendanceModel = defineModel<AttendanceAttrs & Timestamps>('Attendance', attendanceSchema);
