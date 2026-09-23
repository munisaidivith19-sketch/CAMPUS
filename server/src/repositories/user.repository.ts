/**
 * User data access.
 *
 * Secret-bearing fields are `select: false` on the schema, so the default read path cannot leak
 * them; the few call sites that genuinely need a hash ask for it explicitly via the
 * `*WithSecrets` methods. Queries are built from allowlisted fields only — no user-supplied
 * object is ever spread into a filter.
 */
import { UserStatus, type Role } from '@campusconnect/types';
import type { FilterQuery } from 'mongoose';
import { UserModel, type UserAttrs, type UserDocument } from '../models/User.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, type IdLike, type Page, type PageRequest } from './base.repository.js';

type UserEntity = UserAttrs & Timestamps;

class UserRepository extends TenantRepository<UserEntity> {
  constructor() {
    super(UserModel);
  }

  async findByEmail(institutionId: IdLike, email: string): Promise<UserDocument | null> {
    return this.findOneScoped(institutionId, { email: email.toLowerCase(), deletedAt: null });
  }

  /** Login path: the only place that needs the Argon2id hash. */
  async findByEmailWithPassword(institutionId: IdLike, email: string): Promise<UserDocument | null> {
    return this.findOneScoped(institutionId, { email: email.toLowerCase(), deletedAt: null }, '+passwordHash');
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<UserDocument | null> {
    return this.findByIdScoped(institutionId, id, undefined);
  }

  async findByIdWithPassword(institutionId: IdLike, id: IdLike): Promise<UserDocument | null> {
    return this.findByIdScoped(institutionId, id, '+passwordHash');
  }

  /**
   * Email-verification lookup is intentionally NOT tenant-scoped: the verification link is
   * clicked by an anonymous browser with no tenant context, and the high-entropy token is
   * itself the credential. The tenant is then taken FROM the matched document, never from the
   * request — so this widens nothing downstream.
   */
  async findByVerificationTokenHash(tokenHash: string): Promise<UserDocument | null> {
    return UserModel.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
      deletedAt: null,
    })
      .select('+emailVerificationTokenHash')
      .exec();
  }

  async create(data: {
    institutionId: IdLike;
    email: string;
    passwordHash: string;
    fullName: string;
    status: UserStatus;
    roles: Role[];
    primaryRole: Role;
    emailVerificationTokenHash?: string | null;
    emailVerificationExpiresAt?: Date | null;
  }): Promise<UserDocument> {
    return UserModel.create({
      institutionId: requireObjectId(data.institutionId),
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      fullName: data.fullName,
      status: data.status,
      roles: data.roles,
      primaryRole: data.primaryRole,
      emailVerificationTokenHash: data.emailVerificationTokenHash ?? null,
      emailVerificationExpiresAt: data.emailVerificationExpiresAt ?? null,
    });
  }

  async listUsers(
    institutionId: IdLike,
    page: PageRequest,
    filters: { role?: Role; status?: UserStatus } = {},
  ): Promise<Page<UserDocument>> {
    const filter: FilterQuery<UserEntity> = { deletedAt: null };
    // Allowlisted filters only — never the raw query object.
    if (filters.role) filter.roles = filters.role;
    if (filters.status) filter.status = filters.status;
    return this.pageScoped(institutionId, filter, page, { createdAt: -1 });
  }

  /**
   * Find active users by name, for the chat user picker.
   *
   * A search, never a listing: the caller must supply a term, the result is capped by the
   * caller's schema, and the term is escaped before it reaches a regex so a student cannot pass
   * `.*` and receive the whole institution.
   */
  async searchActiveByName(
    institutionId: IdLike,
    term: string,
    limit: number,
  ): Promise<UserDocument[]> {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return UserModel.find(
      this.scoped(institutionId, {
        deletedAt: null,
        status: UserStatus.ACTIVE,
        fullName: { $regex: escaped, $options: 'i' },
      } as FilterQuery<UserEntity>),
    )
      .sort({ fullName: 1 })
      .limit(Math.min(limit, 20))
      .exec();
  }

  async markEmailVerified(institutionId: IdLike, userId: IdLike, status: UserStatus): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(userId) },
      {
        $set: {
          status,
          emailVerifiedAt: new Date(),
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        },
      },
    );
  }

  async setVerificationToken(
    institutionId: IdLike,
    userId: IdLike,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(userId) },
      { $set: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt } },
    );
  }

  /** Successful login: reset the backoff counters and remember the device fingerprint. */
  async recordSuccessfulLogin(
    institutionId: IdLike,
    userId: IdLike,
    deviceFingerprintHash: string,
    maxKnownDevices = 20,
  ): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(userId) },
      {
        $set: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
        // $each + $slice keeps the array bounded so the document can't grow without limit.
        $push: { knownDeviceHashes: { $each: [deviceFingerprintHash], $slice: -maxKnownDevices } },
      },
    );
  }

  async incrementFailedLogins(institutionId: IdLike, userId: IdLike): Promise<number> {
    const updated = await UserModel.findOneAndUpdate(
      { _id: requireObjectId(userId), institutionId: requireObjectId(institutionId) },
      { $inc: { failedLoginAttempts: 1 } },
      { new: true },
    ).exec();
    return updated?.failedLoginAttempts ?? 0;
  }

  async lockAccount(institutionId: IdLike, userId: IdLike, until: Date): Promise<void> {
    await this.updateOneScoped(institutionId, { _id: requireObjectId(userId) }, { $set: { lockedUntil: until } });
  }

  async setPasswordHash(institutionId: IdLike, userId: IdLike, passwordHash: string): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(userId) },
      { $set: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } },
    );
  }

  /**
   * Register a device for push.
   *
   * Pull-then-push rather than `$addToSet`: it both deduplicates (re-registering the same device
   * is a no-op) and keeps the list bounded via `$slice`, which `$addToSet` cannot do. A user who
   * reinstalls repeatedly therefore cannot grow this without limit.
   */
  async addPushToken(institutionId: IdLike, userId: IdLike, token: string, maxTokens = 10): Promise<void> {
    const filter = { _id: requireObjectId(userId) };
    await this.updateOneScoped(institutionId, filter, { $pull: { pushTokens: token } });
    await this.updateOneScoped(institutionId, filter, {
      $push: { pushTokens: { $each: [token], $slice: -maxTokens } },
    });
  }

  async removePushToken(institutionId: IdLike, userId: IdLike, token: string): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(userId) },
      { $pull: { pushTokens: token } },
    );
  }

  async setMfaEnabled(institutionId: IdLike, userId: IdLike, enabled: boolean): Promise<void> {
    await this.updateOneScoped(institutionId, { _id: requireObjectId(userId) }, { $set: { mfaEnabled: enabled } });
  }

  /** Only the two self-service fields are updatable here; everything else is off-limits. */
  async updateBasicFields(
    institutionId: IdLike,
    userId: IdLike,
    fields: { fullName?: string; phone?: string },
  ): Promise<UserDocument | null> {
    const $set: Record<string, unknown> = {};
    if (fields.fullName !== undefined) $set.fullName = fields.fullName;
    if (fields.phone !== undefined) $set.phone = fields.phone;
    if (Object.keys($set).length === 0) return this.findById(institutionId, userId);
    return UserModel.findOneAndUpdate(
      { _id: requireObjectId(userId), institutionId: requireObjectId(institutionId) },
      { $set },
      { new: true },
    ).exec();
  }

  async setRoles(
    institutionId: IdLike,
    userId: IdLike,
    roles: Role[],
    primaryRole: Role,
  ): Promise<UserDocument | null> {
    return UserModel.findOneAndUpdate(
      { _id: requireObjectId(userId), institutionId: requireObjectId(institutionId) },
      { $set: { roles, primaryRole } },
      { new: true },
    ).exec();
  }
}

export const userRepository = new UserRepository();
