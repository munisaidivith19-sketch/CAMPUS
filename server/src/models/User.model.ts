/**
 * User — identity and authentication state common to every role. Role-specific fields live in
 * the separate `*Profile` documents so this auth-critical document stays small and fast.
 *
 * Secret-bearing fields (`passwordHash`, `emailVerificationTokenHash`) are `select: false`, so
 * a query has to ask for them explicitly and they cannot leak into a response by accident.
 * Plaintext passwords are never stored, logged, or accepted into this document.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ALL_ROLES, type Role, UserStatus } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface UserAttrs {
  institutionId: ObjectId;
  email: string;
  passwordHash: string;
  fullName: string;
  phone?: string | null;
  status: UserStatus;
  roles: Role[];
  primaryRole: Role;
  mfaEnabled: boolean;
  lastLoginAt?: Date | null;
  emailVerifiedAt?: Date | null;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;
  /** Brute-force backoff counters (SECURITY.md §5 — brute force / credential stuffing). */
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  /**
   * Hashed fingerprints of devices this user has already logged in from successfully. A login
   * from a fingerprint that is not here triggers new-device verification. Capped in the service
   * layer so the document stays bounded.
   */
  knownDeviceHashes: string[];
  deletedAt?: Date | null;
}

const userSchema = new Schema<UserAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, default: null, trim: true, maxlength: 20 },
    status: {
      type: String,
      required: true,
      enum: Object.values(UserStatus),
      default: UserStatus.PENDING_VERIFICATION,
    },
    roles: { type: [{ type: String, enum: ALL_ROLES }], required: true, default: [] },
    primaryRole: { type: String, required: true, enum: ALL_ROLES },
    mfaEnabled: { type: Boolean, required: true, default: false },
    lastLoginAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    knownDeviceHashes: { type: [String], required: true, default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One account per email per institution (DATABASE.md — unique { institutionId, email }).
userSchema.index({ institutionId: 1, email: 1 }, { unique: true });
userSchema.index({ institutionId: 1, status: 1 });
// Lookup by verification token; sparse so unverified-token-less users don't bloat the index.
userSchema.index({ emailVerificationTokenHash: 1 }, { sparse: true });

export type UserDocument = HydratedDocument<UserAttrs & Timestamps>;
export const UserModel = defineModel<UserAttrs & Timestamps>('User', userSchema);
