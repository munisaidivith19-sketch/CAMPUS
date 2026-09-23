/**
 * Notification data access.
 *
 * Reads are always scoped to `recipientUserId` taken from the caller's principal — there is no
 * method here that fetches another user's notifications, so the "read someone else's inbox"
 * mistake cannot be made further up the stack.
 */
import type { FilterQuery } from 'mongoose';
import { NotificationChannel, type NotificationType } from '@campusconnect/types';
import {
  NotificationModel,
  READ_NOTIFICATION_RETENTION_MS,
  type NotificationAttrs,
  type NotificationDocument,
} from '../models/Notification.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type NotificationEntity = NotificationAttrs & Timestamps;

export interface NotificationDraft {
  recipientUserId: IdLike;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
}

class NotificationRepository extends TenantRepository<NotificationEntity> {
  constructor() {
    super(NotificationModel);
  }

  async createMany(institutionId: IdLike, drafts: NotificationDraft[]): Promise<number> {
    if (drafts.length === 0) return 0;
    const institution = requireObjectId(institutionId);

    const documents = drafts.map((draft) => ({
      institutionId: institution,
      recipientUserId: requireObjectId(draft.recipientUserId),
      type: draft.type,
      title: draft.title,
      body: draft.body,
      link: draft.link ?? null,
      // Part A delivers in-app only; Part B adds PUSH/EMAIL to this list.
      channels: [NotificationChannel.IN_APP],
      readAt: null,
      autoDeleteAt: null,
    }));

    const created = await NotificationModel.insertMany(documents, { ordered: false });
    return created.length;
  }

  async listForRecipient(
    institutionId: IdLike,
    recipientUserId: IdLike,
    page: PageRequest,
    unreadOnly = false,
  ): Promise<Page<NotificationDocument>> {
    const filter: FilterQuery<NotificationEntity> = {
      recipientUserId: requireObjectId(recipientUserId),
    };
    if (unreadOnly) filter.readAt = null;
    return this.pageScoped(institutionId, filter, page, { createdAt: -1 });
  }

  async countUnread(institutionId: IdLike, recipientUserId: IdLike): Promise<number> {
    return this.countScoped(institutionId, {
      recipientUserId: requireObjectId(recipientUserId),
      readAt: null,
    });
  }

  /**
   * Mark one notification read. Ownership is part of the filter, so another user's id simply
   * matches nothing rather than being checked afterwards.
   */
  async markRead(
    institutionId: IdLike,
    recipientUserId: IdLike,
    notificationId: IdLike,
  ): Promise<boolean> {
    const id = toObjectId(notificationId);
    if (!id) return false;

    const now = new Date();
    const modified = await this.updateOneScoped(
      institutionId,
      { _id: id, recipientUserId: requireObjectId(recipientUserId), readAt: null },
      // Setting autoDeleteAt starts the TTL clock; unread rows never get one.
      { $set: { readAt: now, autoDeleteAt: new Date(now.getTime() + READ_NOTIFICATION_RETENTION_MS) } },
    );
    return modified > 0;
  }

  async markAllRead(institutionId: IdLike, recipientUserId: IdLike): Promise<number> {
    const now = new Date();
    return this.updateManyScoped(
      institutionId,
      { recipientUserId: requireObjectId(recipientUserId), readAt: null },
      { $set: { readAt: now, autoDeleteAt: new Date(now.getTime() + READ_NOTIFICATION_RETENTION_MS) } },
    );
  }
}

export const notificationRepository = new NotificationRepository();
