/**
 * Cross-instance fan-out through the Redis adapter.
 *
 * Skipped unless `TEST_REDIS_URL` is set, for the same reason as the delivery-queue file: the
 * suite must stay runnable with nothing but the database. What this proves cannot be faked —
 * that a message sent to one server instance reaches a client connected to a different one — so
 * it needs two real servers and a real Redis.
 *
 * Run it with:
 *   TEST_REDIS_URL=redis://localhost:6379 npx vitest run tests/integration/chat-realtime-redis.test.ts
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatType } from '@campusconnect/types';
import {
  api,
  app,
  clearDatabase,
  connectTestDatabase,
  createTenant,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
} from '../helpers/testHarness.js';
import { createDepartment, createStudentInSection } from '../helpers/academicFixtures.js';
import { chatRoom } from '../../src/sockets/index.js';
import { principalFromAccessToken } from '../../src/middleware/auth.middleware.js';
import * as chatService from '../../src/services/chat.service.js';

const url = process.env.TEST_REDIS_URL;

interface Instance {
  server: HttpServer;
  io: Server;
  url: string;
  clients: Redis[];
}

/**
 * A second, minimal instance.
 *
 * It runs the same handshake and join policy as the real one but is built here rather than
 * reusing `attachRealtime`, because that module keeps a single process-wide server — and the
 * whole point of this file is to have two of them at once.
 */
async function startInstance(): Promise<Instance> {
  const server = createServer(app);
  const io = new Server(server, { cors: { origin: true } });

  const pub = new Redis(url ?? 'redis://localhost:6379');
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token ?? '';
    void principalFromAccessToken(token)
      .then((principal) => {
        socket.data.principal = principal;
        next();
      })
      .catch(() => next(new Error('AUTH_INVALID')));
  });

  io.on('connection', (socket) => {
    socket.on('chat:join', (payload: { chatId: string }, ack?: (r: unknown) => void) => {
      const principal = socket.data.principal as Awaited<ReturnType<typeof principalFromAccessToken>>;
      void chatService
        .assertCanJoinChatRoom(principal, payload.chatId)
        .then(async () => {
          await socket.join(chatRoom(principal.institutionId, payload.chatId));
          ack?.({ ok: true });
        })
        .catch(() => ack?.({ ok: false }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    server,
    io,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    clients: [pub, sub],
  };
}

describe.skipIf(!url)('two instances behind one Redis', () => {
  let instanceA: Instance;
  let instanceB: Instance;
  let tenant: TestTenant;
  let alice: LoggedIn;
  let bob: LoggedIn;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await connectTestDatabase();
    instanceA = await startInstance();
    instanceB = await startInstance();
  });

  afterAll(async () => {
    for (const instance of [instanceA, instanceB]) {
      await instance.io.close();
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      for (const client of instance.clients) await client.quit();
    }
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    tenant = await createTenant();
    const departmentId = await createDepartment(tenant);
    alice = await login(
      await createStudentInSection(tenant, { localPart: 'alice', rollNo: 'R001', departmentId }),
    );
    bob = await login(
      await createStudentInSection(tenant, { localPart: 'bob', rollNo: 'R002', departmentId }),
    );
  });

  afterEach(() => {
    while (sockets.length > 0) sockets.pop()?.disconnect();
  });

  function openSocket(instance: Instance, token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect(instance.url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  it('delivers a message across instances', async () => {
    const created = await api()
      .post('/api/v1/chats')
      .set('authorization', `Bearer ${alice.accessToken}`)
      .send({ type: ChatType.DIRECT, userId: bob.user.id });
    const chatId = created.body.data.id as string;

    // Bob is connected to instance B; the message will be sent through instance A.
    const bobSocket = await openSocket(instanceB, bob.accessToken);
    await new Promise<void>((resolve) => {
      bobSocket.emit('chat:join', { chatId }, () => resolve());
    });

    const incoming = new Promise<{ body: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no cross-instance delivery')), 5_000);
      bobSocket.once('message:new', (payload: { body: string }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    // Instance A is the one that writes and broadcasts. Without the Redis adapter this event
    // would never leave it.
    instanceA.io.to(chatRoom(tenant.institutionId, chatId)).emit('message:new', {
      chatId,
      body: 'Across the wire',
    });

    expect((await incoming).body).toBe('Across the wire');
  });

  it('does not leak an event into another tenant’s room', async () => {
    const otherTenant = await createTenant();
    const stranger = await login(
      await createStudentInSection(otherTenant, {
        localPart: 'stranger',
        rollNo: 'R003',
        departmentId: await createDepartment(otherTenant),
      }),
    );

    const created = await api()
      .post('/api/v1/chats')
      .set('authorization', `Bearer ${alice.accessToken}`)
      .send({ type: ChatType.DIRECT, userId: bob.user.id });
    const chatId = created.body.data.id as string;

    const strangerSocket = await openSocket(instanceB, stranger.accessToken);
    // The stranger asks to join by id, and the policy refuses — the room name is tenant-scoped
    // and they are not a member of that chat.
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      strangerSocket.emit('chat:join', { chatId }, resolve);
    });
    expect(ack.ok).toBe(false);

    let leaked = false;
    strangerSocket.on('message:new', () => {
      leaked = true;
    });
    instanceA.io.to(chatRoom(tenant.institutionId, chatId)).emit('message:new', { chatId, body: 'Private' });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(leaked).toBe(false);
  });
});
