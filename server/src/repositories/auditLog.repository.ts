/**
 * Audit log data access — append and read only.
 *
 * There is intentionally no update or delete method here, and the model itself throws on those
 * operations, so the trail cannot be rewritten by any future caller (SECURITY.md §8).
 */
import type { AuditAction, AuditResult } from '@campusconnect/types';
import type { FilterQuery } from 'mongoose';
import { AuditLogModel, type AuditLogAttrs, type AuditLogDocument } from '../models/AuditLog.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike, type Page, type PageRequest } from './base.repository.js';

type AuditLogEntity = AuditLogAttrs & Timestamps;

class AuditLogRepository extends TenantRepository<AuditLogEntity> {
  constructor() {
    super(AuditLogModel);
  }

  async append(entry: {
    institutionId: IdLike;
    actorUserId?: IdLike | null;
    action: AuditAction;
    resourceType: string;
    resourceId?: string | null;
    result: AuditResult;
    ip: string;
    deviceContext: string;
    reason?: string | null;
  }): Promise<void> {
    await AuditLogModel.create({
      institutionId: requireObjectId(entry.institutionId),
      actorUserId: entry.actorUserId ? toObjectId(entry.actorUserId) : null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      result: entry.result,
      ip: entry.ip,
      deviceContext: entry.deviceContext,
      reason: entry.reason ?? null,
      at: new Date(),
    });
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: { action?: AuditAction; actorUserId?: IdLike } = {},
  ): Promise<Page<AuditLogDocument>> {
    const filter: FilterQuery<AuditLogEntity> = {};
    if (filters.action) filter.action = filters.action;
    if (filters.actorUserId) {
      const actor = toObjectId(filters.actorUserId);
      if (actor) filter.actorUserId = actor;
    }
    return this.pageScoped(institutionId, filter, page, { at: -1 });
  }
}

export const auditLogRepository = new AuditLogRepository();
