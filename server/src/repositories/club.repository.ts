/** Club and membership data access. */
import { Types, type FilterQuery } from 'mongoose';
import { ClubMemberRole, ClubMembershipStatus } from '@campusconnect/types';
import { ClubModel, type ClubAttrs, type ClubDocument } from '../models/Club.model.js';
import {
  ClubMembershipModel,
  type ClubMembershipAttrs,
  type ClubMembershipDocument,
} from '../models/ClubMembership.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type ClubEntity = ClubAttrs & Timestamps;
type MembershipEntity = ClubMembershipAttrs & Timestamps;

class ClubRepository extends TenantRepository<ClubEntity> {
  constructor() {
    super(ClubModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<ClubDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: { category?: string; search?: string; interests?: string[] } = {},
  ): Promise<Page<ClubDocument>> {
    const filter: FilterQuery<ClubEntity> = {};
    if (filters.category) filter.category = filters.category;
    if (filters.search) filter.$text = { $search: filters.search };
    // Rule-based discovery: a plain set intersection on declared interests.
    if (filters.interests && filters.interests.length > 0) {
      filter.interests = { $in: filters.interests.map((i) => i.toLowerCase()) };
    }
    return this.pageScoped(institutionId, filter, page, { memberCount: -1, name: 1 });
  }

  async findManyByIds(institutionId: IdLike, ids: IdLike[]): Promise<ClubDocument[]> {
    const objectIds = ids.map((id) => toObjectId(id)).filter((id): id is Types.ObjectId => id !== null);
    if (objectIds.length === 0) return [];
    return ClubModel.find(this.scoped(institutionId, { _id: { $in: objectIds } })).exec();
  }

  async create(data: {
    institutionId: IdLike;
    name: string;
    category: string;
    description: string;
    interests?: string[];
    adminUserIds?: IdLike[];
  }): Promise<ClubDocument> {
    return ClubModel.create({
      institutionId: requireObjectId(data.institutionId),
      name: data.name,
      category: data.category,
      description: data.description,
      interests: data.interests ?? [],
      adminUserIds: (data.adminUserIds ?? []).map((id) => requireObjectId(id)),
      memberCount: 0,
    });
  }

  async adjustMemberCount(institutionId: IdLike, clubId: IdLike, delta: number): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(clubId) },
      { $inc: { memberCount: delta } },
    );
  }

  async search(institutionId: IdLike, term: string, limit: number): Promise<ClubDocument[]> {
    return ClubModel.find(this.scoped(institutionId, { $text: { $search: term } }))
      .limit(limit)
      .exec();
  }
}

class ClubMembershipRepository extends TenantRepository<MembershipEntity> {
  constructor() {
    super(ClubMembershipModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<ClubMembershipDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async findForUserAndClub(
    institutionId: IdLike,
    clubId: IdLike,
    userId: IdLike,
  ): Promise<ClubMembershipDocument | null> {
    const club = toObjectId(clubId);
    const user = toObjectId(userId);
    if (!club || !user) return null;
    return this.findOneScoped(institutionId, { clubId: club, userId: user });
  }

  async listForUser(
    institutionId: IdLike,
    userId: IdLike,
    statuses: ClubMembershipStatus[] = [ClubMembershipStatus.APPROVED],
  ): Promise<ClubMembershipDocument[]> {
    const user = toObjectId(userId);
    if (!user) return [];
    return ClubMembershipModel.find(
      this.scoped(institutionId, { userId: user, status: { $in: statuses } }),
    ).exec();
  }

  async listForClub(
    institutionId: IdLike,
    clubId: IdLike,
    page: PageRequest,
    status?: ClubMembershipStatus,
  ): Promise<Page<ClubMembershipDocument>> {
    const filter: FilterQuery<MembershipEntity> = { clubId: requireObjectId(clubId) };
    if (status) filter.status = status;
    return this.pageScoped(institutionId, filter, page, { createdAt: -1 });
  }

  /**
   * Request to join. The unique (club, user) index means a repeat request reuses the same row,
   * so a user cannot flood a club with duplicate requests.
   */
  async requestJoin(
    institutionId: IdLike,
    clubId: IdLike,
    userId: IdLike,
  ): Promise<ClubMembershipDocument | null> {
    return ClubMembershipModel.findOneAndUpdate(
      {
        institutionId: requireObjectId(institutionId),
        clubId: requireObjectId(clubId),
        userId: requireObjectId(userId),
      },
      {
        $set: { status: ClubMembershipStatus.REQUESTED, decidedByUserId: null, decidedAt: null },
        $setOnInsert: { role: ClubMemberRole.MEMBER },
      },
      { new: true, upsert: true },
    ).exec();
  }

  /** Atomically decide a pending request — two admins cannot both apply a decision. */
  async decide(
    institutionId: IdLike,
    membershipId: IdLike,
    decision: ClubMembershipStatus,
    decidedByUserId: IdLike,
  ): Promise<ClubMembershipDocument | null> {
    return ClubMembershipModel.findOneAndUpdate(
      {
        _id: requireObjectId(membershipId),
        institutionId: requireObjectId(institutionId),
        status: ClubMembershipStatus.REQUESTED,
      },
      {
        $set: {
          status: decision,
          decidedByUserId: requireObjectId(decidedByUserId),
          decidedAt: new Date(),
        },
      },
      { new: true },
    ).exec();
  }

  async countApproved(institutionId: IdLike, clubId: IdLike): Promise<number> {
    return this.countScoped(institutionId, {
      clubId: requireObjectId(clubId),
      status: ClubMembershipStatus.APPROVED,
    });
  }
}

export const clubRepository = new ClubRepository();
export const clubMembershipRepository = new ClubMembershipRepository();
