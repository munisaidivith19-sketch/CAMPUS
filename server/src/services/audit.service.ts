/**
 * Audit trail writing.
 *
 * Auditing must never be able to break the action it is recording, so failures here are logged
 * and swallowed rather than thrown — an audit backend problem should not hand an attacker a way
 * to fail a security-relevant operation by making the log write fail. The write itself is
 * append-only and enforced at the model layer.
 *
 * Callers pass only coarse, non-sensitive context. There is no parameter through which a
 * password, OTP, token or secret could be recorded (SECURITY.md §8).
 */
import type { AuditAction, AuditResult } from '@campusconnect/types';
import { auditLogRepository } from '../repositories/auditLog.repository.js';
import { logger } from '../utils/logger.js';
import type { IdLike } from '../repositories/base.repository.js';

export interface AuditContext {
  ip: string;
  userAgent: string;
}

export interface AuditEntry {
  institutionId: IdLike;
  actorUserId?: IdLike | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  context: AuditContext;
  reason?: string | null;
}

export interface AuditLogDTO {
  id: string;
  actorUserId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  ip: string;
  reason: string | null;
  at: string;
}

/** Tenant-scoped read for the administrative audit view (requires `audit:read`). */
export async function listAuditLog(
  institutionId: IdLike,
  page: { page: number; limit: number },
): Promise<{ items: AuditLogDTO[]; total: number }> {
  const result = await auditLogRepository.list(institutionId, page);
  return {
    items: result.items.map((entry) => ({
      id: String(entry._id),
      actorUserId: entry.actorUserId ? String(entry.actorUserId) : null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      result: entry.result,
      ip: entry.ip,
      reason: entry.reason ?? null,
      at: entry.at.toISOString(),
    })),
    total: result.total,
  };
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await auditLogRepository.append({
      institutionId: entry.institutionId,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      result: entry.result,
      ip: entry.context.ip,
      deviceContext: entry.context.userAgent,
      reason: entry.reason ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log entry');
  }
}
