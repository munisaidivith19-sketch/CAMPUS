/**
 * Role + Permission data access.
 *
 * RBAC is data, so these are read on every authentication. The service layer caches the
 * resolved role→permission map in memory (with an explicit invalidation hook) so a login does
 * not pay for a join, while a role change can still take effect without a restart.
 */
import type { Permission, Role } from '@campusconnect/types';
import { RoleModel, type RoleAttrs, type RoleDocument } from '../models/Role.model.js';
import {
  PermissionModel,
  type PermissionAttrs,
  type PermissionDocument,
} from '../models/Permission.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, type IdLike } from './base.repository.js';

type RoleEntity = RoleAttrs & Timestamps;
type PermissionEntity = PermissionAttrs & Timestamps;

class RoleRepository extends TenantRepository<RoleEntity> {
  constructor() {
    super(RoleModel);
  }

  async listForInstitution(institutionId: IdLike): Promise<RoleDocument[]> {
    return RoleModel.find(this.scoped(institutionId)).sort({ key: 1 }).exec();
  }

  async findByKey(institutionId: IdLike, key: Role): Promise<RoleDocument | null> {
    return this.findOneScoped(institutionId, { key });
  }

  /** Idempotent seed/update of a platform role and its grants. */
  async upsert(
    institutionId: IdLike,
    key: Role,
    label: string,
    permissions: readonly Permission[],
  ): Promise<RoleDocument | null> {
    return RoleModel.findOneAndUpdate(
      { institutionId: requireObjectId(institutionId), key },
      { $set: { label, permissions: [...permissions], isSystem: true } },
      { new: true, upsert: true },
    ).exec();
  }

  async setPermissions(
    institutionId: IdLike,
    key: Role,
    permissions: readonly Permission[],
  ): Promise<RoleDocument | null> {
    return RoleModel.findOneAndUpdate(
      { institutionId: requireObjectId(institutionId), key },
      { $set: { permissions: [...permissions] } },
      { new: true },
    ).exec();
  }
}

class PermissionRepository extends TenantRepository<PermissionEntity> {
  constructor() {
    super(PermissionModel);
  }

  async listForInstitution(institutionId: IdLike): Promise<PermissionDocument[]> {
    return PermissionModel.find(this.scoped(institutionId)).sort({ key: 1 }).exec();
  }

  async upsert(institutionId: IdLike, key: Permission, description: string): Promise<void> {
    await PermissionModel.updateOne(
      { institutionId: requireObjectId(institutionId), key },
      { $set: { description } },
      { upsert: true },
    ).exec();
  }
}

export const roleRepository = new RoleRepository();
export const permissionRepository = new PermissionRepository();
