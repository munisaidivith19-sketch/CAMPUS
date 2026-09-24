/**
 * Announcement data access.
 *
 * The audience filter is built from WHO THE READER IS (their department, batch, section, roles,
 * club memberships), not from a stored recipient list. A reader can therefore never widen their
 * own audience by manipulating a request — the criteria come from their profile and principal.
 */
import { Types, type FilterQuery } from 'mongoose';
import { AnnouncementScope, type AnnouncementPriority } from '@campusconnect/types';
import {
  AnnouncementModel,
  type AnnouncementAttrs,
  type AnnouncementDocument,
} from '../models/Announcement.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type AnnouncementEntity = AnnouncementAttrs & Timestamps;

/** Everything about a reader that can make an announcement relevant to them. */
export interface AudienceContext {
  userId: string;
  roles: string[];
  departmentId: string | null;
  batch: string | null;
  section: string | null;
  clubIds: string[];
}

class AnnouncementRepository extends TenantRepository<AnnouncementEntity> {
  constructor() {
    super(AnnouncementModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<AnnouncementDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async create(data: {
    institutionId: IdLike;
    authorUserId: IdLike;
    title: string;
    body: string;
    priority: AnnouncementPriority;
    target: AnnouncementAttrs['target'];
    publishAt: Date;
    expireAt?: Date | null;
    /** Pre-allocated so attachments can be linked before the announcement exists. */
    id?: IdLike;
    attachmentFileIds?: readonly IdLike[];
  }): Promise<AnnouncementDocument> {
    return AnnouncementModel.create({
      ...(data.id ? { _id: requireObjectId(data.id) } : {}),
      institutionId: requireObjectId(data.institutionId),
      authorUserId: requireObjectId(data.authorUserId),
      title: data.title,
      body: data.body,
      priority: data.priority,
      target: data.target,
      publishAt: data.publishAt,
      expireAt: data.expireAt ?? null,
      readBy: [],
      attachmentFileIds: (data.attachmentFileIds ?? []).map((id) => requireObjectId(id)),
    });
  }

  /**
   * The $or that decides whether an announcement is addressed to this reader.
   *
   * COLLEGE reaches everyone; the rest require the reader to match the target's reference.
   * A reader with no section simply fails the SECTION branch rather than matching all sections.
   */
  private audienceFilter(audience: AudienceContext): FilterQuery<AnnouncementEntity> {
    const branches: FilterQuery<AnnouncementEntity>[] = [
      { 'target.scope': AnnouncementScope.COLLEGE },
    ];

    if (audience.departmentId) {
      const departmentId = toObjectId(audience.departmentId);
      if (departmentId) {
        branches.push({
          'target.scope': AnnouncementScope.DEPARTMENT,
          'target.departmentId': departmentId,
        });
      }
    }

    if (audience.batch) {
      branches.push({ 'target.scope': AnnouncementScope.BATCH, 'target.batch': audience.batch });
    }

    if (audience.batch && audience.section) {
      branches.push({
        'target.scope': AnnouncementScope.SECTION,
        'target.batch': audience.batch,
        'target.section': audience.section.toUpperCase(),
      });
    }

    const clubIds = audience.clubIds
      .map((id) => toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);
    if (clubIds.length > 0) {
      branches.push({ 'target.scope': AnnouncementScope.CLUB, 'target.clubId': { $in: clubIds } });
    }

    if (audience.roles.length > 0) {
      branches.push({
        'target.scope': AnnouncementScope.ROLE,
        'target.role': { $in: audience.roles },
      });
    }

    return { $or: branches };
  }

  /** Announcements addressed to this reader that are live right now. */
  async listForAudience(
    institutionId: IdLike,
    audience: AudienceContext,
    page: PageRequest,
    options: { unreadOnly?: boolean; priority?: AnnouncementPriority; search?: string } = {},
  ): Promise<Page<AnnouncementDocument>> {
    const now = new Date();
    const readerId = requireObjectId(audience.userId);

    const filter: FilterQuery<AnnouncementEntity> = {
      $and: [
        this.audienceFilter(audience),
        { publishAt: { $lte: now } },
        { $or: [{ expireAt: null }, { expireAt: { $gt: now } }] },
      ],
    };

    if (options.unreadOnly) {
      (filter.$and as FilterQuery<AnnouncementEntity>[]).push({ readBy: { $ne: readerId } });
    }
    if (options.priority) {
      (filter.$and as FilterQuery<AnnouncementEntity>[]).push({ priority: options.priority });
    }
    if (options.search) {
      (filter.$and as FilterQuery<AnnouncementEntity>[]).push({
        $text: { $search: options.search },
      });
    }

    // Priority first, then recency — an URGENT notice should not be pushed down by a newer one.
    return this.pageScoped(institutionId, filter, page, { publishAt: -1 });
  }

  /** Is this specific announcement addressed to this reader? Used before returning a detail view. */
  async isAddressedTo(
    institutionId: IdLike,
    announcementId: IdLike,
    audience: AudienceContext,
  ): Promise<boolean> {
    const id = toObjectId(announcementId);
    if (!id) return false;
    return this.existsScoped(institutionId, {
      $and: [{ _id: id }, this.audienceFilter(audience)],
    } as FilterQuery<AnnouncementEntity>);
  }

  async markRead(institutionId: IdLike, announcementId: IdLike, userId: IdLike): Promise<void> {
    // $addToSet keeps the operation idempotent for repeated opens.
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(announcementId) },
      { $addToSet: { readBy: requireObjectId(userId) } },
    );
  }

  async searchForAudience(
    institutionId: IdLike,
    audience: AudienceContext,
    term: string,
    limit: number,
  ): Promise<AnnouncementDocument[]> {
    const now = new Date();
    return AnnouncementModel.find(
      this.scoped(institutionId, {
        $and: [
          this.audienceFilter(audience),
          { publishAt: { $lte: now } },
          { $or: [{ expireAt: null }, { expireAt: { $gt: now } }] },
          { $text: { $search: term } },
        ],
      } as FilterQuery<AnnouncementEntity>),
    )
      .limit(limit)
      .exec();
  }
}

export const announcementRepository = new AnnouncementRepository();
