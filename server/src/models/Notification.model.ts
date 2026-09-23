/**
 * Notification — an in-app message for one recipient.
 *
 * Part A delivers the IN_APP channel only; `channels` exists now so Part B can add PUSH/EMAIL
 * without a migration.
 *
 * `autoDeleteAt` is set when a notification is marked read, and a TTL index reaps it after a
 * retention window (DATABASE.md: "TTL on aged read notifications"). Unread notifications have no
 * such field and are therefore never auto-deleted — a user cannot lose something they never saw.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { NotificationChannel, NotificationType } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

/** How long a read notification is kept before the TTL monitor removes it. */
export const READ_NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface NotificationAttrs {
  institutionId: ObjectId;
  recipientUserId: ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  /** A relative in-app path; never an external URL (open-redirect defense). */
  link?: string | null;
  channels: NotificationChannel[];
  readAt?: Date | null;
  autoDeleteAt?: Date | null;
}

const notificationSchema = new Schema<NotificationAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: Object.values(NotificationType) },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    link: { type: String, default: null, trim: true, maxlength: 300 },
    channels: {
      type: [{ type: String, enum: Object.values(NotificationChannel) }],
      required: true,
      default: [NotificationChannel.IN_APP],
    },
    readAt: { type: Date, default: null },
    autoDeleteAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ institutionId: 1, recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ institutionId: 1, recipientUserId: 1, readAt: 1 });
notificationSchema.index({ autoDeleteAt: 1 }, { expireAfterSeconds: 0 });

export type NotificationDocument = HydratedDocument<NotificationAttrs & Timestamps>;
export const NotificationModel = defineModel<NotificationAttrs & Timestamps>(
  'Notification',
  notificationSchema,
);
