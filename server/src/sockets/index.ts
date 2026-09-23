/**
 * The realtime layer.
 *
 * Three rules shape it:
 *
 *  1. **The handshake is the same identity check as HTTP, plus one.** It calls
 *     `principalFromAccessToken` — the very function the HTTP middleware uses — so a socket and
 *     a request can never disagree about who the caller is. On top of that it checks the
 *     session is still live, which HTTP deliberately does not do: an access token is valid for
 *     at most 15 minutes and a request is over in milliseconds, whereas a socket would sit
 *     there for hours, so a revoked device must be refused at the door and thrown out mid-call.
 *
 *  2. **A client never names a room.** Room names are built here from the principal's tenant.
 *     `chat:join` takes a chat id and runs the same `chatAccess` policy the REST route runs;
 *     anything else is refused.
 *
 *  3. **A handler can fail, a socket cannot.** Every handler is wrapped: a throw becomes an ack
 *     `{ok:false, error:{code}}` with a stable code, and the connection stays up.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ErrorCode } from '@campusconnect/config';
import type { Principal } from '@campusconnect/security';
import {
  socketChatIdSchema,
  socketReadSchema,
  socketSendMessageSchema,
  socketTypingSchema,
} from '@campusconnect/validation';
import { config } from '../config/env.js';
import { principalFromAccessToken } from '../middleware/auth.middleware.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getRedisClient, waitForRedisReady } from '../infra/redis.js';
import { setRealtimeEmitter } from '../services/realtimeBus.js';
import * as chatService from '../services/chat.service.js';

/** Rooms are tenant-scoped by construction: the tenant comes from the principal, never a client. */
export const userRoom = (institutionId: string, userId: string): string =>
  `t:${institutionId}:user:${userId}`;
export const chatRoom = (institutionId: string, chatId: string): string =>
  `t:${institutionId}:chat:${chatId}`;

interface SocketData {
  principal: Principal;
  /** Sliding-window event counter for this connection. */
  events: { windowStartedAt: number; count: number };
}

type ChatSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

let io: Server | null = null;
let degraded = false;

/** True when realtime is running without the Redis adapter (single-instance fan-out only). */
export function isRealtimeDegraded(): boolean {
  return degraded;
}

/** An ack the client can act on: a stable code, never an internal message. */
function failure(err: unknown): { ok: false; error: { code: string; message: string } } {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  logger.error({ err }, 'Unhandled socket handler error');
  return { ok: false, error: { code: ErrorCode.INTERNAL, message: 'Something went wrong.' } };
}

/**
 * Per-connection event budget.
 *
 * Cheap and local on purpose: this is abuse protection for one socket, not a distributed quota.
 * The per-user send limit that actually matters lives on the service path and is Redis-backed.
 */
function withinBudget(socket: ChatSocket): boolean {
  const now = Date.now();
  const state = socket.data.events;
  if (now - state.windowStartedAt > 60_000) {
    state.windowStartedAt = now;
    state.count = 0;
  }
  state.count += 1;
  return state.count <= config.CHAT_SOCKET_EVENTS_PER_MINUTE;
}

type Ack = ((response: unknown) => void) | undefined;

/**
 * Wrap a handler so it always answers and never takes the socket down.
 *
 * Validation, authorization and internal failures all come back through the same ack shape, so
 * a client has one thing to handle rather than three.
 */
