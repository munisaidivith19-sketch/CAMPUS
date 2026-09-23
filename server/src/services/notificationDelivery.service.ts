/**
 * Out-of-band delivery (email + push) for notifications that have already been written.
 *
 * The contract, in order of importance:
 *
 *  1. **The in-app row is the source of truth.** Delivery is an additional channel. Nothing in
 *     this file can delete, alter or suppress a notification; a total provider outage leaves
 *     every notification intact and visible in the app.
 *  2. **Never block the request path.** `enqueueDelivery` returns synchronously; the work is
 *     queued and happens on a later tick. A provider that takes ten seconds delays nothing the
 *     user is waiting on, and a queue that is unreachable degrades (deliveryQueue.ts) rather
 *     than propagating back into the write.
 *  3. **Never lose a failure.** Attempts are retried with exponential backoff and the outcome —
 *     including exhaustion — is written onto the notification's `deliveries` array. A failed
 *     delivery is queryable afterwards rather than existing only in a log line.
 *  4. **One targeting path.** Delivery consumes the notification ROWS the in-app path already
 *     produced, so recipients were resolved by the audience filter in announcement.service.
 *     There is deliberately no second audience computation here that could drift from it.
 *  5. **Tenant isolation.** Every read is tenant-scoped by the notification's own
 *     `institutionId`, and the recipient is resolved through the tenant-scoped user repository.
 *     A recipient who is not in that institution resolves to nothing and is skipped.
 *  6. **At most one send per channel.** The queue guarantees a task is claimed by one worker at
 *     a time, but a worker that dies mid-drain releases its task for someone else. The claim
 *     below makes that safe: a channel is claimed in the database before the first attempt, so a
 *     reclaimed task can tell "nobody has tried this" from "someone already did".
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
import {
  ackTask,
  claimTask,
  pushTask,
  queueBackendName,
  queueSize,
  resetDeliveryQueue,
} from './deliveryQueue.js';

/** Exponential backoff: base, base×2, base×4 … */
function backoffFor(attempt: number): number {
  return config.NOTIFICATION_DELIVERY_BACKOFF_MS * 2 ** (attempt - 1);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long a PENDING channel record may sit before a later worker calls it interrupted.
 *
 * Comfortably longer than a full retry cycle: the only way to still be PENDING after this is
 * that the worker holding it died.
 */
const INTERRUPTED_AFTER_MS = 5 * 60_000;

/**
 * Claim a channel for this worker by writing a PENDING record.
 *
 * The `$ne` filter is the whole guard: the update matches only when no record for that channel
 * exists, and MongoDB applies it atomically, so exactly one worker can claim a channel. Losing
 * the race means somebody already sent (or is sending) — the correct action is to do nothing.
 */
async function claimChannel(
  institutionId: string,
  notificationId: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const result = await NotificationModel.updateOne(
    {
      _id: requireObjectId(notificationId),
      institutionId: requireObjectId(institutionId),
      'deliveries.channel': { $ne: channel },
    },
    {
      $push: {
        deliveries: {
          channel,
          status: DeliveryStatus.PENDING,
          attempts: 0,
          lastAttemptAt: new Date(),
          failureReason: null,
        },
      },
    },
  ).exec();

  return result.modifiedCount === 1;
}

/** Write the final outcome onto the record claimed above. Never throws into the caller. */
async function finaliseChannel(
  institutionId: string,
  notificationId: string,
  channel: NotificationChannel,
  status: DeliveryStatus,
  attempts: number,
  failureReason: string | null,
): Promise<void> {
  try {
    await NotificationModel.updateOne(
      {
        _id: requireObjectId(notificationId),
        institutionId: requireObjectId(institutionId),
        'deliveries.channel': channel,
      },
      {
        $set: {
          'deliveries.$.status': status,
          'deliveries.$.attempts': attempts,
          'deliveries.$.lastAttemptAt': new Date(),
          'deliveries.$.failureReason': failureReason ? failureReason.slice(0, 300) : null,
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
      await finaliseChannel(
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
  await finaliseChannel(
    institutionId,
    notificationId,
    channel,
    DeliveryStatus.FAILED,
    maxAttempts,
    lastReason,
  );
}

/**
 * Run one channel end to end: claim it, or decide what a pre-existing record means.
 *
 * A record left PENDING by a worker that died is finalised as FAILED rather than retried. That
 * is the deliberate trade: we cannot know whether the provider had already accepted the message,
 * and for email a duplicate is worse than a miss. The failure is recorded and visible, never
 * silent, and the in-app notification is unaffected either way.
 */
async function runChannel(
  institutionId: string,
  notificationId: string,
  channel: NotificationChannel,
  attempt: () => Promise<{ status: DeliveryStatus; reason?: string }>,
): Promise<void> {
  if (await claimChannel(institutionId, notificationId, channel)) {
    await deliverWithRetry(institutionId, notificationId, channel, attempt);
    return;
  }

  const existing = await NotificationModel.findOne(
    { _id: requireObjectId(notificationId), institutionId: requireObjectId(institutionId) },
    { deliveries: 1 },
  )
    .lean()
    .exec();

  const record = existing?.deliveries.find((delivery) => delivery.channel === channel);
  if (!record || record.status !== DeliveryStatus.PENDING) return;

  const age = Date.now() - (record.lastAttemptAt?.getTime() ?? 0);
  if (age < INTERRUPTED_AFTER_MS) return; // Another worker is on it right now.

  logger.warn({ notificationId, channel }, 'Delivery was interrupted before its outcome was known');
  await finaliseChannel(
    institutionId,
    notificationId,
    channel,
    DeliveryStatus.FAILED,
    record.attempts,
    'interrupted before the outcome was known; not retried to avoid a duplicate send',
  );
}

async function processTask(task: { institutionId: string; notificationId: string }): Promise<void> {
  const { institutionId, notificationId } = task;

  // Tenant-scoped read: a notification from another institution is simply not found here.
  const notification = await notificationRepository.findByIdScoped(institutionId, notificationId);
  if (!notification) return;

  // The recipient is resolved through the tenant-scoped repository, so a user outside this
  // institution cannot be reached even if an id somehow pointed at one.
  const recipient = await userRepository.findById(institutionId, notification.recipientUserId);
  if (!recipient) {
    if (await claimChannel(institutionId, notificationId, NotificationChannel.EMAIL)) {
      await finaliseChannel(
        institutionId,
        notificationId,
        NotificationChannel.EMAIL,
        DeliveryStatus.SKIPPED,
        1,
        'recipient not found in this institution',
      );
    }
    return;
  }

  const payload = {
    title: notification.title,
    body: notification.body,
    link: notification.link ?? null,
  };

  await runChannel(institutionId, notificationId, NotificationChannel.EMAIL, async () => {
    await sendNotificationEmail(recipient.email, recipient.fullName, payload);
    return { status: DeliveryStatus.SENT };
  });

  await runChannel(institutionId, notificationId, NotificationChannel.PUSH, async () => {
    const result = await sendPush({
      tokens: [...recipient.pushTokens],
      title: payload.title,
      body: payload.body,
      link: payload.link,
    });
    return { status: result.status, reason: result.reason };
  });
}

let draining: Promise<void> | null = null;
let pollTimer: NodeJS.Timeout | null = null;
/**
 * Enqueues are serialised through one chain so `flushDeliveries` has something to await: the
 * request path does not wait for the queue write, but a test must not race ahead of it.
 */
let enqueueChain: Promise<void> = Promise.resolve();

/** Claim and process until the queue hands back nothing. */
async function drain(): Promise<void> {
  for (;;) {
    let claimed;
    try {
      claimed = await claimTask();
    } catch (err) {
      logger.error({ err }, 'Could not claim a delivery task');
      break;
    }
    if (!claimed) break;

    try {
      await processTask(claimed.task);
    } catch (err) {
      // A single bad task must not stall the queue behind it. It is acked below either way:
      // the outcome records on the notification are what carry the failure forward.
      logger.error({ err, notificationId: claimed.task.notificationId }, 'Delivery task threw');
    }
    await ackTask(claimed.receipt);
  }
  draining = null;
}

/** Start a drain on a later tick, so the caller's response is never held up by a provider. */
function scheduleDrain(): void {
  draining ??= new Promise<void>((resolve) => {
    setImmediate(() => {
      void drain().finally(resolve);
    });
  });
}

/**
 * Queue notifications for out-of-band delivery.
 *
 * Returns immediately — this is called from the request path and must never await a provider or
 * a queue round trip.
 */
export function enqueueDelivery(institutionId: IdLike, notificationIds: readonly string[]): void {
  if (!config.NOTIFICATION_DELIVERY_ENABLED || notificationIds.length === 0) return;

  const tasks = notificationIds.map((notificationId) => ({
    institutionId: String(institutionId),
    notificationId,
  }));

  enqueueChain = enqueueChain
    .then(async () => {
      for (const task of tasks) {
        await pushTask(task);
      }
      scheduleDrain();
    })
    .catch((err: unknown) => {
      // pushTask already degrades rather than throwing; this is the last line of defence.
      logger.error({ err }, 'Could not queue notification delivery');
    });
}

/**
 * Begin draining the queue: once now (picking up whatever a previous process left behind) and
 * then on a timer, which is what lets one instance finish another's interrupted work.
 */
export function startDeliveryWorker(): void {
  if (pollTimer) return;
  logger.info({ backend: queueBackendName() }, 'Notification delivery worker started');
  scheduleDrain();
  pollTimer = setInterval(() => {
    scheduleDrain();
  }, config.NOTIFICATION_DELIVERY_POLL_MS);
  // Never hold the process open just to poll an empty queue.
  pollTimer.unref();
}

export function stopDeliveryWorker(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Wait for the queue to empty. Tests use this to assert on delivery deterministically instead
 * of sleeping; production code has no reason to call it.
 */
export async function flushDeliveries(): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await enqueueChain;
    while (draining) await draining;
    if ((await queueSize()) === 0) return;
    if (Date.now() > deadline) {
      // Something is stuck — say so rather than spinning forever inside a test.
      throw new Error('flushDeliveries timed out with work still queued');
    }
    scheduleDrain();
  }
}

/** Drop anything queued. Test-only, so one suite's queue cannot leak into the next. */
export async function clearDeliveryQueue(): Promise<void> {
  await resetDeliveryQueue();
}
