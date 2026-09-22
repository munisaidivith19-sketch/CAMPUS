/**
 * MFA factor + OTP challenge data access.
 *
 * TOTP enrollments are durable and hold an encrypted seed; emailed OTP challenges are
 * ephemeral, single-use and attempt-capped. Both live in this collection, distinguished by
 * `type`, matching DATABASE.md's `MFA` shape.
 */
import { MfaType } from '@campusconnect/types';
import { MfaModel, type MfaAttrs, type MfaDocument } from '../models/MFA.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, type IdLike } from './base.repository.js';

type MfaEntity = MfaAttrs & Timestamps;

class MfaRepository extends TenantRepository<MfaEntity> {
  constructor() {
    super(MfaModel);
  }

  /** The user's TOTP factor, if any. Pass `withSecret` only where a code is being verified. */
  async findTotp(institutionId: IdLike, userId: IdLike, withSecret = false): Promise<MfaDocument | null> {
    return this.findOneScoped(
      institutionId,
      { userId: requireObjectId(userId), type: MfaType.TOTP },
      withSecret ? '+secretEnc' : undefined,
    );
  }

  /** Enrollment is restartable: re-enrolling replaces any unconfirmed factor. */
  async upsertTotp(institutionId: IdLike, userId: IdLike, secretEnc: string): Promise<MfaDocument | null> {
    return MfaModel.findOneAndUpdate(
      {
        institutionId: requireObjectId(institutionId),
        userId: requireObjectId(userId),
        type: MfaType.TOTP,
      },
      { $set: { secretEnc, verifiedAt: null, attempts: 0 } },
      { new: true, upsert: true },
    ).exec();
  }

  async markTotpVerified(institutionId: IdLike, userId: IdLike): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { userId: requireObjectId(userId), type: MfaType.TOTP },
      { $set: { verifiedAt: new Date(), attempts: 0 } },
    );
  }

  async deleteTotp(institutionId: IdLike, userId: IdLike): Promise<void> {
    await MfaModel.deleteOne({
      institutionId: requireObjectId(institutionId),
      userId: requireObjectId(userId),
      type: MfaType.TOTP,
    }).exec();
  }

  /** Create a fresh emailed OTP challenge, replacing any outstanding one for the user. */
  async createOtpChallenge(data: {
    institutionId: IdLike;
    userId: IdLike;
    codeHash: string;
    expiresAt: Date;
  }): Promise<MfaDocument> {
    await MfaModel.deleteMany({
      institutionId: requireObjectId(data.institutionId),
      userId: requireObjectId(data.userId),
      type: MfaType.OTP,
      consumedAt: null,
    }).exec();

    return MfaModel.create({
      institutionId: requireObjectId(data.institutionId),
      userId: requireObjectId(data.userId),
      type: MfaType.OTP,
      codeHash: data.codeHash,
      expiresAt: data.expiresAt,
      attempts: 0,
    });
  }

  async findActiveOtp(institutionId: IdLike, userId: IdLike): Promise<MfaDocument | null> {
    return this.findOneScoped(
      institutionId,
      {
        userId: requireObjectId(userId),
        type: MfaType.OTP,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      },
      '+codeHash',
    );
  }

  async incrementOtpAttempts(id: IdLike): Promise<number> {
    const updated = await MfaModel.findOneAndUpdate(
      { _id: requireObjectId(id) },
      { $inc: { attempts: 1 } },
      { new: true },
    ).exec();
    return updated?.attempts ?? 0;
  }

  /** Atomic single-use claim for an OTP challenge. */
  async consumeOtp(id: IdLike): Promise<boolean> {
    const res = await MfaModel.updateOne(
      { _id: requireObjectId(id), consumedAt: null },
      { $set: { consumedAt: new Date() } },
    ).exec();
    return res.modifiedCount === 1;
  }
}

export const mfaRepository = new MfaRepository();
