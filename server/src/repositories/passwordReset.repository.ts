/**
 * Password-reset token data access.
 *
 * Lookup is by token hash and not tenant-scoped, for the same reason as email verification:
 * the person clicking the link is anonymous, and the high-entropy token IS the credential.
 * Single use is enforced in the query (`usedAt: null`) plus an atomic `markUsed`, so a token
 * cannot be redeemed twice even under concurrent requests.
 */
import {
  PasswordResetModel,
  type PasswordResetAttrs,
  type PasswordResetDocument,
} from '../models/PasswordReset.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, type IdLike } from './base.repository.js';

type PasswordResetEntity = PasswordResetAttrs & Timestamps;

class PasswordResetRepository extends TenantRepository<PasswordResetEntity> {
  constructor() {
    super(PasswordResetModel);
  }

  async create(data: {
    institutionId: IdLike;
    userId: IdLike;
    tokenHash: string;
    requestedIp: string;
    expiresAt: Date;
  }): Promise<PasswordResetDocument> {
    return PasswordResetModel.create({
      institutionId: requireObjectId(data.institutionId),
      userId: requireObjectId(data.userId),
      tokenHash: data.tokenHash,
      requestedIp: data.requestedIp,
      expiresAt: data.expiresAt,
    });
  }

  async findRedeemableByTokenHash(tokenHash: string): Promise<PasswordResetDocument | null> {
    return PasswordResetModel.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .select('+tokenHash')
      .exec();
  }

  /** Atomic single-use claim: returns false if another request already redeemed it. */
  async markUsed(id: IdLike): Promise<boolean> {
    const res = await PasswordResetModel.updateOne(
      { _id: requireObjectId(id), usedAt: null },
      { $set: { usedAt: new Date() } },
    ).exec();
    return res.modifiedCount === 1;
  }

  /** After a successful reset, no other outstanding token for that user may remain valid. */
  async invalidateAllForUser(institutionId: IdLike, userId: IdLike): Promise<number> {
    return this.updateManyScoped(
      institutionId,
      { userId: requireObjectId(userId), usedAt: null },
      { $set: { usedAt: new Date() } },
    );
  }

  /** Rate-limit input: how many resets this user has requested recently. */
  async countRecentForUser(institutionId: IdLike, userId: IdLike, since: Date): Promise<number> {
    return this.countScoped(institutionId, { userId: requireObjectId(userId), createdAt: { $gte: since } });
  }
}

export const passwordResetRepository = new PasswordResetRepository();
