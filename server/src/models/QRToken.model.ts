/**
 * QRToken — the opaque, revocable token behind every QR code on the platform.
 *
 * The QR image encodes ONLY a random token; identity is resolved server-side from this record.
 * That is what makes a leaked/photographed QR harmless once it expires or is revoked, and it is
 * why no name, roll number, or any other PII is ever placed in the code (SECURITY.md §10).
 * Only the token's SHA-256 hash is stored.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { QRPurpose } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface QRTokenAttrs {
  institutionId: ObjectId;
  /** The user the QR identifies (Phase 4 adds gate-pass/event subjects via `subjectType`). */
  subjectUserId: ObjectId;
  subjectType: 'USER';
  purpose: QRPurpose;
  tokenHash: string;
  singleUse: boolean;
  expiresAt: Date;
  usedAt?: Date | null;
  revokedAt?: Date | null;
  issuedByUserId: ObjectId;
}

const qrTokenSchema = new Schema<QRTokenAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subjectType: { type: String, required: true, enum: ['USER'], default: 'USER' },
    purpose: { type: String, required: true, enum: Object.values(QRPurpose) },
    tokenHash: { type: String, required: true, select: false },
    singleUse: { type: Boolean, required: true, default: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    issuedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

qrTokenSchema.index({ tokenHash: 1 }, { unique: true });
qrTokenSchema.index({ institutionId: 1, subjectUserId: 1, purpose: 1 });
qrTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type QRTokenDocument = HydratedDocument<QRTokenAttrs & Timestamps>;
export const QRTokenModel = defineModel<QRTokenAttrs & Timestamps>('QRToken', qrTokenSchema);
