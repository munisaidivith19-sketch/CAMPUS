/**
 * Chat authorization: tenant isolation, IDOR, derived membership revocation, injection and
 * moderation.
 *
 * The property every case here defends is the same one: **an active membership row is the only
 * thing that grants access to a conversation, and its absence is indistinguishable from the
 * conversation not existing.** A refusal that said FORBIDDEN would confirm the chat is real,
 * which is precisely what the platform's enumeration rules forbid elsewhere.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatType, ClubMembershipStatus, Role } from '@campusconnect/types';
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
} from '../../server/tests/helpers/testHarness.js';
import {
  createClub,
  createDepartment,
  createFaculty,
  createStudentInSection,
  createSubjectAndClass,
} from '../../server/tests/helpers/academicFixtures.js';
import { AuditLogModel } from '../../server/src/models/AuditLog.model.js';
import { ClubMembershipModel } from '../../server/src/models/ClubMembership.model.js';
import { ChatMessageModel } from '../../server/src/models/ChatMessage.model.js';
import { resetChatNotificationDebounce } from '../../server/src/services/chat.service.js';

let ours: TestTenant;
let theirs: TestTenant;
let departmentId: string;
let alice: LoggedIn;
let bob: LoggedIn;
let outsider: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  resetChatNotificationDebounce();

  ours = await createTenant();
  theirs = await createTenant();
  departmentId = await createDepartment(ours);

  alice = await login(
    await createStudentInSection(ours, { localPart: 'alice', rollNo: 'A001', departmentId }),
  );
  bob = await login(
    await createStudentInSection(ours, { localPart: 'bob', rollNo: 'A002', departmentId }),
  );
  outsider = await login(
    await createUser(theirs, { roles: [Role.STUDENT], localPart: 'outsider' }),
  );
});

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];

let counter = 0;
const clientId = (): string => `sec-msg-${(counter += 1)}-${Date.now()}`;

async function openDirect(from: LoggedIn, toUserId: string): Promise<string> {
  const response = await api()
    .post('/api/v1/chats')
    .set(...auth(from))
    .send({ type: ChatType.DIRECT, userId: toUserId });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function send(session: LoggedIn, chatId: string, body: string): Promise<string> {
  const response = await api()
    .post(`/api/v1/chats/${chatId}/messages`)
    .set(...auth(session))
    .send({ body, clientMessageId: clientId() });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('cross-tenant isolation', () => {
  it('will not open a conversation with someone in another institution', async () => {
    const response = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.DIRECT, userId: outsider.user.id });

    // NOT_FOUND, not FORBIDDEN: the reply must not confirm that user exists anywhere.
    expect(response.status).toBe(404);
  });

  it('hides another institution’s chat completely', async () => {
    const theirChat = await openDirect(
      outsider,
      (await createUser(theirs, { roles: [Role.STUDENT], localPart: 'theirfriend' })).id,
    );

    for (const call of [
      api().get(`/api/v1/chats/${theirChat}`).set(...auth(alice)),
      api().get(`/api/v1/chats/${theirChat}/messages`).set(...auth(alice)),
      api()
        .post(`/api/v1/chats/${theirChat}/messages`)
        .set(...auth(alice))
        .send({ body: 'Hello', clientMessageId: clientId() }),
      api().post(`/api/v1/chats/${theirChat}/leave`).set(...auth(alice)),
      api().patch(`/api/v1/chats/${theirChat}/mute`).set(...auth(alice)).send({ muted: true }),
    ]) {
      expect((await call).status).toBe(404);
    }
  });

  it('does not list another institution’s chats', async () => {
    await openDirect(alice, bob.user.id);
    const list = await api()
      .get('/api/v1/chats')
      .set(...auth(outsider));
    expect(list.body.data).toHaveLength(0);
  });

  it('does not surface other institutions’ people in the user picker', async () => {
    const response = await api()
      .get('/api/v1/chats/users?q=Test')
      .set(...auth(alice));
    const ids = (response.body.data as Array<{ userId: string }>).map((user) => user.userId);
    expect(ids).not.toContain(outsider.user.id);
  });
});

describe('IDOR', () => {
  it('gives a non-member the same 404 as a nonexistent chat', async () => {
    const carol = await login(
      await createStudentInSection(ours, { localPart: 'carol', rollNo: 'A003', departmentId }),
    );
    const privateChat = await openDirect(alice, bob.user.id);

    const real = await api()
      .get(`/api/v1/chats/${privateChat}`)
      .set(...auth(carol));
    const imaginary = await api()
      .get('/api/v1/chats/6ab369bfaf8baecf4ad0d90f')
      .set(...auth(carol));

    // Identical replies: a member of the institution cannot use the API to discover which chat
    // ids are real.
    expect(real.status).toBe(404);
    expect(imaginary.status).toBe(404);
    expect(real.body.error.code).toBe(imaginary.body.error.code);
  });

  it('will not let a non-member send, edit, delete or mark read', async () => {
    const carol = await login(
      await createStudentInSection(ours, { localPart: 'carol2', rollNo: 'A004', departmentId }),
    );
    const chatId = await openDirect(alice, bob.user.id);
    const messageId = await send(alice, chatId, 'Between us');

    const calls = [
      api()
        .post(`/api/v1/chats/${chatId}/messages`)
        .set(...auth(carol))
        .send({ body: 'Intruding', clientMessageId: clientId() }),
      api()
        .patch(`/api/v1/chats/${chatId}/messages/${messageId}`)
        .set(...auth(carol))
        .send({ body: 'Rewritten' }),
      api().delete(`/api/v1/chats/${chatId}/messages/${messageId}`).set(...auth(carol)),
      api()
        .post(`/api/v1/chats/${chatId}/read`)
        .set(...auth(carol))
        .send({ lastReadMessageId: messageId }),
    ];
    for (const call of calls) expect((await call).status).toBe(404);
  });
});

describe('derived membership follows the source', () => {
  it('revokes club chat access the moment membership is revoked', async () => {
    const clubAdmin = await createFaculty(ours, {
      localPart: 'clubadmin',
      roles: [Role.CLUB_ADMIN],
      departmentId,
    });
    const adminSession = await login(clubAdmin);
    const clubId = await createClub(ours, { name: 'Robotics', adminUserIds: [clubAdmin.id] });

    // Alice joins and is approved, which is what creates her place in the club conversation.
    await api().post(`/api/v1/clubs/${clubId}/join`).set(...auth(alice));
    const members = await api()
      .get(`/api/v1/clubs/${clubId}/members?status=REQUESTED`)
      .set(...auth(adminSession));
    const membershipId = members.body.data[0].id as string;
    await api()
      .patch(`/api/v1/clubs/memberships/${membershipId}`)
      .set(...auth(adminSession))
      .send({ decision: ClubMembershipStatus.APPROVED });

    const list = await api().get('/api/v1/chats').set(...auth(alice));
    const clubChat = (list.body.data as Array<{ id: string; type: string }>).find(
      (chat) => chat.type === ChatType.CLUB,
    );
    expect(clubChat).toBeDefined();
    expect((await api().get(`/api/v1/chats/${clubChat!.id}`).set(...auth(alice))).status).toBe(200);

    // Her club membership ends. (Part A has no "leave club" endpoint yet, so the underlying
    // record is ended directly — what is under test is that chat access follows the club
    // membership, not the route that changed it.)
    await ClubMembershipModel.updateOne(
      { _id: membershipId },
      { $set: { status: ClubMembershipStatus.LEFT } },
    ).exec();

    expect((await api().get(`/api/v1/chats/${clubChat!.id}`).set(...auth(alice))).status).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/chats/${clubChat!.id}/messages`)
          .set(...auth(alice))
          .send({ body: 'Still here?', clientMessageId: clientId() })
      ).status,
    ).toBe(404);
  });

  it('keeps a class chat to the section it belongs to', async () => {
    const otherDepartment = await createDepartment(ours, 'MECH', 'Mechanical');
    const outsiderStudent = await login(
      await createStudentInSection(ours, {
        localPart: 'othersection',
        rollNo: 'A099',
        departmentId: otherDepartment,
        section: 'B',
      }),
    );
    await createSubjectAndClass(ours, { code: 'CS600', departmentId });

    const aliceList = await api().get('/api/v1/chats').set(...auth(alice));
    const classChat = (aliceList.body.data as Array<{ id: string; type: string }>).find(
      (chat) => chat.type === ChatType.CLASS,
    );
    expect(classChat).toBeDefined();

    // A student in another section is not on the roster, so the chat is not theirs to open.
    expect(
      (await api().get(`/api/v1/chats/${classChat!.id}`).set(...auth(outsiderStudent))).status,
    ).toBe(404);
  });
});

describe('injection and payload shape', () => {
  it('refuses a body that is an operator object rather than text', async () => {
    const chatId = await openDirect(alice, bob.user.id);

    const response = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: { $ne: null }, clientMessageId: clientId() });

    // The edge strips the `$ne`, and what is left is not a string — so Zod refuses it.
    expect(response.status).toBe(422);
  });

  it('strips operator and dotted keys smuggled alongside a message', async () => {
    const chatId = await openDirect(alice, bob.user.id);

    const response = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({
        body: 'Looks innocent',
        clientMessageId: clientId(),
        'a.b': 1,
        $where: 'sleep(1000)',
      });

    // Stripped at the edge (SECURITY.md §5) rather than rejected, and nothing of the payload
    // survives into the stored message.
    expect(response.status).toBe(201);
    const stored = await ChatMessageModel.findById(response.body.data.id).lean().exec();
    expect(JSON.stringify(stored)).not.toContain('$where');
    expect(JSON.stringify(stored)).not.toContain('a.b');
  });

  it('refuses an oversized or empty message', async () => {
    const chatId = await openDirect(alice, bob.user.id);

    for (const body of ['', '   ', 'x'.repeat(4001)]) {
      const response = await api()
        .post(`/api/v1/chats/${chatId}/messages`)
        .set(...auth(alice))
        .send({ body, clientMessageId: clientId() });
      expect(response.status).toBe(422);
    }
  });
});

describe('moderation', () => {
  it('lets a club admin remove a message in their own club chat, and audits it', async () => {
    const clubAdmin = await createFaculty(ours, {
      localPart: 'moderator',
      roles: [Role.CLUB_ADMIN],
      departmentId,
    });
    const adminSession = await login(clubAdmin);
    const clubId = await createClub(ours, { name: 'Debate', adminUserIds: [clubAdmin.id] });

    await api().post(`/api/v1/clubs/${clubId}/join`).set(...auth(alice));
    const members = await api()
      .get(`/api/v1/clubs/${clubId}/members?status=REQUESTED`)
      .set(...auth(adminSession));
    await api()
      .patch(`/api/v1/clubs/memberships/${members.body.data[0].id}`)
      .set(...auth(adminSession))
      .send({ decision: ClubMembershipStatus.APPROVED });

    const list = await api().get('/api/v1/chats').set(...auth(alice));
    const clubChat = (list.body.data as Array<{ id: string; type: string }>).find(
      (chat) => chat.type === ChatType.CLUB,
    )!;
    const messageId = await send(alice, clubChat.id, 'Something inappropriate');

    const removed = await api()
      .delete(`/api/v1/chats/${clubChat.id}/messages/${messageId}`)
      .set(...auth(adminSession));
    expect(removed.status).toBe(200);

    const after = await api()
      .get(`/api/v1/chats/${clubChat.id}/messages`)
      .set(...auth(alice));
    const message = (after.body.data.items as Array<{ id: string; deleted: boolean; body: string | null }>).find(
      (item) => item.id === messageId,
    );
    expect(message?.deleted).toBe(true);
    expect(message?.body).toBeNull();

    const audit = await AuditLogModel.findOne({ resourceId: messageId }).lean().exec();
    expect(audit?.action).toBe('CONTENT_REMOVED');
    // The audit trail records that a message was removed — never what it said.
    expect(JSON.stringify(audit)).not.toContain('Something inappropriate');
  });

  it('does not let a moderator reach a private conversation', async () => {
    const principalSession = await login(
      await createFaculty(ours, { localPart: 'bigboss', roles: [Role.PRINCIPAL], departmentId }),
    );
    const chatId = await openDirect(alice, bob.user.id);
    const messageId = await send(alice, chatId, 'A private matter');

    // Holding chat:moderate institution-wide still does not reach a DM: there is no scope that
    // contains one, so the request cannot even see the chat.
    const response = await api()
      .delete(`/api/v1/chats/${chatId}/messages/${messageId}`)
      .set(...auth(principalSession));
    expect(response.status).toBe(404);
  });

  it('accepts a report of a chat message only from inside the chat', async () => {
    const carol = await login(
      await createStudentInSection(ours, { localPart: 'carol3', rollNo: 'A005', departmentId }),
    );
    const chatId = await openDirect(alice, bob.user.id);
    const messageId = await send(alice, chatId, 'Reportable');

    const fromMember = await api()
      .post('/api/v1/reports')
      .set(...auth(bob))
      .send({ targetType: 'CHAT_MESSAGE', targetId: messageId, reason: 'This is abusive' });
    expect(fromMember.status).toBe(201);

    // A non-member reporting would otherwise be an oracle for "does this message id exist?".
    const fromOutsider = await api()
      .post('/api/v1/reports')
      .set(...auth(carol))
      .send({ targetType: 'CHAT_MESSAGE', targetId: messageId, reason: 'This is abusive' });
    expect(fromOutsider.status).toBe(404);
  });
});

describe('notifications about chat', () => {
  it('tells a member something was said without repeating what', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    await send(alice, chatId, 'A secret only the two of us should read');

    const notifications = await api()
      .get('/api/v1/notifications')
      .set(...auth(bob));

    expect(notifications.body.data).toHaveLength(1);
    const notification = notifications.body.data[0];
    expect(notification.title).toContain(alice.user.fullName);
    // The body reaches email and push, so it must never carry the message.
    expect(JSON.stringify(notifications.body)).not.toContain('A secret only the two of us');
  });

  it('does not notify a member who muted the chat', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    await api().patch(`/api/v1/chats/${chatId}/mute`).set(...auth(bob)).send({ muted: true });

    await send(alice, chatId, 'Quietly');

    const notifications = await api()
      .get('/api/v1/notifications')
      .set(...auth(bob));
    expect(notifications.body.data).toHaveLength(0);
  });

  it('debounces a burst into one notification', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    for (let i = 0; i < 10; i += 1) await send(alice, chatId, `Rapid ${i}`);

    const notifications = await api()
      .get('/api/v1/notifications')
      .set(...auth(bob));

    // Ten messages in one conversation is one thing to be told about, not ten.
    expect(notifications.body.data).toHaveLength(1);
  });
});
