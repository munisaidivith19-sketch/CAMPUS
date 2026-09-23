/**
 * Chat.
 *
 * **Not end-to-end encrypted** — see docs/security/SECURITY.md. Bodies are stored in plain text
 * so the institution can moderate them, and are kept out of logs, push payloads, emails and
 * audit entries.
 *
 * One rule shapes this whole file: **the only thing that grants access to a conversation is an
 * active membership row.** Permissions decide whether you may use chat at all; membership
 * decides which chat. `loadAccess` below is the single place that resolves both, and every
 * operation — REST or socket — starts there, so there is no second path with its own idea of
 * who may read what.
 *
 * `sendMessage` is likewise the single send path (03-backend-architecture.md): the REST fallback
 * and the socket event call the same function, so idempotency, rate limiting, fan-out and
 * notification behaviour cannot drift between the two.
 */
import {
  AuditAction,
  AuditResult,
  ChatMemberRole,
  ChatType,
  ClubMembershipStatus,
  NotificationType,
  Permission,
  Role,
  type ChatDTO,
  type ChatDetailDTO,
  type ChatMemberDTO,
  type ChatMessageDTO,
  type CursorPageDTO,
} from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import type {
  AddChatMembersInput,
  ChatMessageQuery,
  CreateChatInput,
  SendMessageInput,
} from '@campusconnect/validation';
import { config } from '../config/env.js';
import { MESSAGE_EDIT_WINDOW_MS } from '../models/ChatMessage.model.js';
import type { ChatDocument } from '../models/Chat.model.js';
import type { ChatMembershipDocument } from '../models/ChatMembership.model.js';
import type { ChatMessageDocument } from '../models/ChatMessage.model.js';
import {
  chatMembershipRepository,
  chatMessageRepository,
  chatRepository,
} from '../repositories/chat.repository.js';
import { classRepository } from '../repositories/academics.repository.js';
import { clubMembershipRepository, clubRepository } from '../repositories/club.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { chatAccess, type ChatFacts, type ModerationReach } from '../policies/chatAccess.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { realtime } from './realtimeBus.js';
import { resolveAcademicScope, resolveVisibleClassIds } from './scope.service.js';
import { UserStatus } from '@campusconnect/types';

/** A user's display name, resolved in bulk rather than per message. */
type NameMap = Map<string, string>;

async function namesFor(institutionId: string, userIds: readonly string[]): Promise<NameMap> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const names: NameMap = new Map();
  await Promise.all(
    unique.map(async (userId) => {
      const user = await userRepository.findById(institutionId, userId);
      if (user) names.set(userId, user.fullName);
    }),
  );
  return names;
}

// --- Access -------------------------------------------------------------------

interface ChatAccessContext {
  chat: ChatDocument;
  membership: ChatMembershipDocument;
  facts: ChatFacts;
}

function factsFor(chat: ChatDocument): ChatFacts {
  return {
    id: String(chat._id),
    type: chat.type,
    sourceRef: chat.sourceRef ? String(chat.sourceRef) : null,
  };
}

/**
 * Resolve the caller's access to one chat, or throw NOT_FOUND.
 *
 * Every read and write goes through here. A chat in another tenant, a chat the caller was never
 * in, a chat they left, and a chat id that does not exist all produce the same 404 — the caller
 * cannot tell them apart, which is the point.
 */
async function loadAccess(principal: Principal, chatId: string): Promise<ChatAccessContext> {
  if (!chatAccess.canUseChat(principal)) throw Errors.notFound();

  const { institutionId, userId } = principal;
  const chat = await chatRepository.findById(institutionId, chatId);
  if (!chat) throw Errors.notFound();

  // Derived chats re-check the underlying roster on access, so losing your place in a class or
  // club takes the conversation with it without waiting for a sync to run.
  if (chat.type === ChatType.CLASS || chat.type === ChatType.CLUB) {
    await syncDerivedMembership(institutionId, chat);
  }

  const membership = await chatMembershipRepository.findActive(institutionId, chatId, userId);
  if (!membership) throw Errors.notFound();

  return { chat, membership, facts: factsFor(chat) };
}

// --- Derived membership (CLASS / CLUB) ----------------------------------------

