/**
 * Discussion, comment and moderation data access.
 *
 * Removal is a status change, never a delete: an appeal or an investigation needs the content
 * that was removed, and the audit entry recording the removal has to point at something that
 * still exists. Ordinary readers simply never see `REMOVED` rows.
 */
import type { FilterQuery } from 'mongoose';
import { ContentStatus } from '@campusconnect/types';
import {
  DiscussionModel,
  type DiscussionAttrs,
  type DiscussionDocument,
} from '../models/Discussion.model.js';
import { CommentModel, type CommentAttrs, type CommentDocument } from '../models/Comment.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type DiscussionEntity = DiscussionAttrs & Timestamps;
type CommentEntity = CommentAttrs & Timestamps;

class DiscussionRepository extends TenantRepository<DiscussionEntity> {
  constructor() {
    super(DiscussionModel);
  }

  /** Visible to ordinary readers: removed threads are invisible unless explicitly requested. */
  async findVisibleById(institutionId: IdLike, id: IdLike): Promise<DiscussionDocument | null> {
    const objectId = toObjectId(id);
    if (!objectId) return null;
    return this.findOneScoped(institutionId, { _id: objectId, status: ContentStatus.VISIBLE });
  }

  /** Includes removed content — for moderators only. */
  async findAnyById(institutionId: IdLike, id: IdLike): Promise<DiscussionDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: { category?: string; tag?: string; search?: string } = {},
  ): Promise<Page<DiscussionDocument>> {
    const filter: FilterQuery<DiscussionEntity> = { status: ContentStatus.VISIBLE };
    if (filters.category) filter.category = filters.category;
    if (filters.tag) filter.tags = filters.tag.toLowerCase();
    if (filters.search) filter.$text = { $search: filters.search };
    return this.pageScoped(institutionId, filter, page, { createdAt: -1 });
  }

  /** The moderation queue: reported content, most-reported first. */
  async listReported(institutionId: IdLike, page: PageRequest): Promise<Page<DiscussionDocument>> {
    return this.pageScoped(institutionId, { reportedCount: { $gt: 0 } }, page, {
      reportedCount: -1,
      createdAt: -1,
    });
  }

  async create(data: {
    institutionId: IdLike;
    authorUserId: IdLike;
    title: string;
    body: string;
    category: string;
    tags: string[];
  }): Promise<DiscussionDocument> {
    return DiscussionModel.create({
      institutionId: requireObjectId(data.institutionId),
      authorUserId: requireObjectId(data.authorUserId),
      title: data.title,
      body: data.body,
      category: data.category,
      tags: data.tags,
      commentCount: 0,
      reportedCount: 0,
      status: ContentStatus.VISIBLE,
    });
  }

  async incrementCommentCount(institutionId: IdLike, discussionId: IdLike, delta: number): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(discussionId) },
      { $inc: { commentCount: delta } },
    );
  }

  async incrementReportCount(institutionId: IdLike, discussionId: IdLike): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(discussionId) },
      { $inc: { reportedCount: 1 } },
    );
  }

  async remove(
    institutionId: IdLike,
    discussionId: IdLike,
    moderatorUserId: IdLike,
    reason: string | null,
  ): Promise<DiscussionDocument | null> {
    return DiscussionModel.findOneAndUpdate(
      {
        _id: requireObjectId(discussionId),
        institutionId: requireObjectId(institutionId),
        status: ContentStatus.VISIBLE,
      },
      {
        $set: {
          status: ContentStatus.REMOVED,
          removedByUserId: requireObjectId(moderatorUserId),
          removedAt: new Date(),
          removalReason: reason,
        },
      },
      { new: true },
    ).exec();
  }

  /** Dismissing a report clears the queue entry without touching the content. */
  async clearReports(institutionId: IdLike, discussionId: IdLike): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(discussionId) },
      { $set: { reportedCount: 0 } },
    );
  }

  async search(institutionId: IdLike, term: string, limit: number): Promise<DiscussionDocument[]> {
    return DiscussionModel.find(
      this.scoped(institutionId, { status: ContentStatus.VISIBLE, $text: { $search: term } }),
    )
      .limit(limit)
      .exec();
  }
}

class CommentRepository extends TenantRepository<CommentEntity> {
  constructor() {
    super(CommentModel);
  }

  async findAnyById(institutionId: IdLike, id: IdLike): Promise<CommentDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async listForDiscussion(
    institutionId: IdLike,
    discussionId: IdLike,
    page: PageRequest,
  ): Promise<Page<CommentDocument>> {
    return this.pageScoped(
      institutionId,
      { discussionId: requireObjectId(discussionId), status: ContentStatus.VISIBLE },
      page,
      { createdAt: 1 },
    );
  }

  async listReported(institutionId: IdLike, page: PageRequest): Promise<Page<CommentDocument>> {
    return this.pageScoped(institutionId, { reportedCount: { $gt: 0 } }, page, {
      reportedCount: -1,
      createdAt: -1,
    });
  }

  async create(data: {
    institutionId: IdLike;
    discussionId: IdLike;
    parentCommentId?: IdLike | null;
    authorUserId: IdLike;
    body: string;
  }): Promise<CommentDocument> {
    return CommentModel.create({
      institutionId: requireObjectId(data.institutionId),
      discussionId: requireObjectId(data.discussionId),
      parentCommentId: data.parentCommentId ? requireObjectId(data.parentCommentId) : null,
      authorUserId: requireObjectId(data.authorUserId),
      body: data.body,
      reactedByUserIds: [],
      reportedCount: 0,
      status: ContentStatus.VISIBLE,
    });
  }

  /** Toggle a reaction. Storing the reactor set makes this idempotent per user. */
  async toggleReaction(
    institutionId: IdLike,
    commentId: IdLike,
    userId: IdLike,
  ): Promise<CommentDocument | null> {
    const user = requireObjectId(userId);
    const existing = await this.findByIdScoped(institutionId, commentId);
    if (!existing) return null;

    const hasReacted = existing.reactedByUserIds.some((id) => String(id) === String(user));
    return CommentModel.findOneAndUpdate(
      { _id: requireObjectId(commentId), institutionId: requireObjectId(institutionId) },
      hasReacted ? { $pull: { reactedByUserIds: user } } : { $addToSet: { reactedByUserIds: user } },
      { new: true },
    ).exec();
  }

  async incrementReportCount(institutionId: IdLike, commentId: IdLike): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(commentId) },
      { $inc: { reportedCount: 1 } },
    );
  }

  async remove(
    institutionId: IdLike,
    commentId: IdLike,
    moderatorUserId: IdLike,
    reason: string | null,
  ): Promise<CommentDocument | null> {
    return CommentModel.findOneAndUpdate(
      {
        _id: requireObjectId(commentId),
        institutionId: requireObjectId(institutionId),
        status: ContentStatus.VISIBLE,
      },
      {
        $set: {
          status: ContentStatus.REMOVED,
          removedByUserId: requireObjectId(moderatorUserId),
          removedAt: new Date(),
          removalReason: reason,
        },
      },
      { new: true },
    ).exec();
  }

  async clearReports(institutionId: IdLike, commentId: IdLike): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(commentId) },
      { $set: { reportedCount: 0 } },
    );
  }

  async countVisibleForDiscussion(institutionId: IdLike, discussionId: IdLike): Promise<number> {
    return this.countScoped(institutionId, {
      discussionId: requireObjectId(discussionId),
      status: ContentStatus.VISIBLE,
    });
  }
}

export const discussionRepository = new DiscussionRepository();
export const commentRepository = new CommentRepository();
