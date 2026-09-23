/**
 * In-app notifications.
 *
 * This file only ever writes the in-app row, which is the source of truth. Out-of-band delivery
 * (email, push) is queued from here and carried out by notificationDelivery.service — never
 * awaited, so a provider can be slow, failing or NOT CONFIGURED without affecting the row or the
 * request that created it.
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
import { enqueueDelivery } from './notificationDelivery.service.js';

function toNotificationDTO(notification: NotificationDocument): NotificationDTO {
  return {
    id: String(notification._id),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    link: notification.link ?? null,
    read: notification.readAt !== null && notification.readAt !== undefined,
    createdAt: notification.createdAt.toISOString(),
    deliveries: notification.deliveries.map((delivery) => ({
      channel: delivery.channel,
      status: delivery.status,
      attempts: delivery.attempts,
      lastAttemptAt: delivery.lastAttemptAt ? delivery.lastAttemptAt.toISOString() : null,
      failureReason: delivery.failureReason ?? null,
    })),
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
    const created = await notificationRepository.createMany(institutionId, drafts);

    // Out-of-band delivery is queued, never awaited: the in-app rows above are already written
    // and are the source of truth, so a slow or failing provider cannot delay this call or
    // undo them. Recipients come from the rows we just wrote, so delivery inherits the same
    // audience the in-app path resolved — there is no second targeting path to drift.
    enqueueDelivery(institutionId, created);

    return created.length;
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
