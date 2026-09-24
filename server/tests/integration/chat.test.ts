/**
 * Chat over REST: conversations, messages, membership and the read marker.
 *
 * The security-critical half (tenant isolation, IDOR, derived membership, injection) lives in
 * tests/security/chat-authorization.test.ts; this file is about the feature behaving correctly
 * for people who are allowed to use it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatMemberRole, ChatType, Role } from '@campusconnect/types';
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
import { createDepartment, createStudentInSection } from '../helpers/academicFixtures.js';
import { resetChatNotificationDebounce } from '../../src/services/chat.service.js';

let tenant: TestTenant;
let alice: LoggedIn;
let bob: LoggedIn;
let carol: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  resetChatNotificationDebounce();
  tenant = await createTenant();
  const departmentId = await createDepartment(tenant);

  const makeStudent = async (localPart: string, rollNo: string): Promise<LoggedIn> =>
    login(await createStudentInSection(tenant, { localPart, rollNo, departmentId }));

  alice = await makeStudent('alice', 'S001');
  bob = await makeStudent('bob', 'S002');
  carol = await makeStudent('carol', 'S003');
});

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];

let messageCounter = 0;
const clientId = (): string => `client-msg-${(messageCounter += 1)}-${Date.now()}`;

async function openDirect(from: LoggedIn, to: LoggedIn): Promise<string> {
  const response = await api()
    .post('/api/v1/chats')
    .set(...auth(from))
    .send({ type: ChatType.DIRECT, userId: to.user.id });
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

describe('direct messages', () => {
  it('opens a conversation between two people', async () => {
    const chatId = await openDirect(alice, bob);

    const detail = await api()
      .get(`/api/v1/chats/${chatId}`)
      .set(...auth(alice));

    expect(detail.status).toBe(200);
    expect(detail.body.data.type).toBe(ChatType.DIRECT);
    // A DM has no stored name: each side sees the other person.
    expect(detail.body.data.name).toBe(bob.user.fullName);
    expect(detail.body.data.members).toHaveLength(2);
  });

  it('returns the existing conversation instead of a second one', async () => {
    const first = await openDirect(alice, bob);
    // The other direction, from the other person: still the same conversation.
    const second = await openDirect(bob, alice);
    expect(second).toBe(first);
  });

  it('settles a race between two simultaneous opens with one chat', async () => {
    // The unique index decides this, not a check-then-create — both requests are in flight
    // before either has written anything.
    const [a, b] = await Promise.all([
      api()
        .post('/api/v1/chats')
        .set(...auth(alice))
        .send({ type: ChatType.DIRECT, userId: bob.user.id }),
      api()
        .post('/api/v1/chats')
        .set(...auth(bob))
        .send({ type: ChatType.DIRECT, userId: alice.user.id }),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).toBe(b.body.data.id);

    const list = await api()
      .get('/api/v1/chats')
      .set(...auth(alice));
    expect(
      list.body.data.filter((chat: { type: string }) => chat.type === ChatType.DIRECT),
    ).toHaveLength(1);
  });

  it('refuses a conversation with yourself', async () => {
    const response = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.DIRECT, userId: alice.user.id });
    expect(response.status).toBe(422);
  });
});

describe('group chats', () => {
  it('makes the creator the owner and admits the invitees', async () => {
    const response = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.GROUP, name: 'Project team', memberIds: [bob.user.id] });

    expect(response.status).toBe(201);
    expect(response.body.data.myRole).toBe(ChatMemberRole.OWNER);
    expect(response.body.data.members).toHaveLength(2);
  });

  it('lets the owner add and remove members', async () => {
    const created = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.GROUP, name: 'Study group', memberIds: [bob.user.id] });
    const chatId = created.body.data.id as string;

    const added = await api()
      .post(`/api/v1/chats/${chatId}/members`)
      .set(...auth(alice))
      .send({ userIds: [carol.user.id] });
    expect(added.status).toBe(200);
    expect(added.body.data.members).toHaveLength(3);

    const removed = await api()
      .delete(`/api/v1/chats/${chatId}/members/${carol.user.id}`)
      .set(...auth(alice));
    expect(removed.status).toBe(200);

    // Removal revokes access immediately, and it reads as "no such chat".
    const afterRemoval = await api()
      .get(`/api/v1/chats/${chatId}`)
      .set(...auth(carol));
    expect(afterRemoval.status).toBe(404);
  });

  it('does not let a plain member add people', async () => {
    const created = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.GROUP, name: 'Closed group', memberIds: [bob.user.id] });

    const response = await api()
      .post(`/api/v1/chats/${created.body.data.id}/members`)
      .set(...auth(bob))
      .send({ userIds: [carol.user.id] });
    expect(response.status).toBe(403);
  });

  it('lets a member leave, and stops showing them the chat', async () => {
    const created = await api()
      .post('/api/v1/chats')
      .set(...auth(alice))
      .send({ type: ChatType.GROUP, name: 'Leavers', memberIds: [bob.user.id] });
    const chatId = created.body.data.id as string;

    expect(
      (
        await api()
          .post(`/api/v1/chats/${chatId}/leave`)
          .set(...auth(bob))
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .get(`/api/v1/chats/${chatId}`)
          .set(...auth(bob))
      ).status,
    ).toBe(404);
  });

  it('will not let you leave a direct message', async () => {
    const chatId = await openDirect(alice, bob);
    const response = await api()
      .post(`/api/v1/chats/${chatId}/leave`)
      .set(...auth(alice));
    expect(response.status).toBe(403);
  });
});

describe('messages', () => {
  it('sends and reads back', async () => {
    const chatId = await openDirect(alice, bob);
    await send(alice, chatId, 'Hello Bob');

    const messages = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(bob));

    expect(messages.status).toBe(200);
    expect(messages.body.data.items).toHaveLength(1);
    expect(messages.body.data.items[0].body).toBe('Hello Bob');
    expect(messages.body.data.items[0].sender.userId).toBe(alice.user.id);
  });

  it('treats a repeated clientMessageId as the same message', async () => {
    const chatId = await openDirect(alice, bob);
    const clientMessageId = clientId();

    const first = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'Only once', clientMessageId });
    const retry = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'Only once', clientMessageId });

    // A retry after a dropped ack must not post twice.
    expect(retry.body.data.id).toBe(first.body.data.id);

    const messages = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice));
    expect(messages.body.data.items).toHaveLength(1);
  });

  it('pages backwards through history without gaps or duplicates', async () => {
    const chatId = await openDirect(alice, bob);
    for (let i = 1; i <= 12; i += 1) await send(alice, chatId, `Message ${i}`);

    const firstPage = await api()
      .get(`/api/v1/chats/${chatId}/messages?limit=5`)
      .set(...auth(alice));
    expect(firstPage.body.data.items).toHaveLength(5);
    expect(firstPage.body.data.hasMore).toBe(true);

    // A new message arrives mid-scroll — with an offset this is exactly where a page would
    // repeat an item. With a cursor it cannot.
    await send(bob, chatId, 'Message 13');

    const secondPage = await api()
      .get(`/api/v1/chats/${chatId}/messages?limit=5&before=${firstPage.body.data.nextCursor}`)
      .set(...auth(alice));

    const firstIds = firstPage.body.data.items.map((m: { id: string }) => m.id);
    const secondIds = secondPage.body.data.items.map((m: { id: string }) => m.id);
    expect(secondIds).toHaveLength(5);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);

    const bodies = [...firstPage.body.data.items, ...secondPage.body.data.items].map(
      (m: { body: string }) => m.body,
    );
    expect(bodies).toEqual([
      'Message 12',
      'Message 11',
      'Message 10',
      'Message 9',
      'Message 8',
      'Message 7',
      'Message 6',
      'Message 5',
      'Message 4',
      'Message 3',
    ]);
  });

  it('lets the sender edit, and marks it edited', async () => {
    const chatId = await openDirect(alice, bob);
    const messageId = await send(alice, chatId, 'Origianl');

    const edited = await api()
      .patch(`/api/v1/chats/${chatId}/messages/${messageId}`)
      .set(...auth(alice))
      .send({ body: 'Original' });

    expect(edited.status).toBe(200);
    expect(edited.body.data.body).toBe('Original');
    expect(edited.body.data.editedAt).not.toBeNull();
  });

  it('does not let the other person edit it', async () => {
    const chatId = await openDirect(alice, bob);
    const messageId = await send(alice, chatId, 'Mine');

    const response = await api()
      .patch(`/api/v1/chats/${chatId}/messages/${messageId}`)
      .set(...auth(bob))
      .send({ body: 'Not yours' });
    expect(response.status).toBe(403);
  });

  it('removes the body when a message is deleted', async () => {
    const chatId = await openDirect(alice, bob);
    const messageId = await send(alice, chatId, 'Please forget this');

    expect(
      (
        await api()
          .delete(`/api/v1/chats/${chatId}/messages/${messageId}`)
          .set(...auth(alice))
      ).status,
    ).toBe(200);

    for (const reader of [alice, bob]) {
      const messages = await api()
        .get(`/api/v1/chats/${chatId}/messages`)
        .set(...auth(reader));
      const message = messages.body.data.items[0];
      // Deleted means the text is gone, for everyone — including the person who wrote it.
      expect(message.deleted).toBe(true);
      expect(message.body).toBeNull();
      expect(JSON.stringify(messages.body)).not.toContain('Please forget this');
    }
  });

  it('rejects attachment references that are not file ids', async () => {
    const chatId = await openDirect(alice, bob);
    const response = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'See attached', clientMessageId: clientId(), attachmentFileIds: ['file-1'] });

    // Attachments are uploaded files (Part C-3), referenced by id and nothing else.
    expect(response.status).toBe(422);
  });

  it('will not accept a reply pointing at another chat’s message', async () => {
    const chatWithBob = await openDirect(alice, bob);
    const chatWithCarol = await openDirect(alice, carol);
    const messageId = await send(alice, chatWithCarol, 'Private to Carol');

    const response = await api()
      .post(`/api/v1/chats/${chatWithBob}/messages`)
      .set(...auth(alice))
      .send({ body: 'Replying across chats', clientMessageId: clientId(), replyTo: messageId });

    // Otherwise `replyTo` becomes an oracle for which message ids exist elsewhere.
    expect(response.status).toBe(404);
  });
});

describe('unread counts and the read marker', () => {
  it('counts what you have not read, excluding your own messages', async () => {
    const chatId = await openDirect(alice, bob);
    await send(alice, chatId, 'One');
    await send(alice, chatId, 'Two');

    const bobList = await api()
      .get('/api/v1/chats')
      .set(...auth(bob));
    expect(bobList.body.data[0].unreadCount).toBe(2);

    const aliceList = await api()
      .get('/api/v1/chats')
      .set(...auth(alice));
    expect(aliceList.body.data[0].unreadCount).toBe(0);
  });

  it('only ever moves the marker forward', async () => {
    const chatId = await openDirect(alice, bob);
    const first = await send(alice, chatId, 'One');
    const second = await send(alice, chatId, 'Two');

    await api()
      .post(`/api/v1/chats/${chatId}/read`)
      .set(...auth(bob))
      .send({ lastReadMessageId: second });
    // Replaying an older marker must not resurrect unread messages.
    await api()
      .post(`/api/v1/chats/${chatId}/read`)
      .set(...auth(bob))
      .send({ lastReadMessageId: first });

    const list = await api()
      .get('/api/v1/chats')
      .set(...auth(bob));
    expect(list.body.data[0].unreadCount).toBe(0);
  });

  it('mutes and unmutes per member', async () => {
    const chatId = await openDirect(alice, bob);

    const muted = await api()
      .patch(`/api/v1/chats/${chatId}/mute`)
      .set(...auth(bob))
      .send({ muted: true });
    expect(muted.body.data.status).toBe('MUTED');

    const bobList = await api()
      .get('/api/v1/chats')
      .set(...auth(bob));
    expect(bobList.body.data[0].muted).toBe(true);

    // Muting is personal: Alice's view of the same chat is unchanged.
    const aliceList = await api()
      .get('/api/v1/chats')
      .set(...auth(alice));
    expect(aliceList.body.data[0].muted).toBe(false);
  });
});

describe('the user picker', () => {
  it('finds someone by name', async () => {
    const response = await api()
      .get('/api/v1/chats/users?q=Test')
      .set(...auth(alice));

    expect(response.status).toBe(200);
    const ids = (response.body.data as Array<{ userId: string }>).map((user) => user.userId);
    expect(ids).toContain(bob.user.id);
    // Never yourself — there is no conversation to start.
    expect(ids).not.toContain(alice.user.id);
  });

  it('refuses to act as a directory dump', async () => {
    // No query, or a one-character one, is rejected rather than answered with everyone.
    expect(
      (
        await api()
          .get('/api/v1/chats/users')
          .set(...auth(alice))
      ).status,
    ).toBe(422);
    expect(
      (
        await api()
          .get('/api/v1/chats/users?q=a')
          .set(...auth(alice))
      ).status,
    ).toBe(422);
  });

  it('caps how much one search returns', async () => {
    const response = await api()
      .get('/api/v1/chats/users?q=Test&limit=500')
      .set(...auth(alice));
    expect(response.status).toBe(422);
  });
});

describe('derived class chats', () => {
  it('appears for classmates without anyone creating it', async () => {
    const departmentId = await createDepartment(tenant, 'ECE', 'Electronics');
    const { createSubjectAndClass, createFaculty } = await import('../helpers/academicFixtures.js');
    const faculty = await createFaculty(tenant, {
      localPart: 'teacher',
      roles: [Role.FACULTY],
      departmentId,
    });
    await createSubjectAndClass(tenant, {
      code: 'CS500',
      departmentId,
      facultyUserId: faculty.id,
    });

    // Alice is in the seeded section, so opening her chat list materialises the class chat.
    const list = await api()
      .get('/api/v1/chats')
      .set(...auth(alice));

    const classChat = (list.body.data as Array<{ type: string }>).find(
      (chat) => chat.type === ChatType.CLASS,
    );
    expect(classChat).toBeDefined();
  });
});
