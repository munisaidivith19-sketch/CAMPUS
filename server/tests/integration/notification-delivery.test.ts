/**
 * Out-of-band notification delivery (email + push).
 *
 * The property these tests exist to protect: the in-app row is the source of truth and delivery
 * is an extra channel. Every failure case below asserts that the notification SURVIVES — a dead
 * provider must cost you a push, never a notification.
 *
 * No test contacts a real provider: email uses the JSON transport the test env already installs,
 * and push uses an injected fake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementScope, DeliveryStatus, NotificationChannel, Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
  type TestUser,
} from '../helpers/testHarness.js';
import { createDepartment, createFaculty, createStudentInSection } from '../helpers/academicFixtures.js';
import { flushDeliveries } from '../../src/services/notificationDelivery.service.js';
import { setPushSender } from '../../src/services/push.service.js';
import { notifyUsers } from '../../src/services/notification.service.js';
import { NotificationModel } from '../../src/models/Notification.model.js';
import { sentMailbox } from '../../src/services/email.service.js';
import { NotificationType } from '@campusconnect/types';

/**
 * A switch for making the mailer fail on demand.
 *
 * The real mailer is kept — only `sendNotificationEmail` is wrapped — so `sentMailbox` and every
 * other email in the suite still behave exactly as they do in the rest of the tests. A spy is not
 * an option here: the delivery service imports the function by name, and ES module namespaces
 * are not writable.
 */
const mailer = vi.hoisted(() => ({ failWith: null as string | null }));

vi.mock('../../src/services/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/email.service.js')>();
  return {
    ...actual,
    sendNotificationEmail: async (
      ...args: Parameters<typeof actual.sendNotificationEmail>
    ): Promise<void> => {
      if (mailer.failWith) throw new Error(mailer.failWith);
      await actual.sendNotificationEmail(...args);
    },
  };
});

let tenant: TestTenant;
let departmentId: string;
let student: TestUser;
let studentSession: LoggedIn;
let principalSession: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  mailer.failWith = null;
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  student = await createStudentInSection(tenant, {
    localPart: 'receiver',
    rollNo: 'N001',
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

/** Read the delivery records the service wrote onto a notification. */
async function deliveriesFor(userId: string): Promise<
  Array<{ channel: string; status: string; attempts: number; failureReason: string | null }>
> {
  const rows = await NotificationModel.find({ recipientUserId: userId }).lean().exec();
  return rows.flatMap((row) =>
    (row.deliveries ?? []).map((d) => ({
      channel: d.channel,
      status: d.status,
      attempts: d.attempts,
      failureReason: d.failureReason ?? null,
    })),
  );
}

async function publishAnnouncement(title = 'Delivery test notice'): Promise<void> {
  const response = await api()
    .post('/api/v1/announcements')
    .set('authorization', `Bearer ${principalSession.accessToken}`)
    .send({ title, body: 'Body of the notice.', target: { scope: AnnouncementScope.COLLEGE } });

  expect(response.status).toBe(201);
}

describe('the happy path', () => {
  it('writes the in-app row and emails it out of band', async () => {
    await publishAnnouncement('Exam timetable published');
    await flushDeliveries();

    const inApp = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(inApp.body.data).toHaveLength(1);
    expect(inApp.body.data[0].title).toBe('Exam timetable published');

    const mail = sentMailbox.find((m) => m.to === student.email);
    expect(mail?.subject).toBe('Exam timetable published');

    const records = await deliveriesFor(student.id);
    const email = records.find((r) => r.channel === NotificationChannel.EMAIL);
    expect(email?.status).toBe(DeliveryStatus.SENT);
  });

  it('exposes delivery state on the notification', async () => {
    await publishAnnouncement();
    await flushDeliveries();

    const response = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const channels = (response.body.data[0].deliveries as Array<{ channel: string }>).map((d) => d.channel);
    expect(channels).toContain(NotificationChannel.EMAIL);
    expect(channels).toContain(NotificationChannel.PUSH);
  });
});

describe('degrading without a provider', () => {
  it('skips push when no provider is configured, and does not call it a failure', async () => {
    await publishAnnouncement();
    await flushDeliveries();

    const push = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.PUSH);
    // NOT CONFIGURED is an expected state, not an error to investigate.
    expect(push?.status).toBe(DeliveryStatus.SKIPPED);
    expect(push?.failureReason).toMatch(/NOT CONFIGURED|no registered devices/);
  });

  it('skips push for a user with no registered device even when a provider exists', async () => {
    const sender = vi.fn().mockResolvedValue({ status: DeliveryStatus.SENT });
    setPushSender(sender);

    await publishAnnouncement();
    await flushDeliveries();

    const push = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.PUSH);
    expect(push?.status).toBe(DeliveryStatus.SKIPPED);
    // The provider is never contacted for a user with nothing to send to.
    expect(sender).not.toHaveBeenCalled();
  });

  it('delivers push once a device is registered', async () => {
    const sender = vi.fn().mockResolvedValue({ status: DeliveryStatus.SENT });
    setPushSender(sender);

    const registered = await api()
      .post('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token: 'ExponentPushToken[test-device-0001]' });
    expect(registered.status).toBe(201);

    await publishAnnouncement();
    await flushDeliveries();

    const push = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.PUSH);
    expect(push?.status).toBe(DeliveryStatus.SENT);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0]?.[0].tokens).toEqual(['ExponentPushToken[test-device-0001]']);
  });

  it('does not register the same device twice', async () => {
    for (let i = 0; i < 3; i += 1) {
      await api()
        .post('/api/v1/me/push-tokens')
        .set('authorization', `Bearer ${studentSession.accessToken}`)
        .send({ token: 'ExponentPushToken[same-device]' });
    }

    const sender = vi.fn().mockResolvedValue({ status: DeliveryStatus.SENT });
    setPushSender(sender);
    await publishAnnouncement();
    await flushDeliveries();

    expect(sender.mock.calls[0]?.[0].tokens).toEqual(['ExponentPushToken[same-device]']);
  });

  it('stops delivering to a device that unregisters', async () => {
    const token = 'ExponentPushToken[leaving]';
    await api()
      .post('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token });
    await api()
      .delete('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token });

    const sender = vi.fn().mockResolvedValue({ status: DeliveryStatus.SENT });
    setPushSender(sender);
    await publishAnnouncement();
    await flushDeliveries();

    expect(sender).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('retries, records the failure, and leaves the in-app notification intact', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('provider unreachable'));
    setPushSender(sender);

    await api()
      .post('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token: 'ExponentPushToken[doomed]' });

    await publishAnnouncement('Survives a failed push');
    await flushDeliveries();

    const push = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.PUSH);
    expect(push?.status).toBe(DeliveryStatus.FAILED);
    // Retried up to the configured maximum rather than giving up on the first error.
    expect(push?.attempts).toBe(3);
    expect(push?.failureReason).toContain('provider unreachable');

    // The whole point: the notification is still there.
    const inApp = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(inApp.body.data).toHaveLength(1);
    expect(inApp.body.data[0].title).toBe('Survives a failed push');
  });

  it('keeps the notification when EMAIL delivery throws', async () => {
    mailer.failWith = 'smtp is down';

    await publishAnnouncement('Survives a failed email');
    await flushDeliveries();

    const email = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.EMAIL);
    expect(email?.status).toBe(DeliveryStatus.FAILED);
    expect(email?.failureReason).toContain('smtp is down');

    const inApp = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(inApp.body.data).toHaveLength(1);
  });

  it('succeeds on a later attempt when the provider recovers', async () => {
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary blip'))
      .mockResolvedValue({ status: DeliveryStatus.SENT });
    setPushSender(sender);

    await api()
      .post('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token: 'ExponentPushToken[flaky]' });

    await publishAnnouncement();
    await flushDeliveries();

    const push = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.PUSH);
    expect(push?.status).toBe(DeliveryStatus.SENT);
    expect(push?.attempts).toBe(2);
  });
});

