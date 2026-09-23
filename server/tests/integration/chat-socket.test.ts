/**
 * The realtime layer, against a real Socket.IO server on an ephemeral port.
 *
 * Redis is not involved: without `REDIS_URL` the in-memory adapter is used, which is the
 * documented single-instance mode and is enough to test everything except cross-instance
 * fan-out (that lives in chat-realtime-redis.test.ts, gated on TEST_REDIS_URL).
 *
 * The interesting cases here are the ones where a client misbehaves — a missing token, a
 * revoked session, a room it was never invited to, an operator smuggled into a payload — because
 * a socket has none of Express's middleware standing in front of it.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatType } from '@campusconnect/types';
import {
  api,
  app,
  clearDatabase,
  connectTestDatabase,
  createTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
} from '../helpers/testHarness.js';
import { createDepartment, createStudentInSection } from '../helpers/academicFixtures.js';
import { attachRealtime, closeRealtime } from '../../src/sockets/index.js';
import { resetChatNotificationDebounce } from '../../src/services/chat.service.js';
import { Role } from '@campusconnect/types';

let httpServer: HttpServer;
let url: string;
let tenant: TestTenant;
let alice: LoggedIn;
let bob: LoggedIn;
const sockets: Socket[] = [];

beforeAll(async () => {
  await connectTestDatabase();
  httpServer = createServer(app);
  await attachRealtime(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeRealtime();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  resetChatNotificationDebounce();
  tenant = await createTenant();
  const departmentId = await createDepartment(tenant);
  alice = await login(
    await createStudentInSection(tenant, { localPart: 'alice', rollNo: 'W001', departmentId }),
  );
  bob = await login(
    await createStudentInSection(tenant, { localPart: 'bob', rollNo: 'W002', departmentId }),
  );
});

afterEach(() => {
  while (sockets.length > 0) sockets.pop()?.disconnect();
});

/** Connect with a token, resolving on connect or rejecting with the refusal reason. */
function openSocket(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5_000,
    });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err: Error) => reject(err));
  });
}

/** Emit and wait for the ack the server always sends back. */
function emit<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: T) => resolve(response));
  });
}

/** Wait for one server-pushed event, or fail the test rather than hang. */
function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];

let counter = 0;
const clientId = (): string => `ws-msg-${(counter += 1)}-${Date.now()}`;

