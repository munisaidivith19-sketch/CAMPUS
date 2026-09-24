/**
 * The single socket client.
 *
 * One connection for the whole app, created on demand and torn down on sign-out. It carries the
 * in-memory access token — never a cookie and never a query string, matching what the server's
 * handshake accepts — and because that token is refreshed silently by the axios interceptors,
 * the socket re-authenticates simply by reconnecting with whatever is current.
 *
 * Rooms are re-joined on every reconnect. The server forgets them when a connection drops, so a
 * client that assumed its rooms survived would go quiet after the first blip — the bug this
 * module exists to prevent.
 */
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './tokenStore.js';

/** The API base URL minus its `/api/v1` suffix: the socket lives at the server root. */
function socketOrigin(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';
  return base.replace(/\/api\/v\d+\/?$/, '');
}

let socket: Socket | null = null;
const joined = new Set<string>();

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(socketOrigin(), {
    // The token is read fresh on every (re)connect attempt, so a silent refresh in between is
    // picked up without anyone having to tell the socket about it.
    auth: (cb: (data: { token: string | null }) => void) => cb({ token: getAccessToken() }),
    transports: ['websocket'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });

  socket.on('connect', () => {
    for (const chatId of joined) socket?.emit('chat:join', { chatId });
  });

  return socket;
}

/** Join a chat room and remember it, so a reconnect restores it. */
export function joinChatRoom(chatId: string): void {
  joined.add(chatId);
  const active = getSocket();
  if (active.connected) active.emit('chat:join', { chatId });
}

export function leaveChatRoom(chatId: string): void {
  joined.delete(chatId);
  const active = socket;
  if (active?.connected) active.emit('chat:leave', { chatId });
}

/** Subscribe to a server event; returns the unsubscribe function for an effect cleanup. */
export function onSocketEvent<T>(event: string, handler: (payload: T) => void): () => void {
  const active = getSocket();
  active.on(event, handler as (...args: unknown[]) => void);
  return () => {
    active.off(event, handler as (...args: unknown[]) => void);
  };
}

/**
 * Send over the socket, resolving with the server's ack.
 *
 * Resolves `null` if there is no live connection or the server does not answer in time, which
 * is the caller's cue to fall back to the REST endpoint. Both paths carry the same
 * `clientMessageId`, so a message that quietly went through anyway is not duplicated.
 */
export function emitWithAck<T>(
  event: string,
  payload: unknown,
  timeoutMs = 4_000,
): Promise<T | null> {
  const active = getSocket();
  if (!active.connected) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    active.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/** Drop the connection and forget the rooms. Called on sign-out. */
export function closeSocket(): void {
  joined.clear();
  socket?.disconnect();
  socket = null;
}
