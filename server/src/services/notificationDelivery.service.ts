/**
 * Out-of-band delivery (email + push) for notifications that have already been written.
 *
 * The contract, in order of importance:
 *
 *  1. **The in-app row is the source of truth.** Delivery is an additional channel. Nothing in
 *     this file can delete, alter or suppress a notification; a total provider outage leaves
 *     every notification intact and visible in the app.
 *  2. **Never block the request path.** `enqueueDelivery` returns synchronously after pushing
 *     ids onto an in-process queue; the work happens on a later tick. A provider that takes ten
 *     seconds delays nothing the user is waiting on.
 *  3. **Never lose a failure.** Attempts are retried with exponential backoff and the outcome —
 *     including exhaustion — is written onto the notification's `deliveries` array. A failed
 *     delivery is queryable afterwards rather than existing only in a log line.
 *  4. **One targeting path.** Delivery consumes the notification ROWS the in-app path already
 *     produced, so recipients were resolved by the audience filter in announcement.service.
 *     There is deliberately no second audience computation here that could drift from it.
 *  5. **Tenant isolation.** Every read is tenant-scoped by the notification's own
 *     `institutionId`, and the recipient is resolved through the tenant-scoped user repository.
 *     A recipient who is not in that institution resolves to nothing and is skipped.
 *
 * SCOPE NOTE: the queue is in-process. That is correct for a single API instance and matches
 * the documented dev degradation in docs/architecture/03-backend-architecture.md ("jobs fall
 * back to inline execution"). A multi-instance deployment needs the Redis-backed durable queue
 * described there; until then a process restart drops queued-but-unsent work, while the in-app
 * notifications it would have delivered remain intact.
 */
import { DeliveryStatus, NotificationChannel } from '@campusconnect/types';
import { config } from '../config/env.js';
import { NotificationModel } from '../models/Notification.model.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { requireObjectId, type IdLike } from '../repositories/base.repository.js';
import { logger } from '../utils/logger.js';
import { sendNotificationEmail } from './email.service.js';
import { sendPush } from './push.service.js';

interface DeliveryTask {
  institutionId: string;
  notificationId: string;
}

const queue: DeliveryTask[] = [];
let draining: Promise<void> | null = null;

/** Exponential backoff: base, base×2, base×4 … */
function backoffFor(attempt: number): number {
  return config.NOTIFICATION_DELIVERY_BACKOFF_MS * 2 ** (attempt - 1);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Record an attempt outcome on the notification. Never throws into the caller. */
async function recordOutcome(
  institutionId: string,
  notificationId: string,
  channel: NotificationChannel,
  status: DeliveryStatus,
  attempts: number,
  failureReason: string | null,
): Promise<void> {
  try {
    await NotificationModel.updateOne(
      { _id: requireObjectId(notificationId), institutionId: requireObjectId(institutionId) },
      {
        $push: {
          deliveries: {
            channel,
            status,
            attempts,
            lastAttemptAt: new Date(),
            failureReason: failureReason ? failureReason.slice(0, 300) : null,
          },
        },
      },
    ).exec();
  } catch (err) {
    // Even the bookkeeping failing must not take down delivery of the next notification.
    logger.error({ err, notificationId, channel }, 'Could not record delivery outcome');
  }
}

/**
 * Try one channel, retrying with backoff, and record the final outcome.
 *
 * `attempt` returns SKIPPED for "nothing to do here" (no address, provider not configured),
 * which is not retried — retrying a missing configuration just wastes time and fills the log.
 */
async function deliverWithRetry(
  institutionId: string,
  notificationId: string,
  channel: NotificationChannel,
  attempt: () => Promise<{ status: DeliveryStatus; reason?: string }>,
): Promise<void> {
  const maxAttempts = config.NOTIFICATION_DELIVERY_MAX_ATTEMPTS;
  let lastReason = 'unknown';

  for (let tries = 1; tries <= maxAttempts; tries += 1) {
    let outcome: { status: DeliveryStatus; reason?: string };
    try {
      outcome = await attempt();
    } catch (err) {
      outcome = {
        status: DeliveryStatus.FAILED,
        reason: err instanceof Error ? err.message : 'unknown error',
      };
    }

    if (outcome.status === DeliveryStatus.SENT || outcome.status === DeliveryStatus.SKIPPED) {
      await recordOutcome(
        institutionId,
        notificationId,
        channel,
        outcome.status,
        tries,
        outcome.reason ?? null,
      );
      return;
    }

    lastReason = outcome.reason ?? 'unknown';
    if (tries < maxAttempts) await wait(backoffFor(tries));
  }

  // Retries exhausted. Recorded, not dropped — and the in-app notification still stands.
  logger.warn({ notificationId, channel, reason: lastReason }, 'Notification delivery failed');
  await recordOutcome(
    institutionId,
    notificationId,
    channel,
    DeliveryStatus.FAILED,
    maxAttempts,
    lastReason,
  );
}

async function processTask(task: DeliveryTask): Promise<void> {
  const { institutionId, notificationId } = task;

  // Tenant-scoped read: a notification from another institution is simply not found here.
  const notification = await notificationRepository.findByIdScoped(institutionId, notificationId);
  if (!notification) return;

  // The recipient is resolved through the tenant-scoped repository, so a user outside this
  // institution cannot be reached even if an id somehow pointed at one.
  const recipient = await userRepository.findById(institutionId, notification.recipientUserId);
  if (!recipient) {
    await recordOutcome(
      institutionId,
      notificationId,
      NotificationChannel.EMAIL,
      DeliveryStatus.SKIPPED,
      1,
      'recipient not found in this institution',
    );
    return;
  }

  const payload = {
    title: notification.title,
    body: notification.body,
    link: notification.link ?? null,
  };

  await deliverWithRetry(institutionId, notificationId, NotificationChannel.EMAIL, async () => {
    await sendNotificationEmail(recipient.email, recipient.fullName, payload);
    return { status: DeliveryStatus.SENT };
  });

  await deliverWithRetry(institutionId, notificationId, NotificationChannel.PUSH, async () => {
    const result = await sendPush({
      tokens: [...recipient.pushTokens],
      title: payload.title,
      body: payload.body,
      link: payload.link,
    });
    return { status: result.status, reason: result.reason };
  });
}

async function drain(): Promise<void> {
  while (queue.length > 0) {
    const task = queue.shift();
    if (!task) break;
    try {
      await processTask(task);
    } catch (err) {
      // A single bad task must not stall the queue behind it.
      logger.error({ err, notificationId: task.notificationId }, 'Delivery task threw');
    }
  }
  draining = null;
}

/**
 * Queue notifications for out-of-band delivery.
 *
 * Returns immediately — this is called from the request path and must never await a provider.
 */
export function enqueueDelivery(institutionId: IdLike, notificationIds: readonly string[]): void {
  if (!config.NOTIFICATION_DELIVERY_ENABLED || notificationIds.length === 0) return;

  for (const notificationId of notificationIds) {
    queue.push({ institutionId: String(institutionId), notificationId });
  }

  // Start draining on a later tick so the caller's response is not held up by the first attempt.
  draining ??= new Promise<void>((resolve) => {
    setImmediate(() => {
      void drain().finally(resolve);
    });
  });
}

/**
 * Wait for the queue to empty. Tests use this to assert on delivery deterministically instead
 * of sleeping; production code has no reason to call it.
 */
export async function flushDeliveries(): Promise<void> {
  while (draining) {
    await draining;
  }
}

/** Drop anything queued. Test-only, so one suite's queue cannot leak into the next. */
export function clearDeliveryQueue(): void {
  queue.length = 0;
}
