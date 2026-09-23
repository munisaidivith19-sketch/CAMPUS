/**
 * Chat contracts (Phase 3 Part C-2).
 *
 * **This is not end-to-end encrypted.** Messages are stored server-side in plain text so the
 * institution can moderate them, and "secure" here means TLS in transit, strict authorization,
 * tenant isolation and bodies kept out of logs, push and audit entries. E2EE is future work and
 * nothing in this file should be labelled otherwise (docs/security/SECURITY.md).
 */

/**
 * What kind of conversation this is — and, more importantly, who decides its membership.
 *
 * DIRECT and GROUP memberships are managed by people. CLASS and CLUB memberships are DERIVED
 * from the roster or the club's approved members, so losing the underlying membership takes the
 * chat with it.
 */
export const ChatType = {
  DIRECT: 'DIRECT',
  GROUP: 'GROUP',
  CLASS: 'CLASS',
  CLUB: 'CLUB',
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

/** A member's standing *within one chat*, independent of their platform role. */
export const ChatMemberRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;
export type ChatMemberRole = (typeof ChatMemberRole)[keyof typeof ChatMemberRole];

export const ChatMessageType = {
  TEXT: 'TEXT',
  /** Membership changes and the like: written by the server, never by a client. */
  SYSTEM: 'SYSTEM',
} as const;
export type ChatMessageType = (typeof ChatMessageType)[keyof typeof ChatMessageType];

export interface ChatMemberDTO {
  userId: string;
  fullName: string;
  role: ChatMemberRole;
  joinedAt: string;
}

export interface ChatDTO {
  id: string;
  type: ChatType;
  /** For DIRECT chats this is the other person's name, resolved per caller. */
  name: string;
  /** The class or club a derived chat belongs to; null for DIRECT and GROUP. */
  sourceRef: string | null;
  lastMessageAt: string | null;
  /** The caller's own standing and state. Never another member's. */
  myRole: ChatMemberRole;
  muted: boolean;
  unreadCount: number;
  memberCount: number;
}

export interface ChatDetailDTO extends ChatDTO {
  members: ChatMemberDTO[];
}

export interface ChatMessageDTO {
  id: string;
  chatId: string;
  sender: { userId: string; fullName: string } | null;
  /** Null when the message was deleted — the body is removed, not merely hidden. */
  body: string | null;
  type: ChatMessageType;
  replyTo: string | null;
  /** Echoed back so an optimistic client can reconcile its own pending message. */
  clientMessageId: string | null;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
}

/**
 * Cursor page. Messages page by id rather than by offset: an offset shifts under you every time
 * someone sends a message, which is exactly the situation a chat is always in.
 */
export interface CursorPageDTO<T> {
  items: T[];
  /** Pass as `before` to fetch the next (older) page. Null when the start is reached. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ChatPresenceDTO {
  userId: string;
  online: boolean;
  /** Only ever sent to people who share a chat with this user. */
  lastSeenAt: string | null;
}
