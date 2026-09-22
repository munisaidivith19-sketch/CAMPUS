/**
 * QR token data access.
 *
 * Verification looks a token up by hash across tenants, because the scanner's own tenant must
 * not be the thing that decides validity — the token resolves to its issuing institution, and
 * the caller's tenant is then compared against it by the service (a mismatch is treated as
 * "not found", so scanning another institution's card leaks nothing).
 */
import type { QRPurpose } from '@campusconnect/types';
import { QRTokenModel, type QRTokenAttrs, type QRTokenDocument } from '../models/QRToken.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, type IdLike } from './base.repository.js';

type QRTokenEntity = QRTokenAttrs & Timestamps;

class QrTokenRepository extends TenantRepository<QRTokenEntity> {
  constructor() {
    super(QRTokenModel);
  }

  async create(data: {
    institutionId: IdLike;
    subjectUserId: IdLike;
    purpose: QRPurpose;
    tokenHash: string;
    singleUse: boolean;
    expiresAt: Date;
    issuedByUserId: IdLike;
  }): Promise<QRTokenDocument> {
    return QRTokenModel.create({
      institutionId: requireObjectId(data.institutionId),
      subjectUserId: requireObjectId(data.subjectUserId),
      subjectType: 'USER',
      purpose: data.purpose,
      tokenHash: data.tokenHash,
      singleUse: data.singleUse,
      expiresAt: data.expiresAt,
      issuedByUserId: requireObjectId(data.issuedByUserId),
    });
  }

  async findRedeemableByTokenHash(tokenHash: string): Promise<QRTokenDocument | null> {
    return QRTokenModel.findOne({
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).exec();
  }

  /** Atomic single-use claim so the same QR can't be redeemed twice concurrently. */
  async markUsed(id: IdLike): Promise<boolean> {
    const res = await QRTokenModel.updateOne(
      { _id: requireObjectId(id), usedAt: null },
      { $set: { usedAt: new Date() } },
    ).exec();
    return res.modifiedCount === 1;
  }

  /** Issuing a fresh QR invalidates the previous one for that purpose. */
  async revokeActiveForSubject(
    institutionId: IdLike,
    subjectUserId: IdLike,
    purpose: QRPurpose,
  ): Promise<number> {
    return this.updateManyScoped(
      institutionId,
      { subjectUserId: requireObjectId(subjectUserId), purpose, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
}

export const qrTokenRepository = new QrTokenRepository();
