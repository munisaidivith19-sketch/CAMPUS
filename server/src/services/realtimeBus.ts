/**
 * The seam between services and the realtime layer.
 *
 * Services announce what happened; they do not know whether anyone is listening. The socket
 * layer registers an emitter at startup, and until it does (tests, a worker process, a build
 * with realtime off) every call here is a no-op.
 *
 * This exists for two reasons beyond tidiness:
 *  - **No import cycle.** The socket layer calls chat.service; chat.service must not call back
 *    into the socket layer.
 *  - **Realtime is never load-bearing.** An emit failure cannot fail the write that triggered
 *    it, so every call is wrapped. A message that was saved but not broadcast is a refresh away
 *    from being seen; a message that failed to save is gone.
 */
import { logger } from '../utils/logger.js';

export interface RealtimeEmitter {
  toChat(institutionId: string, chatId: string, event: string, payload: unknown): void;
  toUser(institutionId: string, userId: string, event: string, payload: unknown): void;
  /** Force every live socket for this user to disconnect (logout, revoke, role change). */
  disconnectUser(institutionId: string, userId: string, reason: string): void;
}

let emitter: RealtimeEmitter | null = null;

export function setRealtimeEmitter(next: RealtimeEmitter | null): void {
  emitter = next;
}

export function hasRealtimeEmitter(): boolean {
  return emitter !== null;
}

function safely(action: () => void, what: string): void {
  if (!emitter) return;
  try {
    action();
  } catch (err) {
    // Never propagate: the database write that triggered this has already happened.
    logger.error({ err, what }, 'Realtime emit failed');
  }
}

export const realtime = {
  toChat(institutionId: string, chatId: string, event: string, payload: unknown): void {
    safely(() => emitter?.toChat(institutionId, chatId, event, payload), event);
  },
  toUser(institutionId: string, userId: string, event: string, payload: unknown): void {
    safely(() => emitter?.toUser(institutionId, userId, event, payload), event);
  },
  disconnectUser(institutionId: string, userId: string, reason: string): void {
    safely(() => emitter?.disconnectUser(institutionId, userId, reason), 'disconnect');
  },
} as const;