async function openDirect(from: LoggedIn, toUserId: string): Promise<string> {
  const response = await api()
    .post('/api/v1/chats')
    .set(...auth(from))
    .send({ type: ChatType.DIRECT, userId: toUserId });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('the handshake', () => {
  it('accepts a valid access token', async () => {
    const socket = await openSocket(alice.accessToken);
    expect(socket.connected).toBe(true);
  });

  it('refuses a connection with no token', async () => {
    await expect(openSocket('')).rejects.toThrow(/AUTH_REQUIRED|AUTH_INVALID/);
  });

  it('refuses a forged or malformed token', async () => {
    await expect(openSocket('not-a-token')).rejects.toThrow(/AUTH_INVALID/);
  });

  it('refuses a token whose session has been revoked', async () => {
    // The token is still cryptographically valid — this is exactly the case HTTP tolerates for
    // up to 15 minutes and a long-lived socket must not.
    const revoked = await api().post('/api/v1/auth/logout').set(...auth(alice)).send({});
    expect(revoked.status).toBe(200);

    await expect(openSocket(alice.accessToken)).rejects.toThrow(/AUTH_INVALID/);
  });

  it('disconnects a live socket when its session is revoked', async () => {
    const socket = await openSocket(alice.accessToken);
    const ended = nextEvent(socket, 'disconnect', 6_000);

    await api().post('/api/v1/auth/logout').set(...auth(alice)).send({});

    await ended;
    expect(socket.connected).toBe(false);
  });
});

describe('joining rooms', () => {
  it('joins a chat the caller belongs to', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(alice.accessToken);

    const ack = await emit<{ ok: boolean; data?: { joined: boolean } }>(socket, 'chat:join', { chatId });
    expect(ack.ok).toBe(true);
    expect(ack.data?.joined).toBe(true);
  });

  it('refuses a chat the caller is not in, with the same code REST uses', async () => {
    const carol = await login(
      await createStudentInSection(tenant, {
        localPart: 'carol',
        rollNo: 'W003',
        departmentId: await createDepartment(tenant, 'ECE', 'Electronics'),
      }),
    );
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(carol.accessToken);

    const ack = await emit<{ ok: boolean; error?: { code: string } }>(socket, 'chat:join', { chatId });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('NOT_FOUND');
  });

  it('refuses a chat in another institution', async () => {
    const other = await createTenant();
    const stranger = await login(await createUser(other, { roles: [Role.STUDENT], localPart: 'stranger' }));
    const friend = await createUser(other, { roles: [Role.STUDENT], localPart: 'friend' });
    const theirChat = await openDirect(stranger, friend.id);

    const socket = await openSocket(alice.accessToken);
    const ack = await emit<{ ok: boolean; error?: { code: string } }>(socket, 'chat:join', {
      chatId: theirChat,
    });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('NOT_FOUND');
  });

  it('will not let a client name an arbitrary room', async () => {
    const socket = await openSocket(alice.accessToken);
    // Room names are built server-side from the principal; the only thing a client may send is
    // a chat id, and a non-id is rejected before any join happens.
    const ack = await emit<{ ok: boolean; error?: { code: string } }>(socket, 'chat:join', {
      chatId: `t:${tenant.institutionId}:chat:anything`,
    });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('messaging in realtime', () => {
  it('delivers a message to the other member', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const aliceSocket = await openSocket(alice.accessToken);
    const bobSocket = await openSocket(bob.accessToken);
    await emit(aliceSocket, 'chat:join', { chatId });
    await emit(bobSocket, 'chat:join', { chatId });

    const incoming = nextEvent<{ body: string; sender: { userId: string } }>(bobSocket, 'message:new');
    const ack = await emit<{ ok: boolean; data?: { id: string } }>(aliceSocket, 'message:send', {
      chatId,
      body: 'Hello over the wire',
      clientMessageId: clientId(),
    });

    expect(ack.ok).toBe(true);
    const received = await incoming;
    expect(received.body).toBe('Hello over the wire');
    expect(received.sender.userId).toBe(alice.user.id);
  });

  it('persists what it broadcasts', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(alice.accessToken);
    await emit(socket, 'chat:join', { chatId });
    await emit(socket, 'message:send', { chatId, body: 'Durable', clientMessageId: clientId() });

    // The socket is a delivery mechanism, not a store: the message must be in the database.
    const messages = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(bob));
    expect(messages.body.data.items[0].body).toBe('Durable');
  });

  it('is idempotent across transports', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(alice.accessToken);
    await emit(socket, 'chat:join', { chatId });
    const clientMessageId = clientId();

    // Sent over the socket, then retried over HTTP — one message, because both paths call the
    // same service function with the same client id.
    const first = await emit<{ ok: boolean; data?: { id: string } }>(socket, 'message:send', {
      chatId,
      body: 'Exactly once',
      clientMessageId,
    });
    const retry = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'Exactly once', clientMessageId });

    expect(retry.body.data.id).toBe(first.data?.id);
    const messages = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice));
    expect(messages.body.data.items).toHaveLength(1);
  });

  it('refuses to send into a chat the caller is not in', async () => {
    const carol = await login(
      await createStudentInSection(tenant, { localPart: 'carol2', rollNo: 'W004', departmentId: await createDepartment(tenant, 'MECH', 'Mechanical') }),
    );
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(carol.accessToken);

    const ack = await emit<{ ok: boolean; error?: { code: string } }>(socket, 'message:send', {
      chatId,
      body: 'Let me in',
      clientMessageId: clientId(),
    });
    // Note it does not even require having joined the room: the membership check is on the send.
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('NOT_FOUND');
  });

  it('rejects Mongo operators and dotted keys in a socket payload', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(alice.accessToken);

    // A socket frame never passes through the HTTP sanitize middleware, so the schema itself
    // has to refuse these rather than rely on something upstream stripping them.
    for (const payload of [
      { chatId, body: 'ok', clientMessageId: clientId(), $where: 'sleep(1000)' },
      { chatId, body: 'ok', clientMessageId: clientId(), 'a.b': 1 },
      { chatId, body: { $ne: null }, clientMessageId: clientId() },
    ]) {
      const ack = await emit<{ ok: boolean; error?: { code: string } }>(socket, 'message:send', payload);
      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe('VALIDATION_FAILED');
    }
  });

  it('keeps the socket alive after a rejected payload', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const socket = await openSocket(alice.accessToken);

    await emit(socket, 'message:send', { chatId, body: '', clientMessageId: 'short' });
    expect(socket.connected).toBe(true);

    const ack = await emit<{ ok: boolean }>(socket, 'message:send', {
      chatId,
      body: 'Still working',
      clientMessageId: clientId(),
    });
    expect(ack.ok).toBe(true);
  });

  it('carries typing and read receipts to the other member', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const aliceSocket = await openSocket(alice.accessToken);
    const bobSocket = await openSocket(bob.accessToken);
    await emit(aliceSocket, 'chat:join', { chatId });
    await emit(bobSocket, 'chat:join', { chatId });

    const typing = nextEvent<{ userId: string; typing: boolean }>(bobSocket, 'typing');
    await emit(aliceSocket, 'typing', { chatId, typing: true });
    expect((await typing).userId).toBe(alice.user.id);

    const sent = await emit<{ ok: boolean; data?: { id: string } }>(aliceSocket, 'message:send', {
      chatId,
      body: 'Did you see this?',
      clientMessageId: clientId(),
    });
    const read = nextEvent<{ userId: string; lastReadMessageId: string }>(aliceSocket, 'message:read');
    await emit(bobSocket, 'message:read', { chatId, lastReadMessageId: sent.data?.id });

    const receipt = await read;
    expect(receipt.userId).toBe(bob.user.id);
    expect(receipt.lastReadMessageId).toBe(sent.data?.id);
  });
});

describe('notifications over the socket', () => {
  it('pushes a notification to the recipient’s own room without the message body', async () => {
    const chatId = await openDirect(alice, bob.user.id);
    const bobSocket = await openSocket(bob.accessToken);
    // Bob is connected but not looking at the chat — he is in his own user room only.

    const incoming = nextEvent<{ title: string; body: string }>(bobSocket, 'notification:new');
    await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'Something private', clientMessageId: clientId() });

    const notification = await incoming;
    expect(notification.title).toContain(alice.user.fullName);
    expect(JSON.stringify(notification)).not.toContain('Something private');
  });
});
