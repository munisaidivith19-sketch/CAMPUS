/**
 * LoginHistory — every authentication attempt, successful or not, so a user can review access
 * to their own account and so suspicious-login detection has evidence to work from.
 *
 * Stores the outcome and a coarse reason only: never the attempted password, the OTP, or any
 * token (SECURITY.md §8).
 */
import { Schema, model, type HydratedDocument } from 'mongoose';
import { LoginFailureReason, LoginResult } from '@campusconnect/types';
import { tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface LoginHistoryAttrs {
  institutionId: ObjectId;
  userId: ObjectId;
  ip: string;
  device: string;
  userAgent: string;
  result: LoginResult;
  reason?: LoginFailureReason | null;
  at: Date;
}

const loginHistorySchema = new Schema<LoginHistoryAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ip: { type: String, required: true, default: 'unknown', maxlength: 64 },
    device: { type: String, required: true, default: 'Unknown device', maxlength: 120 },
    userAgent: { type: String, required: true, default: 'unknown', maxlength: 400 },
    result: { type: String, required: true, enum: Object.values(LoginResult) },
    reason: { type: String, enum: [...Object.values(LoginFailureReason), null], default: null },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

loginHistorySchema.index({ institutionId: 1, userId: 1, at: -1 });

export type LoginHistoryDocument = HydratedDocument<LoginHistoryAttrs & Timestamps>;
export const LoginHistoryModel = model<LoginHistoryAttrs & Timestamps>(
  'LoginHistory',
  loginHistorySchema,
);
