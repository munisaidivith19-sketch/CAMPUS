/**
 * Session — the server-side record a refresh token maps to (ADR-0006). Its existence is what
 * makes revocation real: the short-lived access token is stateless, but it can only be renewed
 * through a session that is still present, unrevoked, and unexpired.
 *
 * Only the SHA-256 hash of a refresh token is stored. Refresh tokens are high-entropy random
 * values, so a fast hash is the correct choice here (Argon2id is for low-entropy passwords).
 * `usedTokenHashes` keeps the rotated-away hashes so replay of an old token is *detectable*
 * rather than merely invalid — that detection revokes the whole session.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface SessionAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  refreshTokenHash: string;
  /** Hashes this session has already rotated away. Bounded by the session service. */
  usedTokenHashes: string[];
  device: string;
  deviceFingerprintHash: string;
  ip: string;
  userAgent: string;
  lastActiveAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  expiresAt: Date;
}

const sessionSchema = new Schema<SessionAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, select: false },
    usedTokenHashes: { type: [String], required: true, default: [], select: false },
    device: { type: String, required: true, default: 'Unknown device', maxlength: 120 },
    deviceFingerprintHash: { type: String, required: true },
    ip: { type: String, required: true, default: 'unknown', maxlength: 64 },
    userAgent: { type: String, required: true, default: 'unknown', maxlength: 400 },
    lastActiveAt: { type: Date, required: true, default: () => new Date() },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null, maxlength: 120 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

sessionSchema.index({ institutionId: 1, userId: 1, revokedAt: 1 });
// Institution-wide live-session count for the principal's security summary.
sessionSchema.index({ institutionId: 1, revokedAt: 1, expiresAt: 1 });
// Refresh lookup is by token hash; the hash is globally unique by construction.
sessionSchema.index({ refreshTokenHash: 1 });
sessionSchema.index({ usedTokenHashes: 1 });
// TTL: expired sessions are reaped automatically (DATABASE.md indexing strategy).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDocument = HydratedDocument<SessionAttrs & Timestamps>;
export const SessionModel = defineModel<SessionAttrs & Timestamps>('Session', sessionSchema);
