/**
 * MFA — one document per enrolled factor, plus short-lived OTP challenges.
 *
 * Two shapes share this collection, matching DATABASE.md's `type (totp/otp/webauthn)`:
 *  - **TOTP**: a durable enrollment. `secretEnc` holds the base32 seed encrypted at rest with
 *    AES-256-GCM (see utils/crypto.ts) so a database dump alone cannot mint valid codes.
 *  - **OTP**: an ephemeral emailed code for new-device verification. Only a SHA-256 hash of the
 *    code is stored, it is single-use (`consumedAt`), attempt-capped, and TTL-reaped.
 *
 * The TTL index only affects documents that actually carry `expiresAt`, so TOTP enrollments
 * (which have none) are never reaped.
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { MfaType } from '@campusconnect/types';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface MfaAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  type: MfaType;
  /** TOTP only: AES-256-GCM encrypted base32 secret. Never returned by the API after enrollment. */
  secretEnc?: string | null;
  /** OTP only: SHA-256 of the 6-digit code. */
  codeHash?: string | null;
  attempts: number;
  verifiedAt?: Date | null;
  consumedAt?: Date | null;
  expiresAt?: Date | null;
}

const mfaSchema = new Schema<MfaAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, enum: Object.values(MfaType) },
    secretEnc: { type: String, default: null, select: false },
    codeHash: { type: String, default: null, select: false },
    attempts: { type: Number, required: true, default: 0 },
    verifiedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mfaSchema.index({ institutionId: 1, userId: 1, type: 1 });
mfaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MfaDocument = HydratedDocument<MfaAttrs & Timestamps>;
export const MfaModel = model<MfaAttrs & Timestamps>('MFA', mfaSchema);
