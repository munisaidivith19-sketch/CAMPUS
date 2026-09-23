/**
 * In-app notifications (Phase 3 Part A).
 *
 * Only the IN_APP channel is delivered here. **Push and email delivery are NOT CONFIGURED** —
 * they are Part B. Nothing in this file pretends otherwise: a notification is a row other
 * features create, and the client reads it.
 *
 * Emitting is deliberately best-effort. A notification is a side effect of an action, never the
 * action itself, so a failure to notify is logged and swallowed rather than rolling back an
 * attendance mark or a membership approval that already succeeded.
 */
import type { NotificationDTO, NotificationType } from '@campusconnect/types';
import type { NotificationDocument } from '../models/Notification.model.js';
import {
  notificationRepository,
  type NotificationDraft,
} from '../repositories/notification.repository.js';
import type { IdLike, PageRequest } from '../repositories/base.repository.js';
import { logger } from '../utils/logger.js';

function toNotificationDTO(notification: NotificationDocument): NotificationDTO {
  return {
    id: String(notification._id),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    link: notification.link ?? null,
    read: notification.readAt !== null && notification.readAt !== undefined,
    createdAt: notification.createdAt.toISOString(),
  };
}

/** Fan a notification out to a set of recipients. Duplicated recipients are collapsed. */
export async function notifyUsers(
  institutionId: IdLike,
  recipientUserIds: readonly string[],
  payload: { type: NotificationType; title: string; body: string; link?: string | null },
): Promise<number> {
  const unique = [...new Set(recipientUserIds)];
  if (unique.length === 0) return 0;

  const drafts: NotificationDraft[] = unique.map((recipientUserId) => ({
    recipientUserId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    link: payload.link ?? null,
  }));

  try {
    return await notificationRepository.createMany(institutionId, drafts);
  } catch (err) {
    logger.error({ err, type: payload.type }, 'Failed to emit notifications');
    return 0;
  }
}

export async function listNotifications(
  institutionId: IdLike,
  recipientUserId: IdLike,
  page: PageRequest,
  unreadOnly = false,
): Promise<{ items: NotificationDTO[]; total: number; unread: number }> {
  const [result, unread] = await Promise.all([
    notificationRepository.listForRecipient(institutionId, recipientUserId, page, unreadOnly),
    notificationRepository.countUnread(institutionId, recipientUserId),
  ]);

  return { items: result.items.map(toNotificationDTO), total: result.total, unread };
}

export async function markNotificationRead(
  institutionId: IdLike,
  recipientUserId: IdLike,
  notificationId: IdLike,
): Promise<boolean> {
  return notificationRepository.markRead(institutionId, recipientUserId, notificationId);
}

export async function markAllNotificationsRead(
  institutionId: IdLike,
  recipientUserId: IdLike,
): Promise<number> {
  return notificationRepository.markAllRead(institutionId, recipientUserId);
}

export async function unreadNotificationCount(
  institutionId: IdLike,
  recipientUserId: IdLike,
): Promise<number> {
  return notificationRepository.countUnread(institutionId, recipientUserId);
}
