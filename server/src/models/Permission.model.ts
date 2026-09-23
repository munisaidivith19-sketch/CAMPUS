/** Permission — the catalog of `<resource>:<action>[:<scope>]` keys a role can grant. */
import { Schema, type HydratedDocument } from 'mongoose';
import type { Permission } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface PermissionAttrs {
  institutionId: ObjectId;
  key: Permission;
  description: string;
}

const permissionSchema = new Schema<PermissionAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    key: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

permissionSchema.index({ institutionId: 1, key: 1 }, { unique: true });

export type PermissionDocument = HydratedDocument<PermissionAttrs & Timestamps>;
export const PermissionModel = defineModel<PermissionAttrs & Timestamps>('Permission', permissionSchema);
