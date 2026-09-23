/**
 * Event — a campus event run by a club or a department.
 *
 * `registeredCount` is denormalized and decremented on cancellation so capacity can be checked
 * without counting rows on every registration; `EventRegistration` stays authoritative. The
 * capacity check itself is done with an atomic conditional update in the service, so two
 * simultaneous registrations cannot both take the last seat.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { EventStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface EventAttrs {
  institutionId: ObjectId;
  title: string;
  description: string;
  category: string;
  venue: string;
  startsAt: Date;
  endsAt: Date;
  /** null means unlimited seats. */
  capacity?: number | null;
  registeredCount: number;
  status: EventStatus;
  organizerType: 'CLUB' | 'DEPARTMENT';
  clubId?: ObjectId | null;
  departmentId?: ObjectId | null;
  createdByUserId: ObjectId;
}

const eventSchema = new Schema<EventAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    venue: { type: String, required: true, trim: true, maxlength: 200 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    capacity: { type: Number, default: null, min: 1 },
    registeredCount: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      required: true,
      enum: Object.values(EventStatus),
      default: EventStatus.PUBLISHED,
    },
    organizerType: { type: String, required: true, enum: ['CLUB', 'DEPARTMENT'] },
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

eventSchema.index({ institutionId: 1, startsAt: 1 });
eventSchema.index({ institutionId: 1, status: 1, startsAt: 1 });
eventSchema.index({ institutionId: 1, category: 1 });
eventSchema.index({ institutionId: 1, clubId: 1 });
eventSchema.index({ title: 'text', description: 'text' });

export type EventDocument = HydratedDocument<EventAttrs & Timestamps>;
export const EventModel = defineModel<EventAttrs & Timestamps>('Event', eventSchema);
