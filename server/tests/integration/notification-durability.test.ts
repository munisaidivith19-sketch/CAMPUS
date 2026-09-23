/**
 * Durability properties of the delivery queue, and who may see delivery detail.
 *
 * These are the Part C-1 guarantees: work is not lost, work is not done twice, and a queue
 * outage never reaches the in-app notification.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementScope, DeliveryStatus, NotificationChannel, Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createTenant,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
  type TestUser,
} from '../helpers/testHarness.js';
import { createDepartment, createFaculty, createStudentInSection } from '../helpers/academicFixtures.js';
import {
  enqueueDelivery,
  flushDeliveries,
} from '../../src/services/notificationDelivery.service.js';
import {
  __setPrimaryQueueForTests,
  isDeliveryQueueDegraded,
  type QueueBackend,
} from '../../src/services/deliveryQueue.js';
import { setPushSender } from '../../src/services/push.service.js';
import { NotificationModel } from '../../src/models/Notification.model.js';
import { sentMailbox } from '../../src/services/email.service.js';

let tenant: TestTenant;
let departmentId: string;
let student: TestUser;
let studentSession: LoggedIn;
let principalSession: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  student = await createStudentInSection(tenant, {
    localPart: 'durable',
    rollNo: 'D001',
    departmentId,
  });
  studentSession = await login(student);

  const principal = await createFaculty(tenant, {
    localPart: 'principal',
    roles: [Role.PRINCIPAL],
    departmentId,
  });
  principalSession = await login(principal);
});

async function publish(title = 'Durability notice'): Promise<void> {
  const response = await api()
    .post('/api/v1/announcements')
    .set('authorization', `Bearer ${principalSession.accessToken}`)
    .send({ title, body: 'Body.', target: { scope: AnnouncementScope.COLLEGE } });
  expect(response.status).toBe(201);
}

async function notificationFor(user: TestUser): Promise<{
  id: string;
  deliveries: Array<{ channel: string; status: string; attempts: number; failureReason?: string | null }>;
}> {
  const row = await NotificationModel.findOne({ recipientUserId: user.id }).lean().exec();
  if (!row) throw new Error(`no notification for ${user.email}`);
  return { id: String(row._id), deliveries: row.deliveries ?? [] };
}

const mailsTo = (email: string): number => sentMailbox.filter((mail) => mail.to === email).length;

describe('delivery detail is private to its recipient', () => {
  it('shows a recipient their own delivery record and nobody else’s', async () => {
    const other = await createStudentInSection(tenant, {
      localPart: 'peer',
      rollNo: 'D002',
      departmentId,
    });
    const otherSession = await login(other);

    // Give one of them a device so their delivery outcomes differ visibly.
    setPushSender(vi.fn().mockRejectedValue(new Error('provider down')));
    await api()
      .post('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${otherSession.accessToken}`)
      .send({ token: 'ExponentPushToken[peer-device]' });

    await publish('Everyone gets this');
    await flushDeliveries();

    const mine = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(mine.body.data).toHaveLength(1);
    const deliveries = mine.body.data[0].deliveries as Array<{ channel: string; status: string }>;

    // Exactly two records — mine, one per out-of-band channel. A per-recipient breakdown would
    // leak who has a device registered and whose provider is failing.
    expect(deliveries).toHaveLength(2);
    const push = deliveries.find((d) => d.channel === NotificationChannel.PUSH);
    expect(push?.status).toBe(DeliveryStatus.SKIPPED); // no device of MY own
    expect(JSON.stringify(mine.body)).not.toContain(other.email);

    // The peer's own view shows the peer's own failure, and only that.
    const theirs = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${otherSession.accessToken}`);
    const theirPush = (theirs.body.data[0].deliveries as Array<{ channel: string; status: string }>).find(
      (d) => d.channel === NotificationChannel.PUSH,
    );
    expect(theirPush?.status).toBe(DeliveryStatus.FAILED);
  });

  it('does not expose delivery state through the announcement itself', async () => {
    await publish('Announcement view');
    await flushDeliveries();

    const feed = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const body = JSON.stringify(feed.body);
    expect(body).not.toContain('deliveries');
    expect(body).not.toContain(DeliveryStatus.SKIPPED);
  });
});

describe('a task that is processed twice', () => {
  it('does not send the same notification again', async () => {
    await publish('Only once');
    await flushDeliveries();

    expect(mailsTo(student.email)).toBe(1);
    const before = await notificationFor(student);

    // Exactly what a reclaimed in-flight item looks like: the same task, queued again.
    enqueueDelivery(tenant.institutionId, [before.id]);
    await flushDeliveries();

    expect(mailsTo(student.email)).toBe(1);
    const after = await notificationFor(student);
    expect(after.deliveries).toHaveLength(before.deliveries.length);
  });

  it('gives up on a channel left half-done by a dead worker instead of resending', async () => {
    await publish('Interrupted');
    await flushDeliveries();
    sentMailbox.length = 0;

    const row = await notificationFor(student);
    // Rewind the EMAIL record to what a worker that died mid-attempt leaves behind: claimed,
    // never finalised, and old enough that nobody is still working on it.
    await NotificationModel.updateOne(
      { _id: row.id, 'deliveries.channel': NotificationChannel.EMAIL },
      {
        $set: {
          'deliveries.$.status': DeliveryStatus.PENDING,
          'deliveries.$.attempts': 1,
          'deliveries.$.lastAttemptAt': new Date(Date.now() - 10 * 60_000),
        },
      },
    ).exec();

    enqueueDelivery(tenant.institutionId, [row.id]);
    await flushDeliveries();

    const after = await notificationFor(student);
    const email = after.deliveries.find((d) => d.channel === NotificationChannel.EMAIL);
    // We cannot know whether the provider accepted it, so it is recorded as failed, not retried.
    expect(email?.status).toBe(DeliveryStatus.FAILED);
    expect(email?.failureReason).toContain('interrupted');
    expect(mailsTo(student.email)).toBe(0);
  });

  it('leaves a channel another worker is actively attempting alone', async () => {
    await publish('In progress elsewhere');
    await flushDeliveries();
    sentMailbox.length = 0;

    const row = await notificationFor(student);
    await NotificationModel.updateOne(
      { _id: row.id, 'deliveries.channel': NotificationChannel.EMAIL },
      { $set: { 'deliveries.$.status': DeliveryStatus.PENDING, 'deliveries.$.lastAttemptAt': new Date() } },
    ).exec();

    enqueueDelivery(tenant.institutionId, [row.id]);
    await flushDeliveries();

    const after = await notificationFor(student);
    const email = after.deliveries.find((d) => d.channel === NotificationChannel.EMAIL);
    // Still PENDING: a fresh claim belongs to whoever made it.
    expect(email?.status).toBe(DeliveryStatus.PENDING);
    expect(mailsTo(student.email)).toBe(0);
  });
});

describe('when the durable queue is unreachable', () => {
  /** A backend that is up but broken — the interesting failure, not a missing config. */
  function brokenBackend(): QueueBackend {
    const fail = async (): Promise<never> => {
      throw new Error('ECONNREFUSED 127.0.0.1:6379');
    };
    return {
      name: 'redis',
      enqueue: fail,
      claim: fail,
      ack: fail,
      size: fail,
      clear: fail,
    };
  }

  it('still writes the in-app notification and still delivers it', async () => {
    __setPrimaryQueueForTests(brokenBackend());

    await publish('Queue is down');
    await flushDeliveries();

    // The in-app row — the source of truth — is untouched by the queue's problems.
    const inApp = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(inApp.body.data).toHaveLength(1);
    expect(inApp.body.data[0].title).toBe('Queue is down');

    // And delivery still happened, on the degraded in-process path.
    expect(mailsTo(student.email)).toBe(1);
    expect(isDeliveryQueueDegraded()).toBe(true);
  });

  it('reports the degradation rather than hiding it', async () => {
    __setPrimaryQueueForTests(brokenBackend());
    expect(isDeliveryQueueDegraded()).toBe(false);

    await publish('Degraded flag');
    await flushDeliveries();

    // Nothing was dropped, and the loss of durability is observable.
    expect(isDeliveryQueueDegraded()).toBe(true);
  });
});
