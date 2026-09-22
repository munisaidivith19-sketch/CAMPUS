/**
 * The security-dashboard foundation: what a user can see about access to their own account.
 *
 * Everything here is strictly self-scoped. There is no parameter for "someone else's" history —
 * the caller's id comes from their principal, so this service cannot be pointed at another
 * account even by a caller who holds an administrative permission.
 */
import type { LoginHistoryDTO, SessionDTO } from '@campusconnect/types';
import { loginHistoryRepository } from '../repositories/loginHistory.repository.js';
import type { IdLike, PageRequest } from '../repositories/base.repository.js';
import { listSessions } from './session.service.js';
import type { LoginHistoryDocument } from '../models/LoginHistory.model.js';

const SUSPICIOUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function toLoginHistoryDTO(entry: LoginHistoryDocument): LoginHistoryDTO {
  return {
    id: String(entry._id),
    ip: entry.ip,
    device: entry.device,
    result: entry.result,
    reason: entry.reason ?? null,
    at: entry.at.toISOString(),
  };
}

export async function listLoginHistory(
  institutionId: IdLike,
  userId: IdLike,
  page: PageRequest,
): Promise<{ items: LoginHistoryDTO[]; total: number }> {
  const result = await loginHistoryRepository.listForUser(institutionId, userId, page);
  return { items: result.items.map(toLoginHistoryDTO), total: result.total };
}

export interface SecurityOverview {
  mfaEnabled: boolean;
  activeSessions: SessionDTO[];
  recentLogins: LoginHistoryDTO[];
  failedAttemptsLast7Days: number;
}

export async function getSecurityOverview(
  institutionId: IdLike,
  userId: IdLike,
  currentSessionId: string | undefined,
  mfaEnabled: boolean,
): Promise<SecurityOverview> {
  const since = new Date(Date.now() - SUSPICIOUS_WINDOW_MS);

  const [activeSessions, recent, failedAttemptsLast7Days] = await Promise.all([
    listSessions(institutionId, userId, currentSessionId),
    loginHistoryRepository.listForUser(institutionId, userId, { page: 1, limit: 10 }),
    loginHistoryRepository.countRecentFailures(institutionId, userId, since),
  ]);

  return {
    mfaEnabled,
    activeSessions,
    recentLogins: recent.items.map(toLoginHistoryDTO),
    failedAttemptsLast7Days,
  };
}
