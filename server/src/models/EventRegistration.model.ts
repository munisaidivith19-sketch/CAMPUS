/**
 * EventRegistration — one row per (event, user), enforced by a unique index so double
 * registration is impossible at the database level rather than by a check-then-write race.
 *
 * Check-in stamps `checkInAt` after the server resolves a scanned QRToken; the token carries no
 * identity of its own (SECURITY.md §10), so the row here is what records who actually attended.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { EventRegistrationStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface EventRegistrationAttrs {
  institutionId: ObjectId;
  eventId: ObjectId;
  userId: ObjectId;
  status: EventRegistrationStatus;
  checkInAt?: Date | null;
  checkedInByUserId?: ObjectId | null;
}

const registrationSchema = new Schema<EventRegistrationAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(EventRegistrationStatus),
      default: EventRegistrationStatus.REGISTERED,
    },
    checkInAt: { type: Date, default: null },
    checkedInByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

registrationSchema.index({ eventId: 1, userId: 1 }, { unique: true });
registrationSchema.index({ institutionId: 1, userId: 1, createdAt: -1 });
registrationSchema.index({ institutionId: 1, eventId: 1, status: 1 });

export type EventRegistrationDocument = HydratedDocument<EventRegistrationAttrs & Timestamps>;
export const EventRegistrationModel = defineModel<EventRegistrationAttrs & Timestamps>(
  'EventRegistration',
  registrationSchema,
);
