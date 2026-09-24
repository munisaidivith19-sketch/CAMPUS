/**
 * The moderation queue end to end: reports are grouped and scope-narrowed, decisions reuse each
 * module's own removal, dismissed reports stay dismissed, private chats are recorded but not
 * actionable, and leaving a club takes its chat with it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatType, ClubMembershipStatus, Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
} from '../helpers/testHarness.js';
import {
  BATCH,
  createClub,
  createDepartment,
  createFaculty,
  createStudentInSection,
  createSubjectAndClass,
  setDepartmentHod,
} from '../helpers/academicFixtures.js';
import { AuditLogModel } from '../../src/models/AuditLog.model.js';
import { ChatMessageModel } from '../../src/models/ChatMessage.model.js';
import { ContentReportModel } from '../../src/models/ContentReport.model.js';
import { resetChatNotificationDebounce } from '../../src/services/chat.service.js';

let tenant: TestTenant;
let departmentId: string;
let alice: LoggedIn;
let bob: LoggedIn;
let carol: LoggedIn; // section B
let mentorA: LoggedIn;
let mentorB: LoggedIn;
let hod: LoggedIn;
let principal: LoggedIn;
let clubAdmin: LoggedIn;
let clubId: string;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  resetChatNotificationDebounce();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  alice = await login(
    await createStudentInSection(tenant, { localPart: 'alice', rollNo: 'M001', departmentId }),
  );
  bob = await login(
    await createStudentInSection(tenant, { localPart: 'bob', rollNo: 'M002', departmentId }),
  );
  carol = await login(
    await createStudentInSection(tenant, {
      localPart: 'carol',
      rollNo: 'M003',
      departmentId,
      section: 'B',
    }),
  );

  mentorA = await login(
    await createFaculty(tenant, {
      localPart: 'mentora',
      roles: [Role.CLASS_MENTOR],
      departmentId,
      mentorOf: { batch: BATCH, section: 'A' },
    }),
  );
  mentorB = await login(
    await createFaculty(tenant, {
      localPart: 'mentorb',
      roles: [Role.CLASS_MENTOR],
      departmentId,
      mentorOf: { batch: BATCH, section: 'B' },
    }),
  );
  const hodUser = await createFaculty(tenant, {
    localPart: 'hod',
    roles: [Role.HOD],
    departmentId,
  });
  await setDepartmentHod(tenant, departmentId, hodUser.id);
  hod = await login(hodUser);
  principal = await createAndLogin(tenant, { roles: [Role.PRINCIPAL], localPart: 'principal' });

  await createSubjectAndClass(tenant, { code: 'CS101', departmentId, section: 'A' });
  await createSubjectAndClass(tenant, { code: 'CS102', departmentId, section: 'B' });

  const adminUser = await createUser(tenant, { roles: [Role.CLUB_ADMIN], localPart: 'clubadmin' });
  clubAdmin = await login(adminUser);
  clubId = await createClub(tenant, { name: 'Robotics', adminUserIds: [adminUser.id] });
});

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];
let counter = 0;
const clientId = (): string => `mod-msg-${(counter += 1)}-${Date.now()}`;

async function classChatId(session: LoggedIn): Promise<string> {
  const chats = await api()
    .get('/api/v1/chats')
    .set(...auth(session));
  const chat = (chats.body.data as Array<{ id: string; type: string }>).find(
    (c) => c.type === ChatType.CLASS,
  );
  if (!chat) throw new Error('no class chat');
  return chat.id;
}

async function send(session: LoggedIn, chatId: string, body: string): Promise<string> {
  const response = await api()
    .post(`/api/v1/chats/${chatId}/messages`)
    .set(...auth(session))
    .send({ body, clientMessageId: clientId() });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function report(
  session: LoggedIn,
  targetType: string,
  targetId: string,
  reason = 'This is abusive content.',
): Promise<number> {
  const response = await api()
    .post('/api/v1/reports')
    .set(...auth(session))
    .send({ targetType, targetId, reason });
  return response.status;
}

async function queue(session: LoggedIn): Promise<Array<Record<string, unknown>>> {
  const response = await api()
    .get('/api/v1/moderation/reports')
    .set(...auth(session));
  expect(response.status).toBe(200);
  return response.body.data as Array<Record<string, unknown>>;
}

async function joinClub(student: LoggedIn): Promise<void> {
  const joined = await api()
    .post(`/api/v1/clubs/${clubId}/join`)
    .set(...auth(student));
  expect(joined.status).toBe(201);
  const decided = await api()
    .patch(`/api/v1/clubs/memberships/${joined.body.data.id}`)
    .set(...auth(clubAdmin))
    .send({ decision: ClubMembershipStatus.APPROVED });
  expect(decided.status).toBe(200);
}

async function clubChatId(session: LoggedIn): Promise<string> {
  const chats = await api()
    .get('/api/v1/chats')
    .set(...auth(session));
  const chat = (chats.body.data as Array<{ id: string; type: string }>).find(
    (c) => c.type === ChatType.CLUB,
  );
  if (!chat) throw new Error('no club chat');
  return chat.id;
}

describe('the queue', () => {
  it('groups reports by content, most-reported first, with reasons and counts', async () => {
    const discussion = await api()
      .post('/api/v1/discussions')
      .set(...auth(alice))
      .send({ title: 'A thread', body: 'Some text here', category: 'General' });
    const once = discussion.body.data.id as string;
    const other = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'Another', body: 'More text', category: 'General' })
    ).body.data.id as string;

    await report(bob, 'DISCUSSION', once, 'Spam, posted everywhere.');
    await report(bob, 'DISCUSSION', other);
    await report(carol, 'DISCUSSION', other, 'Offensive language here.');
    // Reporting twice is one report.
    await report(bob, 'DISCUSSION', other);

    const items = await queue(principal);
    expect(items.map((item) => item.targetId)).toEqual([other, once]);
    expect(items[0]?.reportCount).toBe(2);
    expect((items[0]?.reports as unknown[]).length).toBe(2);
    expect((items[1]?.preview as { text: string }).text).toContain('A thread');
  });

  it('hides reporters from moderators without audit:read and shows them to those with it', async () => {
    const id = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'Reported', body: 'x x x', category: 'General' })
    ).body.data.id as string;
    await report(bob, 'DISCUSSION', id);

    const forHod = await queue(hod);
    expect((forHod[0]?.reports as Array<{ reporter: unknown }>)[0]?.reporter).toBeNull();

    const forPrincipal = await queue(principal); // principal holds audit:read
    expect(
      (forPrincipal[0]?.reports as Array<{ reporter: { fullName: string } }>)[0]?.reporter
        ?.fullName,
    ).toBe('Test User');
  });

  it('refuses the queue to someone who moderates nothing', async () => {
    expect(
      (
        await api()
          .get('/api/v1/moderation/reports')
          .set(...auth(alice))
      ).status,
    ).toBe(403);
  });
});

describe('scope', () => {
  it('shows a class chat report to that section’s mentor, the HOD and the principal — not the other mentor', async () => {
    const chatId = await classChatId(alice);
    const messageId = await send(alice, chatId, 'offensive remark');
    expect(await report(bob, 'CHAT_MESSAGE', messageId)).toBe(201);

    expect((await queue(mentorA)).map((i) => i.targetId)).toEqual([messageId]);
    expect((await queue(hod)).map((i) => i.targetId)).toEqual([messageId]);
    expect((await queue(principal)).map((i) => i.targetId)).toEqual([messageId]);
    expect(await queue(mentorB)).toEqual([]);
    expect(await queue(clubAdmin)).toEqual([]);

    const outOfScope = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(mentorB))
      .send({
        targetType: 'CHAT_MESSAGE',
        targetId: messageId,
        action: 'REMOVE',
        note: 'Not my section.',
      });
    expect(outOfScope.status).toBe(404);
  });

  it('shows a club chat report to the club admin and principal only', async () => {
    await joinClub(alice);
    await joinClub(bob);
    const chatId = await clubChatId(alice);
    const messageId = await send(alice, chatId, 'rude club message');
    await report(bob, 'CHAT_MESSAGE', messageId);

    expect((await queue(clubAdmin)).map((i) => i.targetId)).toEqual([messageId]);
    expect((await queue(principal)).map((i) => i.targetId)).toEqual([messageId]);
    expect(await queue(mentorA)).toEqual([]);
    expect(await queue(hod)).toEqual([]);
  });

  it('keeps community content with moderation:review holders', async () => {
    const id = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'A community thread', body: 'body text here', category: 'General' })
    ).body.data.id as string;
    await report(bob, 'DISCUSSION', id);
    expect(await queue(mentorA)).toEqual([]);
    expect(await queue(clubAdmin)).toEqual([]);
    expect((await queue(hod)).length).toBe(1);
  });
});

describe('private conversations', () => {
  it('records a DM report but does not make it actionable or show its content', async () => {
    const dm = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.DIRECT, userId: bob.user.id });
    const messageId = await send(alice, dm.body.data.id as string, 'a private message');
    expect(await report(bob, 'CHAT_MESSAGE', messageId)).toBe(201);
    expect(await ContentReportModel.countDocuments({ targetId: messageId })).toBe(1);

    const items = await queue(principal);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actionable: false,
      preview: null,
      context: { kind: 'DIRECT', name: null },
    });
    expect(JSON.stringify(items)).not.toContain('a private message');

    // Scoped moderators do not even see that it exists.
    expect(await queue(mentorA)).toEqual([]);

    const attempt = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(principal))
      .send({
        targetType: 'CHAT_MESSAGE',
        targetId: messageId,
        action: 'REMOVE',
        note: 'Trying to remove.',
      });
    expect(attempt.status).toBe(409);
    const message = await ChatMessageModel.findById(messageId).lean();
    expect(message?.deletedAt).toBeNull();
  });
});

describe('decisions', () => {
  it('removes a class chat message: soft, body removed, audited without the body, reports closed', async () => {
    const chatId = await classChatId(alice);
    const messageId = await send(alice, chatId, 'please remove this text');
    await report(bob, 'CHAT_MESSAGE', messageId, 'Harassment of a classmate.');

    // The HOD is not a member of the class chat; the scope, not membership, decides.
    const decided = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(hod))
      .send({
        targetType: 'CHAT_MESSAGE',
        targetId: messageId,
        action: 'REMOVE',
        note: 'Harassment.',
      });
    expect(decided.status).toBe(200);
    expect(decided.body.data).toEqual({ status: 'REMOVED', closedReports: 1 });

    const message = await ChatMessageModel.findById(messageId).lean();
    expect(message?.deletedAt).toBeTruthy();
    expect(message?.body).toBe('');

    const audit = await AuditLogModel.findOne({
      action: 'CONTENT_REMOVED',
      resourceId: messageId,
    }).lean();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain('please remove this text');

    expect(await queue(hod)).toEqual([]);
    const history = await api()
      .get('/api/v1/moderation/history')
      .set(...auth(hod));
    expect(history.body.data[0]).toMatchObject({
      action: 'REMOVE',
      targetId: messageId,
      note: 'Harassment.',
      reportCount: 1,
    });
  });

  it('requires a reason to remove', async () => {
    const id = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'Another thread', body: 'body text here', category: 'General' })
    ).body.data.id as string;
    await report(bob, 'DISCUSSION', id);
    const response = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(principal))
      .send({ targetType: 'DISCUSSION', targetId: id, action: 'REMOVE' });
    expect(response.status).toBe(422);
  });

  it('dismisses: content stays, reports close, and they do not come back when re-reported by the same people', async () => {
    const id = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'Fine', body: 'harmless', category: 'General' })
    ).body.data.id as string;
    await report(bob, 'DISCUSSION', id);
    await report(carol, 'DISCUSSION', id);

    const dismissed = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(principal))
      .send({ targetType: 'DISCUSSION', targetId: id, action: 'DISMISS' });
    expect(dismissed.body.data).toEqual({ status: 'DISMISSED', closedReports: 2 });
    expect(
      (
        await api()
          .get(`/api/v1/discussions/${id}`)
          .set(...auth(alice))
      ).status,
    ).toBe(200);

    await report(bob, 'DISCUSSION', id);
    expect(await queue(principal)).toEqual([]);

    // A NEW reporter does raise it again.
    const dave = await login(
      await createStudentInSection(tenant, { localPart: 'dave', rollNo: 'M009', departmentId }),
    );
    await report(dave, 'DISCUSSION', id);
    expect((await queue(principal))[0]?.reportCount).toBe(1);

    const audit = await AuditLogModel.findOne({
      action: 'REPORT_DISMISSED',
      resourceId: id,
    }).lean();
    expect(audit).toBeTruthy();
  });

  it('removes a discussion through the queue exactly as the Part A path does', async () => {
    const id = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'Bad', body: 'bad text', category: 'General' })
    ).body.data.id as string;
    await report(bob, 'DISCUSSION', id);
    const removed = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(hod))
      .send({
        targetType: 'DISCUSSION',
        targetId: id,
        action: 'REMOVE',
        note: 'Breaks the rules.',
      });
    expect(removed.status).toBe(200);
    expect(
      (
        await api()
          .get(`/api/v1/discussions/${id}`)
          .set(...auth(alice))
      ).status,
    ).toBe(404);
  });

  it('closes the report records when the Part A endpoint is used instead', async () => {
    const id = (
      await api()
        .post('/api/v1/discussions')
        .set(...auth(alice))
        .send({ title: 'Old path', body: 'text', category: 'General' })
    ).body.data.id as string;
    await report(bob, 'DISCUSSION', id);
    await api()
      .post(`/api/v1/moderation/discussions/${id}`)
      .set(...auth(principal))
      .send({ action: 'DISMISS' });
    expect(await queue(principal)).toEqual([]);
  });
});

describe('leaving a club', () => {
  it('revokes the derived club chat immediately', async () => {
    await joinClub(alice);
    const chatId = await clubChatId(alice);
    expect(
      (
        await api()
          .get(`/api/v1/chats/${chatId}`)
          .set(...auth(alice))
      ).status,
    ).toBe(200);

    const left = await api()
      .post(`/api/v1/clubs/${clubId}/leave`)
      .set(...auth(alice));
    expect(left.status).toBe(200);

    expect(
      (
        await api()
          .get(`/api/v1/chats/${chatId}`)
          .set(...auth(alice))
      ).status,
    ).toBe(404);
    const detail = await api()
      .get(`/api/v1/clubs/${clubId}`)
      .set(...auth(alice));
    expect(detail.body.data.membership?.status ?? 'LEFT').toBe('LEFT');
    expect(detail.body.data.memberCount).toBe(0);

    // Leaving twice, or a club you never joined, is NOT_FOUND.
    expect(
      (
        await api()
          .post(`/api/v1/clubs/${clubId}/leave`)
          .set(...auth(alice))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/clubs/${clubId}/leave`)
          .set(...auth(bob))
      ).status,
    ).toBe(404);
  });

  it('lets a pending request be withdrawn, and can rejoin afterwards', async () => {
    const joined = await api()
      .post(`/api/v1/clubs/${clubId}/join`)
      .set(...auth(alice));
    expect(joined.status).toBe(201);
    expect(
      (
        await api()
          .post(`/api/v1/clubs/${clubId}/leave`)
          .set(...auth(alice))
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(`/api/v1/clubs/${clubId}/join`)
          .set(...auth(alice))
      ).status,
    ).toBe(201);
  });

  it('will not let a club admin orphan their club', async () => {
    expect(
      (
        await api()
          .post(`/api/v1/clubs/${clubId}/leave`)
          .set(...auth(clubAdmin))
      ).status,
    ).toBe(409);
  });
});
