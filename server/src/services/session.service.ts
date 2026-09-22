/**
 * Session lifecycle: issue, rotate (with reuse detection), list and revoke.
 *
 * Rotation is the security-relevant part. Every refresh mints a brand-new token and retires the
 * old hash. If a retired token is ever presented again, that means the token was captured and
 * replayed (the legitimate client would have moved on to the new one), so the entire session is
 * revoked rather than merely refusing the request — the attacker and the victim both lose the
 * session, and the event is audited.
 */
import type { SessionDTO } from '@campusconnect/types';
import type { SessionDocument } from '../models/Session.model.js';
import { sessionRepository } from '../repositories/session.repository.js';
import type { IdLike } from '../repositories/base.repository.js';
import type { RequestContext } from '../utils/requestContext.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from './token.service.js';

export interface IssuedSession {
  session: SessionDocument;
  refreshToken: string;
}

export async function createSession(
  institutionId: IdLike,
  userId: IdLike,
  context: RequestContext,
): Promise<IssuedSession> {
  const { token, hash } = generateRefreshToken();
  const session = await sessionRepository.create({
    institutionId,
    userId,
    refreshTokenHash: hash,
    device: context.device,
    deviceFingerprintHash: context.fingerprint,
    ip: context.ip,
    userAgent: context.userAgent,
    expiresAt: refreshTokenExpiryDate(),
  });
  return { session, refreshToken: token };
}

export type RotateOutcome =
  | { status: 'ROTATED'; session: SessionDocument; refreshToken: string }
  | { status: 'REUSE_DETECTED'; session: SessionDocument }
  | { status: 'INVALID' };

/**
 * Exchange a refresh token for a fresh one. Returns a discriminated outcome instead of
 * throwing, because the caller must audit `REUSE_DETECTED` differently from a plain miss.
 */
export async function rotateSession(
  presentedToken: string,
  context: RequestContext,
): Promise<RotateOutcome> {
  const presentedHash = hashRefreshToken(presentedToken);

  const live = await sessionRepository.findLiveByTokenHash(presentedHash);
  if (live) {
    const { token: nextToken, hash: nextHash } = generateRefreshToken();
    const rotated = await sessionRepository.rotateToken(live._id, presentedHash, nextHash, context.ip);
    // Losing the atomic swap means a concurrent refresh won; treat it as invalid, not as reuse.
    if (!rotated) return { status: 'INVALID' };
    return { status: 'ROTATED', session: rotated, refreshToken: nextToken };
  }

  const replayed = await sessionRepository.findByRotatedTokenHash(presentedHash);
  if (replayed) {
    await sessionRepository.revokeById(replayed._id, 'REFRESH_TOKEN_REUSE_DETECTED');
    return { status: 'REUSE_DETECTED', session: replayed };
  }

  return { status: 'INVALID' };
}

export async function listSessions(
  institutionId: IdLike,
  userId: IdLike,
  currentSessionId: string | undefined,
): Promise<SessionDTO[]> {
  const sessions = await sessionRepository.listActiveForUser(institutionId, userId);
  return sessions.map((session) => toSessionDTO(session, currentSessionId));
}

export function toSessionDTO(session: SessionDocument, currentSessionId?: string): SessionDTO {
  return {
    id: String(session._id),
    device: session.device,
    ip: session.ip,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    current: currentSessionId !== undefined && String(session._id) === currentSessionId,
  };
}

export async function revokeSession(
  institutionId: IdLike,
  userId: IdLike,
  sessionId: IdLike,
  reason: string,
): Promise<boolean> {
  return sessionRepository.revokeOwnedById(institutionId, userId, sessionId, reason);
}

export async function revokeOtherSessions(
  institutionId: IdLike,
  userId: IdLike,
  keepSessionId: IdLike | undefined,
  reason: string,
): Promise<number> {
  return sessionRepository.revokeAllForUser(institutionId, userId, reason, keepSessionId);
}

export async function revokeAllSessions(
  institutionId: IdLike,
  userId: IdLike,
  reason: string,
): Promise<number> {
  return sessionRepository.revokeAllForUser(institutionId, userId, reason);
}