function handler<T>(
  socket: ChatSocket,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
  run: (principal: Principal, payload: T) => Promise<unknown>,
): (payload: unknown, ack: Ack) => void {
  return (payload: unknown, ack: Ack) => {
    if (!withinBudget(socket)) {
      ack?.({ ok: false, error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests.' } });
      return;
    }

    // The same Zod schemas the REST routes use, including the `$`/dotted-key rejection: a
    // socket frame never passes through the HTTP sanitize middleware, so this is its only check.
    const parsed = schema.safeParse(payload);
    if (!parsed.success || parsed.data === undefined) {
      ack?.({
        ok: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Validation failed.' },
      });
      return;
    }

    void run(socket.data.principal, parsed.data)
      .then((data) => ack?.({ ok: true, data }))
      .catch((err: unknown) => ack?.(failure(err)));
  };
}

// --- Presence ------------------------------------------------------------------

/**
 * Who is online, per tenant.
 *
 * In-process: with the Redis adapter this reflects the instance a viewer is connected to, so
 * presence is best-effort rather than a guarantee. It is a nicety, and treating it as anything
 * more would put a Redis dependency in front of every socket connect.
 */
const online = new Map<string, Set<string>>();

function presenceKey(institutionId: string): string {
  return institutionId;
}

function markOnline(institutionId: string, userId: string): boolean {
  const key = presenceKey(institutionId);
  const users = online.get(key) ?? new Set<string>();
  const wasOffline = !users.has(userId);
  users.add(userId);
  online.set(key, users);
  return wasOffline;
}

function markOffline(institutionId: string, userId: string): boolean {
  const users = online.get(presenceKey(institutionId));
  if (!users) return false;
  users.delete(userId);
  return true;
}

/**
 * Tell this user's chats that they came or went.
 *
 * Presence is announced into the rooms of the chats they belong to, so it reaches exactly the
 * people who already share a conversation with them and nobody else.
 */
async function announcePresence(principal: Principal, isOnline: boolean): Promise<void> {
  if (!io) return;
  try {
    const chatIds = await chatService.chatPeers(principal);
    const payload = {
      userId: principal.userId,
      online: isOnline,
      lastSeenAt: isOnline ? null : new Date().toISOString(),
    };
    for (const chatId of chatIds) {
      io.to(chatRoom(principal.institutionId, chatId)).emit('presence', payload);
    }
  } catch (err) {
    logger.error({ err }, 'Could not announce presence');
  }
}

// --- Connection ----------------------------------------------------------------

async function authenticateSocket(socket: ChatSocket): Promise<Principal> {
  // The token comes from the auth payload only — never a query string (which lands in proxy
  // logs and Referer headers) and never a cookie we would then have to defend against CSRF.
  const raw = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('AUTH_REQUIRED');
  }

  const principal = await principalFromAccessToken(raw);

  // A socket outlives the request that opened it, so the session is checked here even though
  // HTTP does not: signing out on another device must not leave a live socket behind. A token
  // with no session claim at all is refused rather than waved through — fail closed.
  if (!principal.sessionId) throw new Error('AUTH_INVALID');
  const session = await sessionRepository.findLiveById(principal.sessionId);
  if (!session || String(session.userId) !== principal.userId) {
    throw new Error('AUTH_INVALID');
  }

  return principal;
}

function registerHandlers(socket: ChatSocket): void {
  const { principal } = socket.data;

  socket.on(
    'chat:join',
    handler(socket, socketChatIdSchema, async (caller, payload) => {
      // The same policy the REST route runs. A chat the caller is not in throws NOT_FOUND, and
      // the room is never joined — a client cannot name its way into a conversation.
      await chatService.assertCanJoinChatRoom(caller, payload.chatId);
      await socket.join(chatRoom(caller.institutionId, payload.chatId));
      return { chatId: payload.chatId, joined: true };
    }),
  );

  socket.on(
    'chat:leave',
    handler(socket, socketChatIdSchema, async (caller, payload) => {
      await socket.leave(chatRoom(caller.institutionId, payload.chatId));
      return { chatId: payload.chatId, joined: false };
    }),
  );

  socket.on(
    'message:send',
    handler(socket, socketSendMessageSchema, async (caller, payload) =>
      // The SAME service function the REST fallback calls: one send path, so idempotency,
      // authorization, fan-out and notifications cannot differ between the two.
      chatService.sendMessage(caller, payload.chatId, {
        body: payload.body,
        clientMessageId: payload.clientMessageId,
        replyTo: payload.replyTo,
      }),
    ),
  );

  socket.on(
    'message:read',
    handler(socket, socketReadSchema, async (caller, payload) =>
      chatService.markRead(caller, payload.chatId, payload.lastReadMessageId),
    ),
  );

  socket.on(
    'typing',
    handler(socket, socketTypingSchema, async (caller, payload) => {
      // Typing is ephemeral and never stored, but it still needs the membership check: it would
      // otherwise let a non-member confirm a chat exists by watching for an error.
      await chatService.assertCanJoinChatRoom(caller, payload.chatId);
      socket
        .to(chatRoom(caller.institutionId, payload.chatId))
        .emit('typing', { chatId: payload.chatId, userId: caller.userId, typing: payload.typing });
      return { ok: true };
    }),
  );

  socket.on('disconnect', () => {
    // Only announce "offline" once the user's last socket goes: two tabs are one person.
    const remaining = io?.sockets.adapter.rooms.get(
      userRoom(principal.institutionId, principal.userId),
    );
    if (!remaining || remaining.size === 0) {
      markOffline(principal.institutionId, principal.userId);
      void announcePresence(principal, false);
    }
  });
}

/**
 * Attach Socket.IO to the HTTP server.
 *
 * Returns the server so the caller can close it; safe to call once. When Redis is available the
 * Redis adapter fans events out across instances; when it is not, the in-memory adapter keeps
 * chat working on this instance alone and `isRealtimeDegraded()` reports it.
 */
export async function attachRealtime(httpServer: HttpServer): Promise<Server> {
  if (io) return io;

  io = new Server(httpServer, {
    // The same allowlist HTTP uses. A socket is not a second, looser front door.
    cors: { origin: config.CORS_ALLOWED_ORIGINS, credentials: true },
    // A chat message is at most 4000 characters; this is generous and still bounded.
    maxHttpBufferSize: 64 * 1024,
    pingTimeout: 30_000,
  });

  await attachAdapter(io);

  io.use((socket, next) => {
    void authenticateSocket(socket as ChatSocket)
      .then((principal) => {
        (socket as ChatSocket).data.principal = principal;
        (socket as ChatSocket).data.events = { windowStartedAt: Date.now(), count: 0 };
        next();
      })
      .catch((err: unknown) => {
        // Refuse the connection. The message is a code, not a reason: a client that guesses a
        // token learns only that it did not work.
        const code = err instanceof Error && err.message === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'AUTH_INVALID';
        next(new Error(code));
      });
  });

  io.on('connection', (socket) => {
    const chatSocket = socket as ChatSocket;
    const { principal } = chatSocket.data;

    // The user's own room is joined automatically — it is how notifications and forced
    // disconnects reach them — and it is the only room joined without a policy check, because
    // it is derived from their own identity.
    void chatSocket.join(userRoom(principal.institutionId, principal.userId));
    registerHandlers(chatSocket);

    if (markOnline(principal.institutionId, principal.userId)) {
      void announcePresence(principal, true);
    }
  });

  // From here on, services can reach connected clients.
  setRealtimeEmitter({
    toChat: (institutionId, chatId, event, payload) => {
      io?.to(chatRoom(institutionId, chatId)).emit(event, payload);
    },
    toUser: (institutionId, userId, event, payload) => {
      io?.to(userRoom(institutionId, userId)).emit(event, payload);
    },
    disconnectUser: (institutionId, userId, reason) => {
      const room = userRoom(institutionId, userId);
      io?.to(room).emit('session:ended', { reason });
      // `true` closes the underlying connection rather than just leaving the room, so a revoked
      // device stops receiving anything immediately instead of at its next reconnect.
      io?.in(room).disconnectSockets(true);
    },
  });

  logger.info({ degraded }, 'Realtime attached');
  return io;
}

/**
 * Use the Redis adapter when Redis is reachable.
 *
 * Failing to attach it is a degradation, not an error: chat keeps working, but only between
 * clients connected to this instance. That is logged once and reported by `isRealtimeDegraded`,
 * mirroring how the delivery queue handles the same outage.
 */
async function attachAdapter(server: Server): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    degraded = true;
    logger.info('Realtime is single-instance (REDIS_URL not set): events do not cross instances');
    return;
  }

  try {
    const ready = await waitForRedisReady(redis);
    if (!ready) throw new Error('Redis did not become ready');

    /**
     * The adapter needs its own pair of connections: a subscriber cannot run other commands.
     *
     * Both options matter and both are overrides of what the shared client uses:
     *  - `enableOfflineQueue: true` — the adapter issues `psubscribe` inside its constructor, so
     *    a client that rejects commands while connecting takes the process down with an
     *    unhandled rejection. The rate limiter wants fail-fast; a subscriber wants to wait.
     *  - `maxRetriesPerRequest: null` — the documented setting for a subscriber connection,
     *    which is long-lived rather than request-shaped.
     *
     * They are connected BEFORE the adapter is built, so the constructor's subscribe runs on a
     * live socket rather than a hopeful one.
     */
    const pubClient = redis.duplicate({
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    const subClient = pubClient.duplicate();
    pubClient.on('error', (err: Error) => logger.warn({ err: err.message }, 'Realtime pub error'));
    subClient.on('error', (err: Error) => logger.warn({ err: err.message }, 'Realtime sub error'));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    server.adapter(createAdapter(pubClient, subClient));
    degraded = false;
    logger.info('Realtime adapter: redis (multi-instance fan-out)');
  } catch (err) {
    degraded = true;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Realtime degraded to in-memory adapter — events will not cross instances',
    );
  }
}

export async function closeRealtime(): Promise<void> {
  setRealtimeEmitter(null);
  if (!io) return;
  await io.close();
  io = null;
  online.clear();
}