describe('the request path is not blocked', () => {
  it('returns before delivery runs', async () => {
    // A provider that takes longer than the request would, if delivery were awaited.
    const PROVIDER_DELAY_MS = 1_000;
    setPushSender(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: DeliveryStatus.SENT }), PROVIDER_DELAY_MS),
        ),
    );
    await api()
      .post('/api/v1/me/push-tokens')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token: 'ExponentPushToken[slow]' });

    const startedAt = Date.now();
    await publishAnnouncement();
    const elapsed = Date.now() - startedAt;

    // Generous margin: the point is that the request did not wait a full provider round trip,
    // not that it was fast.
    expect(elapsed).toBeLessThan(PROVIDER_DELAY_MS);

    await flushDeliveries();
    const push = (await deliveriesFor(student.id)).find((r) => r.channel === NotificationChannel.PUSH);
    expect(push?.status).toBe(DeliveryStatus.SENT);
  });
});

describe('tenant and scope isolation on the delivery path', () => {
  it('never delivers to a user in another institution', async () => {
    const other = await createTenant('delivery-other.test');
    const outsider = await createUser(other, { roles: [Role.STUDENT], localPart: 'outsider' });

    await publishAnnouncement('Only for this college');
    await flushDeliveries();

    // The outsider is neither emailed nor given a notification row.
    expect(sentMailbox.some((m) => m.to === outsider.email)).toBe(false);
    expect(await deliveriesFor(outsider.id)).toHaveLength(0);
  });

  it('delivers only to the targeted scope, reusing the in-app audience', async () => {
    const otherSection = await createStudentInSection(tenant, {
      localPart: 'sectionb',
      rollNo: 'N099',
      departmentId,
      section: 'B',
    });
    sentMailbox.length = 0;

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Section A only',
        body: 'Targeted.',
        target: { scope: AnnouncementScope.SECTION, batch: '2024-2028', section: 'A' },
      });
    await flushDeliveries();

    // Delivery follows the rows the audience filter produced — no second targeting path.
    expect(sentMailbox.some((m) => m.to === student.email)).toBe(true);
    expect(sentMailbox.some((m) => m.to === otherSection.email)).toBe(false);
    expect(await deliveriesFor(otherSection.id)).toHaveLength(0);
  });

  it('skips a recipient who is not resolvable inside the notification’s institution', async () => {
    // A row whose recipient does not exist in that tenant must not be delivered anywhere.
    await notifyUsers(tenant.institutionId, ['507f1f77bcf86cd799439011'], {
      type: NotificationType.ANNOUNCEMENT,
      title: 'Orphan',
      body: 'Recipient does not exist here.',
    });
    await flushDeliveries();

    const records = await deliveriesFor('507f1f77bcf86cd799439011');
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe(DeliveryStatus.SKIPPED);
    expect(records[0]?.failureReason).toContain('not found in this institution');
  });
});
