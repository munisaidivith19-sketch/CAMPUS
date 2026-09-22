/**
 * Session data access — the revocation substrate for ADR-0006.
 *
 * Refresh-token lookups are by hash and therefore not tenant-scoped: the presenter is anonymous
 * until the token resolves, and the token itself is the credential. The tenant is then read FROM
 * the session document. Everything a *logged-in* user does to their sessions ("My Devices")
 * goes through the tenant-scoped methods instead.
 */
import type { FilterQuery } from 'mongoose';
import { SessionModel, type SessionAttrs, type SessionDocument } from '../models/Session.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike } from './base.repository.js';

type SessionEntity = SessionAttrs & Timestamps;

class SessionRepository extends TenantRepository<SessionEntity> {
  constructor() {
    super(SessionModel);
  }

  async create(data: {
    institutionId: IdLike;
    userId: IdLike;
    refreshTokenHash: string;
    device: string;
    deviceFingerprintHash: string;
    ip: string;
    userAgent: string;
    expiresAt: Date;
  }): Promise<SessionDocument> {
    return SessionModel.create({
      institutionId: requireObjectId(data.institutionId),
      userId: requireObjectId(data.userId),
      refreshTokenHash: data.refreshTokenHash,
      usedTokenHashes: [],
      device: data.device,
      deviceFingerprintHash: data.deviceFingerprintHash,
      ip: data.ip,
      userAgent: data.userAgent,
      lastActiveAt: new Date(),
      expiresAt: data.expiresAt,
    });
  }

  /** The happy path: a live session whose CURRENT refresh token is the one presented. */
  async findLiveByTokenHash(tokenHash: string): Promise<SessionDocument | null> {
    return SessionModel.findOne({
      refreshTokenHash: tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).exec();
  }

  /**
   * Reuse detection: the presented token was already rotated away. Finding one here means the
   * token leaked (or was replayed), which is why the caller revokes the whole session chain.
   */
  async findByRotatedTokenHash(tokenHash: string): Promise<SessionDocument | null> {
    return SessionModel.findOne({ usedTokenHashes: tokenHash }).exec();
  }

  /**
   * Atomically swap the current refresh token for a new one, retiring the old hash. The filter
   * includes the old hash, so two concurrent refreshes with the same token cannot both win.
   */
  async rotateToken(
    sessionId: IdLike,
    previousHash: string,
    nextHash: string,
    ip: string,
    maxRetainedHashes = 10,
  ): Promise<SessionDocument | null> {
    return SessionModel.findOneAndUpdate(
      { _id: requireObjectId(sessionId), refreshTokenHash: previousHash, revokedAt: null },
      {
        $set: { refreshTokenHash: nextHash, lastActiveAt: new Date(), ip },
        $push: { usedTokenHashes: { $each: [previousHash], $slice: -maxRetainedHashes } },
      },
      { new: true },
    ).exec();
  }

  async listActiveForUser(institutionId: IdLike, userId: IdLike): Promise<SessionDocument[]> {
    return SessionModel.find(
      this.scoped(institutionId, {
        userId: requireObjectId(userId),
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      } as FilterQuery<SessionEntity>),
    )
      .sort({ lastActiveAt: -1 })
      .exec();
  }

  /** Revoke one session the caller owns. Ownership is part of the filter, not a later check. */
  async revokeOwnedById(
    institutionId: IdLike,
    userId: IdLike,
    sessionId: IdLike,
    reason: string,
  ): Promise<boolean> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return false;
    const modified = await this.updateOneScoped(
      institutionId,
      { _id: objectId, userId: requireObjectId(userId), revokedAt: null } as FilterQuery<SessionEntity>,
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    );
    return modified > 0;
  }

  /** Revoke every live session for a user, optionally keeping the one making the request. */
  async revokeAllForUser(
    institutionId: IdLike,
    userId: IdLike,
    reason: string,
    exceptSessionId?: IdLike,
  ): Promise<number> {
    const filter: FilterQuery<SessionEntity> = {
      userId: requireObjectId(userId),
      revokedAt: null,
    };
    if (exceptSessionId) {
      const keep = toObjectId(exceptSessionId);
      if (keep) filter._id = { $ne: keep };
    }
    return this.updateManyScoped(institutionId, filter, {
      $set: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Used by reuse detection, where the tenant comes from the session document itself. */
  async revokeById(sessionId: IdLike, reason: string): Promise<void> {
    await SessionModel.updateOne(
      { _id: requireObjectId(sessionId), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    ).exec();
  }

  async findLiveById(sessionId: IdLike): Promise<SessionDocument | null> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return null;
    return SessionModel.findOne({ _id: objectId, revokedAt: null, expiresAt: { $gt: new Date() } }).exec();
  }

  async touch(sessionId: IdLike): Promise<void> {
    await SessionModel.updateOne(
      { _id: requireObjectId(sessionId) },
      { $set: { lastActiveAt: new Date() } },
    ).exec();
  }
}

export const sessionRepository = new SessionRepository();
