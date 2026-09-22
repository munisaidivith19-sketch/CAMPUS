/**
 * PasswordReset — a single-use, short-lived, hashed reset token.
 *
 * Only the SHA-256 hash of the token is stored, so a database leak does not hand an attacker a
 * working reset link. `usedAt` enforces single use; the TTL index removes the record once it
 * has expired.
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface PasswordResetAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  requestedIp: string;
  expiresAt: Date;
  usedAt?: Date | null;
}

const passwordResetSchema = new Schema<PasswordResetAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, select: false },
    requestedIp: { type: String, required: true, default: 'unknown', maxlength: 64 },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

passwordResetSchema.index({ tokenHash: 1 });
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetDocument = HydratedDocument<PasswordResetAttrs & Timestamps>;
export const PasswordResetModel = model<PasswordResetAttrs & Timestamps>(
  'PasswordReset',
  passwordResetSchema,
);
