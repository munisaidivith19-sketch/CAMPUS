/**
 * Timetable — the weekly schedule for one section.
 *
 * Entries are embedded rather than referenced: they are owned by the timetable, always read with
 * it, and bounded (six days × a dozen periods), which is exactly the embed case in
 * DATABASE.md's embed-vs-reference rule.
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { ALL_DAYS, type DayOfWeek } from '@campusconnect/types';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface TimetableEntry {
  day: DayOfWeek;
  period: number;
  classId: ObjectId;
  room?: string | null;
}

export interface TimetableAttrs {
  institutionId: ObjectId;
  departmentId?: ObjectId | null;
  batch: string;
  section: string;
  entries: TimetableEntry[];
}

const entrySchema = new Schema<TimetableEntry>(
  {
    day: { type: String, required: true, enum: ALL_DAYS },
    period: { type: Number, required: true, min: 1, max: 12 },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    room: { type: String, default: null, trim: true, maxlength: 40 },
  },
  { _id: false },
);

const timetableSchema = new Schema<TimetableAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    batch: { type: String, required: true, trim: true, maxlength: 20 },
    section: { type: String, required: true, uppercase: true, trim: true, maxlength: 10 },
    entries: { type: [entrySchema], required: true, default: [] },
  },
  { timestamps: true },
);

timetableSchema.index({ institutionId: 1, batch: 1, section: 1 }, { unique: true });

export type TimetableDocument = HydratedDocument<TimetableAttrs & Timestamps>;
export const TimetableModel = model<TimetableAttrs & Timestamps>('Timetable', timetableSchema);
