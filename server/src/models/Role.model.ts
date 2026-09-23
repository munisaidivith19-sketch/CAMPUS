/**
 * Role — RBAC stored as DATA, not just enums (DATABASE.md modeling decisions), so roles and
 * their permission grants can change without a code change. Tenant-scoped, because
 * DATABASE.md only exempts collections explicitly marked [global].
 *
 * `isSystem` marks the 14 platform roles that ship seeded; they may be re-granted but are not
 * meant to be deleted by an institution.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ALL_ROLES, type Permission, type Role } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface RoleAttrs {
  institutionId: ObjectId;
  key: Role;
  label: string;
  /** Permission KEYS (not ObjectIds) — the catalog is keyed by stable string, which keeps the
   *  role→permission resolution a single query instead of a join on every login. */
  permissions: Permission[];
  isSystem: boolean;
}

const roleSchema = new Schema<RoleAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    key: { type: String, required: true, enum: ALL_ROLES },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    permissions: { type: [String], required: true, default: [] },
    isSystem: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

roleSchema.index({ institutionId: 1, key: 1 }, { unique: true });

export type RoleDocument = HydratedDocument<RoleAttrs & Timestamps>;
export const RoleModel = defineModel<RoleAttrs & Timestamps>('Role', roleSchema);
