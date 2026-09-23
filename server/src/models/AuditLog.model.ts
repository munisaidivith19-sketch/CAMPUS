/**
 * AuditLog — append-only trail for sensitive and state-changing actions (SECURITY.md §8).
 *
 * "Append-only" is enforced here rather than trusted to convention: the update and delete
 * hooks throw, so no repository, service, or future feature can quietly rewrite history.
 * Entries never contain passwords, OTPs, reset tokens, or session secrets — only the coarse
 * action, the actor, the target, and the outcome.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { AuditAction, AuditResult } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface AuditLogAttrs {
  institutionId: ObjectId;
  /** Null for actions taken before a principal exists (e.g. a failed login on an unknown email). */
  actorUserId?: ObjectId | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  ip: string;
  deviceContext: string;
  /** Short, non-sensitive explanation (e.g. 'PERMISSION_DENIED'). Never a secret. */
  reason?: string | null;
  at: Date;
}

const auditLogSchema = new Schema<AuditLogAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, enum: Object.values(AuditAction) },
    resourceType: { type: String, required: true, maxlength: 60 },
    resourceId: { type: String, default: null, maxlength: 64 },
    result: { type: String, required: true, enum: Object.values(AuditResult) },
    ip: { type: String, required: true, default: 'unknown', maxlength: 64 },
    deviceContext: { type: String, required: true, default: 'unknown', maxlength: 400 },
    reason: { type: String, default: null, maxlength: 200 },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

auditLogSchema.index({ institutionId: 1, at: -1 });
auditLogSchema.index({ institutionId: 1, actorUserId: 1, at: -1 });
auditLogSchema.index({ institutionId: 1, action: 1, at: -1 });

const APPEND_ONLY = 'AuditLog is append-only: entries cannot be modified or deleted.';
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'] as const) {
  auditLogSchema.pre(op, function preventMutation() {
    throw new Error(APPEND_ONLY);
  });
}
for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditLogSchema.pre(op, function preventDeletion() {
    throw new Error(APPEND_ONLY);
  });
}

export type AuditLogDocument = HydratedDocument<AuditLogAttrs & Timestamps>;
export const AuditLogModel = defineModel<AuditLogAttrs & Timestamps>('AuditLog', auditLogSchema);
