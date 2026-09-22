/** Login history data access. Write-mostly: recorded on every attempt, read by the owner. */
import type { LoginFailureReason, LoginResult } from '@campusconnect/types';
import {
  LoginHistoryModel,
  type LoginHistoryAttrs,
  type LoginHistoryDocument,
} from '../models/LoginHistory.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, type IdLike, type Page, type PageRequest } from './base.repository.js';

type LoginHistoryEntity = LoginHistoryAttrs & Timestamps;

class LoginHistoryRepository extends TenantRepository<LoginHistoryEntity> {
  constructor() {
    super(LoginHistoryModel);
  }

  async record(entry: {
    institutionId: IdLike;
    userId: IdLike;
    ip: string;
    device: string;
    userAgent: string;
    result: LoginResult;
    reason?: LoginFailureReason | null;
  }): Promise<void> {
    await LoginHistoryModel.create({
      institutionId: requireObjectId(entry.institutionId),
      userId: requireObjectId(entry.userId),
      ip: entry.ip,
      device: entry.device,
      userAgent: entry.userAgent,
      result: entry.result,
      reason: entry.reason ?? null,
      at: new Date(),
    });
  }

  async listForUser(
    institutionId: IdLike,
    userId: IdLike,
    page: PageRequest,
  ): Promise<Page<LoginHistoryDocument>> {
    return this.pageScoped(institutionId, { userId: requireObjectId(userId) }, page, { at: -1 });
  }

  /** Recent failures power the "suspicious login" signal surfaced on the security dashboard. */
  async countRecentFailures(institutionId: IdLike, userId: IdLike, since: Date): Promise<number> {
    return this.countScoped(institutionId, {
      userId: requireObjectId(userId),
      result: 'FAILURE',
      at: { $gte: since },
    });
  }
}

export const loginHistoryRepository = new LoginHistoryRepository();