/** Who should currently be in a class chat: the roster plus the faculty who teach it. */
async function classChatRoster(institutionId: string, classId: string): Promise<string[]> {
  const klass = await classRepository.findById(institutionId, classId);
  if (!klass) return [];

  const students = await studentProfileRepository.listBySection(
    institutionId,
    klass.batch,
    klass.section,
  );
  const userIds = students.map((profile) => String(profile.userId));
  if (klass.facultyUserId) userIds.push(String(klass.facultyUserId));
  return [...new Set(userIds)];
}

/** Who should currently be in a club chat: approved members (admins are members too). */
async function clubChatRoster(institutionId: string, clubId: string): Promise<string[]> {
  const club = await clubRepository.findById(institutionId, clubId);
  if (!club) return [];

  // A club chat mirrors the club: one page big enough for any realistic club roster.
  const memberships = await clubMembershipRepository.listForClub(
    institutionId,
    clubId,
    { page: 1, limit: config.CHAT_GROUP_MAX_MEMBERS },
    ClubMembershipStatus.APPROVED,
  );
  const userIds = memberships.items.map((membership) => String(membership.userId));
  for (const adminId of club.adminUserIds ?? []) userIds.push(String(adminId));
  return [...new Set(userIds)];
}

/**
 * Make the chat's membership match its source.
 *
 * Runs on access and whenever the underlying roster changes. Additive and subtractive in one
 * pass: people who joined the club are admitted, people who left are stamped `leftAt` and lose
 * access on their very next request.
 */
export async function syncDerivedMembership(
  institutionId: string,
  chat: ChatDocument,
): Promise<void> {
  if (!chat.sourceRef) return;
  const sourceRef = String(chat.sourceRef);

  const roster =
    chat.type === ChatType.CLASS
      ? await classChatRoster(institutionId, sourceRef)
      : await clubChatRoster(institutionId, sourceRef);

  const chatId = String(chat._id);
  await chatMembershipRepository.markLeftExcept(institutionId, chatId, roster);
  for (const userId of roster) {
    await chatMembershipRepository.upsertMember(institutionId, chatId, userId);
  }
}

/** Re-sync the chat attached to a club, if one has been created. Safe when there is none. */
export async function syncClubChatMembership(institutionId: string, clubId: string): Promise<void> {
  try {
    const existing = await chatRepository.findOneDerived(institutionId, ChatType.CLUB, clubId);
    if (existing) await syncDerivedMembership(institutionId, existing);
  } catch (err) {
    // Membership bookkeeping must never fail the club action that triggered it.
    logger.error({ err, clubId }, 'Could not sync club chat membership');
  }
}

/** The same for a class roster change. */
export async function syncClassChatMembership(
  institutionId: string,
  classId: string,
): Promise<void> {
  try {
    const existing = await chatRepository.findOneDerived(institutionId, ChatType.CLASS, classId);
    if (existing) await syncDerivedMembership(institutionId, existing);
  } catch (err) {
    logger.error({ err, classId }, 'Could not sync class chat membership');
  }
}

// --- DTOs ---------------------------------------------------------------------

function toMessageDTO(message: ChatMessageDocument, names: NameMap): ChatMessageDTO {
  const senderId = message.senderUserId ? String(message.senderUserId) : null;
  const deleted = message.deletedAt !== null && message.deletedAt !== undefined;

  return {
    id: String(message._id),
    chatId: String(message.chatId),
    sender: senderId ? { userId: senderId, fullName: names.get(senderId) ?? 'Unknown' } : null,
    // A deleted message returns no body to ANYONE, including the sender and a moderator.
    body: deleted ? null : message.body,
    type: message.type,
    replyTo: message.replyTo ? String(message.replyTo) : null,
    clientMessageId: message.clientMessageId ?? null,
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    deleted,
    createdAt: message.createdAt.toISOString(),
  };
}

/** A DIRECT chat has no stored name: it is shown as the other participant. */
async function displayName(
  institutionId: string,
  callerUserId: string,
  chat: ChatDocument,
  members: ChatMembershipDocument[],
): Promise<string> {
  if (chat.type !== ChatType.DIRECT) return chat.name;

  const other = members.find((member) => String(member.userId) !== callerUserId);
  if (!other) return 'Direct message';
  const user = await userRepository.findById(institutionId, String(other.userId));
  return user?.fullName ?? 'Direct message';
}

