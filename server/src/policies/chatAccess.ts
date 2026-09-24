/**
 * Chat authorization, as pure rules.
 *
 * Nothing here touches the database. The service loads the facts (the caller's membership, the
 * chat, the message, the caller's academic scope) and asks these functions what is allowed, so
 * the rules can be tested exhaustively and cannot drift between REST and sockets — both call
 * the same functions on the same facts.
 *
 * Two principles run through all of it:
 *
 *  - **Membership is the grant.** A permission such as `chat:read` says you may use chat at
 *    all; the membership row says which conversation. Holding every permission in the catalog
 *    still shows you nothing you are not a member of.
 *  - **Absence is NOT_FOUND.** A chat you cannot reach is indistinguishable from one that does
 *    not exist. `FORBIDDEN` would confirm it exists, which is exactly the leak the platform's
 *    enumeration rules forbid elsewhere.
 */
import { ChatMemberRole, ChatType, Permission } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';

/** The membership facts a decision needs. `null` means "no active membership". */
export interface ChatMembershipFacts {
  role: ChatMemberRole;
  muted: boolean;
}

export interface ChatFacts {
  id: string;
  type: ChatType;
  /** The class or club this chat is derived from; null for DIRECT and GROUP. */
  sourceRef: string | null;
}

export interface MessageFacts {
  senderUserId: string | null;
  createdAt: Date;
  deleted: boolean;
}

/** What a moderator's scope covers, resolved by the caller from existing scope rules. */
export interface ModerationReach {
  /** Class ids whose chats this principal may moderate; null means institution-wide. */
  classIds: string[] | null;
  /** Club ids this principal administers. */
  clubIds: string[];
  /** Principal / system admin: every class AND club chat. Absent means false. */
  institutionWide?: boolean;
}

export const chatAccess = {
  /** May this principal use chat at all? */
  canUseChat(principal: Principal): boolean {
    return principal.permissions.includes(Permission.CHAT_READ);
  },

  /**
   * May this principal read this chat?
   *
   * Deliberately not "is an admin" or "is in the department" — an active membership, or nothing.
   */
  canRead(principal: Principal, membership: ChatMembershipFacts | null): boolean {
    return membership !== null && chatAccess.canUseChat(principal);
  },

  canSend(principal: Principal, membership: ChatMembershipFacts | null): boolean {
    return membership !== null && principal.permissions.includes(Permission.CHAT_MESSAGE_SEND);
  },

  canCreate(principal: Principal): boolean {
    return principal.permissions.includes(Permission.CHAT_CREATE);
  },

  /**
   * May this principal add or remove members?
   *
   * GROUP only: DIRECT has a fixed pair by definition, and CLASS/CLUB membership is derived
   * from the roster, so hand-editing it would be overwritten by the next sync — and would let
   * someone quietly add an outsider to a class conversation.
   */
  canManageMembers(
    principal: Principal,
    chat: ChatFacts,
    membership: ChatMembershipFacts | null,
  ): boolean {
    if (chat.type !== ChatType.GROUP) return false;
    if (!membership) return false;
    if (!principal.permissions.includes(Permission.CHAT_MANAGE)) return false;
    return membership.role === ChatMemberRole.OWNER || membership.role === ChatMemberRole.ADMIN;
  },

  /** Leaving is for groups. You cannot leave a DM, and a derived chat follows the roster. */
  canLeave(chat: ChatFacts, membership: ChatMembershipFacts | null): boolean {
    return chat.type === ChatType.GROUP && membership !== null;
  },

  /**
   * May this principal edit this message?
   *
   * Sender only, inside the window, and never a deleted one. Moderators cannot edit: putting
   * words in someone's mouth is a different power from removing them, and only the second is
   * granted anywhere in this system.
   */
  canEdit(principal: Principal, message: MessageFacts, now: Date, editWindowMs: number): boolean {
    if (message.deleted) return false;
    if (message.senderUserId !== principal.userId) return false;
    return now.getTime() - message.createdAt.getTime() <= editWindowMs;
  },

  /** The sender may always withdraw their own message, with no time limit. */
  canDeleteOwn(principal: Principal, message: MessageFacts): boolean {
    return !message.deleted && message.senderUserId === principal.userId;
  },

  /**
   * May this principal remove someone else's message?
   *
   * Requires the permission AND reach over the chat in question: a club admin moderates their
   * own club's chat, a mentor or HOD the class chats inside their scope. A DIRECT or GROUP chat
   * has no moderator — there is no scope that contains a private conversation, and inventing one
   * would make every group readable by whoever holds the permission.
   */
  canModerateDelete(principal: Principal, chat: ChatFacts, reach: ModerationReach): boolean {
    if (!principal.permissions.includes(Permission.CHAT_MODERATE)) return false;
    if (!chat.sourceRef) return false;

    if (chat.type === ChatType.CLUB) {
      return reach.institutionWide === true || reach.clubIds.includes(chat.sourceRef);
    }
    if (chat.type === ChatType.CLASS) {
      // null means institution-wide reach (principal); [] means an empty scope, which matches
      // nothing. Collapsing the two would turn a scoped moderator into a global one.
      return reach.classIds === null || reach.classIds.includes(chat.sourceRef);
    }
    return false;
  },

  /** A group's size cap, checked before adding rather than after. */
  canAdmitMembers(currentCount: number, adding: number, cap: number): boolean {
    return currentCount + adding <= cap;
  },
} as const;