async function toChatDTO(
  institutionId: string,
  callerUserId: string,
  chat: ChatDocument,
  membership: ChatMembershipDocument,
): Promise<ChatDTO> {
  const members = await chatMembershipRepository.listMembers(institutionId, String(chat._id));

  return {
    id: String(chat._id),
    type: chat.type,
    name: await displayName(institutionId, callerUserId, chat, members),
    sourceRef: chat.sourceRef ? String(chat.sourceRef) : null,
    lastMessageAt: chat.lastMessageAt ? chat.lastMessageAt.toISOString() : null,
    myRole: membership.role,
    muted: membership.muted,
    unreadCount: await chatMessageRepository.countUnread(
      institutionId,
      String(chat._id),
      callerUserId,
      membership.lastReadMessageId ? String(membership.lastReadMessageId) : null,
    ),
    memberCount: members.length,
  };
}

// --- Reads --------------------------------------------------------------------

/** The caller's chats, most recently active first. Only ever their own memberships. */
export async function listChats(principal: Principal): Promise<ChatDTO[]> {
  if (!chatAccess.canUseChat(principal)) throw Errors.notFound();
  const { institutionId, userId } = principal;

  // Make sure the class and club chats this caller is entitled to exist before listing.
  await ensureDerivedChatsForUser(principal);

  const memberships = await chatMembershipRepository.listForUser(institutionId, userId);
  const chats = await chatRepository.findManyByIds(
    institutionId,
    memberships.map((membership) => String(membership.chatId)),
  );
  const byId = new Map(chats.map((chat) => [String(chat._id), chat]));

  const dtos: ChatDTO[] = [];
  for (const membership of memberships) {
    const chat = byId.get(String(membership.chatId));
    if (chat) dtos.push(await toChatDTO(institutionId, userId, chat, membership));
  }

  return dtos.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

export async function getChat(principal: Principal, chatId: string): Promise<ChatDetailDTO> {
  const { chat, membership } = await loadAccess(principal, chatId);
  const { institutionId, userId } = principal;

  const members = await chatMembershipRepository.listMembers(institutionId, chatId);
  const names = await namesFor(
    institutionId,
    members.map((member) => String(member.userId)),
  );

  const memberDTOs: ChatMemberDTO[] = members.map((member) => ({
    userId: String(member.userId),
    fullName: names.get(String(member.userId)) ?? 'Unknown',
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
  }));

  return {
    ...(await toChatDTO(institutionId, userId, chat, membership)),
    members: memberDTOs,
  };
}

export async function listMessages(
  principal: Principal,
  chatId: string,
  query: ChatMessageQuery,
): Promise<CursorPageDTO<ChatMessageDTO>> {
  await loadAccess(principal, chatId);
  const { institutionId } = principal;

  const { items, hasMore } = await chatMessageRepository.page(institutionId, chatId, {
    before: query.before,
    limit: query.limit,
  });

  const names = await namesFor(
    institutionId,
    items.map((message) => (message.senderUserId ? String(message.senderUserId) : '')),
  );

  return {
    items: items.map((message) => toMessageDTO(message, names)),
    // The cursor is the oldest id on this page: the next page is everything before it.
    nextCursor: hasMore && items.length > 0 ? String(items[items.length - 1]?._id) : null,
    hasMore,
  };
}

// --- Creating chats -----------------------------------------------------------

/** Both users must be in the caller's institution and be active accounts. */
async function assertChattableUser(institutionId: string, userId: string): Promise<void> {
  const user = await userRepository.findById(institutionId, userId);
  // A user from another tenant resolves to nothing here — same 404 as a nonexistent one.
  if (!user || user.status !== UserStatus.ACTIVE) throw Errors.notFound();
}

export async function createChat(
  principal: Principal,
  input: CreateChatInput,
): Promise<ChatDetailDTO> {
  if (!chatAccess.canCreate(principal)) throw Errors.forbidden();
  const { institutionId, userId } = principal;

  if (input.type === ChatType.DIRECT) {
    if (input.userId === userId) throw Errors.validation({ userId: 'You cannot message yourself' });
    await assertChattableUser(institutionId, input.userId);

    const { chat } = await chatRepository.findOrCreateDirect(institutionId, userId, input.userId);

    // Both memberships are upserted every time, not only on create. When two people open the
    // same DM at once the loser of the create race still has to guarantee its own membership
    // exists — waiting for the winner to write it is a window in which the chat 404s.
    await chatMembershipRepository.upsertMember(institutionId, String(chat._id), userId);
    await chatMembershipRepository.upsertMember(institutionId, String(chat._id), input.userId);

    return getChat(principal, String(chat._id));
  }

  // GROUP: the creator owns it, and every invitee must be a real, active, same-tenant user.
  const memberIds = [...new Set(input.memberIds.filter((id) => id !== userId))];
  if (!chatAccess.canAdmitMembers(1, memberIds.length, config.CHAT_GROUP_MAX_MEMBERS)) {
    throw Errors.validation({ memberIds: `A group may hold ${config.CHAT_GROUP_MAX_MEMBERS} members` });
  }
  for (const memberId of memberIds) await assertChattableUser(institutionId, memberId);

  const chat = await chatRepository.createGroup(institutionId, {
    name: input.name,
    createdByUserId: userId,
  });
  const chatId = String(chat._id);

  await chatMembershipRepository.upsertMember(institutionId, chatId, userId, ChatMemberRole.OWNER);
  for (const memberId of memberIds) {
    await chatMembershipRepository.upsertMember(institutionId, chatId, memberId);
  }

  return getChat(principal, chatId);
}

/**
 * Create the CLASS and CLUB chats this caller belongs to, if they do not exist yet.
 *
 * Lazy on purpose: a chat is made the first time someone looks, rather than eagerly for every
 * class in the institution, most of which nobody will ever open.
 */
async function ensureDerivedChatsForUser(principal: Principal): Promise<void> {
  const { institutionId, userId, roles } = principal;

  try {
    // Classes: the caller's own section (students) or the classes they teach (faculty).
    const classes = roles.includes(Role.STUDENT)
      ? await classesForStudent(institutionId, userId)
      : await classRepository.listTaughtBy(institutionId, userId);

    for (const klass of classes) {
      const { chat } = await chatRepository.findOrCreateDerived(
        institutionId,
        ChatType.CLASS,
        String(klass._id),
        `${klass.batch} ${klass.section}`,
      );
      await syncDerivedMembership(institutionId, chat);
    }

    // Clubs the caller is an approved member of.
    const clubMemberships = await clubMembershipRepository.listForUser(institutionId, userId, [
      ClubMembershipStatus.APPROVED,
    ]);
    for (const membership of clubMemberships) {
      const club = await clubRepository.findById(institutionId, String(membership.clubId));
      if (!club) continue;
      const { chat } = await chatRepository.findOrCreateDerived(
        institutionId,
        ChatType.CLUB,
        String(club._id),
        club.name,
      );
      await syncDerivedMembership(institutionId, chat);
    }
  } catch (err) {
    // A failure here must not break the chat list; the caller simply sees fewer derived chats.
    logger.error({ err }, 'Could not materialise derived chats');
  }
}

async function classesForStudent(institutionId: string, userId: string) {
  const profile = await studentProfileRepository.findByUserId(institutionId, userId);
  if (!profile?.batch || !profile.section) return [];
  return classRepository.listInSections(institutionId, [
    { batch: profile.batch, section: profile.section },
  ]);
}

// --- Group membership ---------------------------------------------------------

export async function addMembers(
  principal: Principal,
  chatId: string,
  input: AddChatMembersInput,
): Promise<ChatDetailDTO> {
  const { chat, membership, facts } = await loadAccess(principal, chatId);
  if (!chatAccess.canManageMembers(principal, facts, membership)) throw Errors.forbidden();
  const { institutionId } = principal;

  const current = await chatMembershipRepository.countMembers(institutionId, chatId);
  const toAdd = [...new Set(input.userIds)];
  if (!chatAccess.canAdmitMembers(current, toAdd.length, config.CHAT_GROUP_MAX_MEMBERS)) {
    throw Errors.validation({ userIds: `A group may hold ${config.CHAT_GROUP_MAX_MEMBERS} members` });
  }

  const names = await namesFor(institutionId, toAdd);
  for (const memberId of toAdd) {
    await assertChattableUser(institutionId, memberId);
    await chatMembershipRepository.upsertMember(institutionId, chatId, memberId);
    await announceSystemMessage(institutionId, chat, `${names.get(memberId) ?? 'Someone'} joined`);
  }

  return getChat(principal, chatId);
}

export async function removeMember(
  principal: Principal,
  chatId: string,
  targetUserId: string,
): Promise<{ status: 'REMOVED' }> {
  const { chat, membership, facts } = await loadAccess(principal, chatId);
  if (!chatAccess.canManageMembers(principal, facts, membership)) throw Errors.forbidden();
  const { institutionId } = principal;

  // The owner cannot be removed by an admin — that would be a takeover, not moderation.
  const target = await chatMembershipRepository.findActive(institutionId, chatId, targetUserId);
  if (!target) throw Errors.notFound();
  if (target.role === ChatMemberRole.OWNER) throw Errors.forbidden();

  await chatMembershipRepository.markLeft(institutionId, chatId, targetUserId);
  const names = await namesFor(institutionId, [targetUserId]);
  await announceSystemMessage(institutionId, chat, `${names.get(targetUserId) ?? 'Someone'} was removed`);

  // Their live sockets must stop receiving this chat immediately, not at next reconnect.
  realtime.toUser(institutionId, targetUserId, 'chat:removed', { chatId });
  return { status: 'REMOVED' };
}

export async function leaveChat(
  principal: Principal,
  chatId: string,
): Promise<{ status: 'LEFT' }> {
  const { chat, membership, facts } = await loadAccess(principal, chatId);
  if (!chatAccess.canLeave(facts, membership)) throw Errors.forbidden();
  const { institutionId, userId } = principal;

  await chatMembershipRepository.markLeft(institutionId, chatId, userId);
  const names = await namesFor(institutionId, [userId]);
  await announceSystemMessage(institutionId, chat, `${names.get(userId) ?? 'Someone'} left`);
  return { status: 'LEFT' };
}

async function announceSystemMessage(
  institutionId: string,
  chat: ChatDocument,
  body: string,
): Promise<void> {
  const message = await chatMessageRepository.createSystem(institutionId, String(chat._id), body);
  realtime.toChat(institutionId, String(chat._id), 'message:new', toMessageDTO(message, new Map()));
}

// --- Sending ------------------------------------------------------------------

/**
 * The one send path. REST and socket both land here.
 *
 * Order matters: access first, then the durable write, then fan-out. Realtime and notifications
 * are consequences of a message that already exists — never prerequisites for it.
 */
export async function sendMessage(
  principal: Principal,
  chatId: string,
  input: SendMessageInput | { body: string; clientMessageId: string; replyTo?: string },
): Promise<ChatMessageDTO> {
  const { chat, membership } = await loadAccess(principal, chatId);
  if (!chatAccess.canSend(principal, membership)) throw Errors.forbidden();
  const { institutionId, userId } = principal;

  // A reply must point at a message in THIS chat, so a reply cannot be used to probe for ids.
  if (input.replyTo) {
    const parent = await chatMessageRepository.findById(institutionId, input.replyTo);
    if (!parent || String(parent.chatId) !== chatId) throw Errors.notFound();
  }

  const { message, created } = await chatMessageRepository.createIdempotent(institutionId, {
    chatId,
    senderUserId: userId,
    body: input.body,
    clientMessageId: input.clientMessageId,
    replyTo: input.replyTo ?? null,
  });

  const names = await namesFor(institutionId, [userId]);
  const dto = toMessageDTO(message, names);

  // A duplicate send is acknowledged with the original message and nothing else happens: no
  // second broadcast, no second notification.
  if (!created) return dto;

  await chatRepository.touchLastMessageAt(institutionId, chatId, message.createdAt);
  realtime.toChat(institutionId, chatId, 'message:new', dto);
  await notifyAbsentMembers(institutionId, chat, userId, dto.id);

  return dto;
}

// --- Offline notification ------------------------------------------------------

/**
 * Per-chat debounce for offline notifications.
 *
 * Thirty messages in a minute is one conversation, not thirty things to be told about. The
 * window is per (chat, recipient) so a busy group cannot drown out a DM from someone else.
 */
const lastNotifiedAt = new Map<string, number>();

function debounceKey(chatId: string, userId: string): string {
  return `${chatId}:${userId}`;
}

/** Test-only: forget the debounce state between cases. */
export function resetChatNotificationDebounce(): void {
  lastNotifiedAt.clear();
}

/**
 * Tell members who are not watching that something was said — without saying what.
 *
 * The notification carries the chat's name and nothing else. Bodies never leave the app: not in
 * push, not in email, not in the notification row (SECURITY.md).
 */
async function notifyAbsentMembers(
  institutionId: string,
  chat: ChatDocument,
  senderUserId: string,
  messageId: string,
): Promise<void> {
  try {
    const chatId = String(chat._id);
    const members = await chatMembershipRepository.listMembers(institutionId, chatId);
    const now = Date.now();
    const recipients: string[] = [];

    for (const member of members) {
      const memberId = String(member.userId);
      if (memberId === senderUserId || member.muted) continue;

      const key = debounceKey(chatId, memberId);
      const previous = lastNotifiedAt.get(key) ?? 0;
      if (now - previous < config.CHAT_NOTIFY_DEBOUNCE_MS) continue;

      lastNotifiedAt.set(key, now);
      recipients.push(memberId);
    }

    if (recipients.length === 0) return;

    const senderNames = await namesFor(institutionId, [senderUserId]);
    const chatName =
      chat.type === ChatType.DIRECT
        ? (senderNames.get(senderUserId) ?? 'Someone')
        : chat.name;

    await notifyUsers(institutionId, recipients, {
      type: NotificationType.CHAT,
      title: `New message in ${chatName}`,
      // Deliberately not the message: this text reaches email and push.
      body: 'Open CampusConnect to read it.',
      link: `/chat/${chatId}`,
    });
    logger.debug({ chatId, messageId, recipients: recipients.length }, 'Chat notification fanned out');
  } catch (err) {
    // The message is already saved and broadcast; failing to notify must not undo that.
    logger.error({ err, chatId: String(chat._id) }, 'Could not notify absent chat members');
  }
}

// --- Editing, deleting, reading, muting ----------------------------------------

export async function editMessage(
  principal: Principal,
  chatId: string,
  messageId: string,
  body: string,
): Promise<ChatMessageDTO> {
  await loadAccess(principal, chatId);
  const { institutionId, userId } = principal;

  const message = await chatMessageRepository.findById(institutionId, messageId);
  if (!message || String(message.chatId) !== chatId) throw Errors.notFound();

  const facts = {
    senderUserId: message.senderUserId ? String(message.senderUserId) : null,
    createdAt: message.createdAt,
    deleted: message.deletedAt !== null && message.deletedAt !== undefined,
  };
  if (!chatAccess.canEdit(principal, facts, new Date(), MESSAGE_EDIT_WINDOW_MS)) {
    throw Errors.forbidden();
  }

  await chatMessageRepository.applyEdit(institutionId, messageId, body);
  const updated = await chatMessageRepository.findById(institutionId, messageId);
  if (!updated) throw Errors.notFound();

  const dto = toMessageDTO(updated, await namesFor(institutionId, [userId]));
  realtime.toChat(institutionId, chatId, 'message:updated', dto);
  return dto;
}

/**
 * Delete a message: the sender withdrawing it, or a moderator removing it.
 *
 * A moderator delete is audited — with the message id and the chat, never the body.
 */
export async function deleteMessage(
  principal: Principal,
  chatId: string,
  messageId: string,
  context: AuditContext,
): Promise<{ status: 'DELETED' }> {
  const { facts } = await loadAccess(principal, chatId);
  const { institutionId, userId } = principal;

  const message = await chatMessageRepository.findById(institutionId, messageId);
  if (!message || String(message.chatId) !== chatId) throw Errors.notFound();

  const messageFacts = {
    senderUserId: message.senderUserId ? String(message.senderUserId) : null,
    createdAt: message.createdAt,
    deleted: message.deletedAt !== null && message.deletedAt !== undefined,
  };

  const own = chatAccess.canDeleteOwn(principal, messageFacts);
  const asModerator =
    !own && chatAccess.canModerateDelete(principal, facts, await moderationReach(principal));
  if (!own && !asModerator) throw Errors.forbidden();

  await chatMessageRepository.softDelete(institutionId, messageId, userId);

  if (asModerator) {
    await recordAudit({
      institutionId,
      actorUserId: userId,
      action: AuditAction.CONTENT_REMOVED,
      resourceType: 'CHAT_MESSAGE',
      resourceId: messageId,
      result: AuditResult.SUCCESS,
      context,
      // No body, ever — an audit entry is read by more people than the chat was.
      reason: `Moderator removed a message in chat ${chatId}`,
    });
  }

  realtime.toChat(institutionId, chatId, 'message:deleted', { chatId, messageId });
  return { status: 'DELETED' };
}

/** What a moderator's `chat:moderate` actually reaches, from the existing academic scope. */
async function moderationReach(principal: Principal): Promise<ModerationReach> {
  if (!principal.permissions.includes(Permission.CHAT_MODERATE)) {
    return { classIds: [], clubIds: [] };
  }

  const scope = await resolveAcademicScope(principal);
  const classIds = await resolveVisibleClassIds(principal.institutionId, scope);

  const clubs = await clubRepository.listAdministeredBy(principal.institutionId, principal.userId);
  return { classIds, clubIds: clubs.map((club) => String(club._id)) };
}

export async function markRead(
  principal: Principal,
  chatId: string,
  lastReadMessageId: string,
): Promise<{ status: 'READ'; lastReadMessageId: string }> {
  await loadAccess(principal, chatId);
  const { institutionId, userId } = principal;

  const message = await chatMessageRepository.findById(institutionId, lastReadMessageId);
  if (!message || String(message.chatId) !== chatId) throw Errors.notFound();

  await chatMembershipRepository.advanceReadMarker(institutionId, chatId, userId, lastReadMessageId);

  // Read receipts are chat-wide: the other members see how far this member has read.
  realtime.toChat(institutionId, chatId, 'message:read', { chatId, userId, lastReadMessageId });
  return { status: 'READ', lastReadMessageId };
}

export async function setMuted(
  principal: Principal,
  chatId: string,
  muted: boolean,
): Promise<{ status: 'MUTED' | 'UNMUTED' }> {
  await loadAccess(principal, chatId);
  await chatMembershipRepository.setMuted(principal.institutionId, chatId, principal.userId, muted);
  return { status: muted ? 'MUTED' : 'UNMUTED' };
}

/**
 * The user picker behind "new chat".
 *
 * A search with a minimum query length and a hard cap, not a directory listing: a student may
 * find someone they know the name of, but cannot page through the institution.
 */
export async function searchChatUsers(
  principal: Principal,
  query: { q: string; limit: number },
): Promise<Array<{ userId: string; fullName: string }>> {
  if (!chatAccess.canCreate(principal)) throw Errors.forbidden();

  const users = await userRepository.searchActiveByName(
    principal.institutionId,
    query.q,
    query.limit,
  );
  return users
    .filter((user) => String(user._id) !== principal.userId)
    .map((user) => ({ userId: String(user._id), fullName: user.fullName }));
}

/** Membership check used by the socket layer before joining a room. */
export async function assertCanJoinChatRoom(principal: Principal, chatId: string): Promise<void> {
  await loadAccess(principal, chatId);
}

/** Chat ids the caller is in — used to decide who may see their presence. */
export async function chatPeers(principal: Principal): Promise<string[]> {
  const memberships = await chatMembershipRepository.listForUser(
    principal.institutionId,
    principal.userId,
  );
  return memberships.map((membership) => String(membership.chatId));
}

/** Does this message exist and is it reportable by this caller? Used by the report path. */
export async function assertReportableMessage(
  principal: Principal,
  messageId: string,
): Promise<void> {
  const message = await chatMessageRepository.findById(principal.institutionId, messageId);
  if (!message) throw Errors.notFound();
  // You may only report a message in a chat you can actually see.
  await loadAccess(principal, String(message.chatId));
}

export const __testing = { toMessageDTO };
