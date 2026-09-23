/**
 * Chat data access: chats, memberships and messages.
 *
 * Every method takes `institutionId` first and passes it through `TenantRepository.scoped`, so
 * a caller cannot widen the tenant even by trying. There is deliberately no "find chat by id"
 * that skips membership — the service asks for the caller's membership first, and a chat the
 * caller is not in is simply not found.
 */
import { Types, type FilterQuery } from 'mongoose';
import { ChatMemberRole, ChatMessageType, ChatType } from '@campusconnect/types';
import { ChatModel, directKeyFor, type ChatAttrs, type ChatDocument } from '../models/Chat.model.js';
import {
  ChatMembershipModel,
  type ChatMembershipAttrs,
  type ChatMembershipDocument,
} from '../models/ChatMembership.model.js';
import {
  ChatMessageModel,
  type ChatMessageAttrs,
  type ChatMessageDocument,
} from '../models/ChatMessage.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike } from './base.repository.js';

type ChatEntity = ChatAttrs & Timestamps;
type MembershipEntity = ChatMembershipAttrs & Timestamps;
type MessageEntity = ChatMessageAttrs & Timestamps;

/** True when a write failed because a unique index already holds an equivalent row. */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

class ChatRepository extends TenantRepository<ChatEntity> {
  constructor() {
    super(ChatModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<ChatDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async findManyByIds(institutionId: IdLike, ids: readonly IdLike[]): Promise<ChatDocument[]> {
    const objectIds = ids.map((id) => toObjectId(id)).filter((id): id is Types.ObjectId => id !== null);
    if (objectIds.length === 0) return [];
    return ChatModel.find(this.scoped(institutionId, { _id: { $in: objectIds } })).exec();
  }

  async createGroup(
    institutionId: IdLike,
    input: { name: string; createdByUserId: IdLike },
  ): Promise<ChatDocument> {
    return ChatModel.create({
      institutionId: requireObjectId(institutionId),
      type: ChatType.GROUP,
      name: input.name,
      createdByUserId: requireObjectId(input.createdByUserId),
    });
  }

  /**
   * Get the DM between two users, creating it if it does not exist.
   *
   * The race is handled by the unique index rather than by checking first: if two requests
   * create at once, one wins and the loser re-reads the winner's row. A check-then-create would
   * leave a window in which both checks miss.
   */
  async findOrCreateDirect(
    institutionId: IdLike,
    userIdA: string,
    userIdB: string,
  ): Promise<{ chat: ChatDocument; created: boolean }> {
    const key = directKeyFor(userIdA, userIdB);
    const existing = await this.findOneScoped(institutionId, { directKey: key } as FilterQuery<ChatEntity>);
    if (existing) return { chat: existing, created: false };

    try {
      const chat = await ChatModel.create({
        institutionId: requireObjectId(institutionId),
        type: ChatType.DIRECT,
        name: '',
        directKey: key,
        createdByUserId: requireObjectId(userIdA),
      });
      return { chat, created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const winner = await this.findOneScoped(
        institutionId,
        { directKey: key } as FilterQuery<ChatEntity>,
      );
      if (!winner) throw err;
      return { chat: winner, created: false };
    }
  }

  /** The same pattern for a derived CLASS/CLUB chat, which is also created lazily. */
  async findOrCreateDerived(
    institutionId: IdLike,
    type: typeof ChatType.CLASS | typeof ChatType.CLUB,
    sourceRef: IdLike,
    name: string,
  ): Promise<{ chat: ChatDocument; created: boolean }> {
    const ref = requireObjectId(sourceRef);
    const filter = { type, sourceRef: ref } as FilterQuery<ChatEntity>;
    const existing = await this.findOneScoped(institutionId, filter);
    if (existing) return { chat: existing, created: false };

    try {
      const chat = await ChatModel.create({
        institutionId: requireObjectId(institutionId),
        type,
        name,
        sourceRef: ref,
      });
      return { chat, created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const winner = await this.findOneScoped(institutionId, filter);
      if (!winner) throw err;
      return { chat: winner, created: false };
    }
  }

  /** The derived chat for a class or club, if it has been created yet. */
  async findOneDerived(
    institutionId: IdLike,
    type: typeof ChatType.CLASS | typeof ChatType.CLUB,
    sourceRef: IdLike,
  ): Promise<ChatDocument | null> {
    const ref = toObjectId(sourceRef);
    if (!ref) return null;
    return this.findOneScoped(institutionId, { type, sourceRef: ref } as FilterQuery<ChatEntity>);
  }

  async touchLastMessageAt(institutionId: IdLike, chatId: IdLike, at: Date): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(chatId) } as FilterQuery<ChatEntity>,
      { $set: { lastMessageAt: at } },
    );
  }

  async rename(institutionId: IdLike, chatId: IdLike, name: string): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(chatId) } as FilterQuery<ChatEntity>,
      { $set: { name } },
    );
  }
}

class ChatMembershipRepository extends TenantRepository<MembershipEntity> {
  constructor() {
    super(ChatMembershipModel);
  }

  /** The access check: an ACTIVE membership, or nothing. */
  async findActive(
    institutionId: IdLike,
    chatId: IdLike,
    userId: IdLike,
  ): Promise<ChatMembershipDocument | null> {
    const chat = toObjectId(chatId);
    const user = toObjectId(userId);
    if (!chat || !user) return null;
    return this.findOneScoped(institutionId, {
      chatId: chat,
      userId: user,
      leftAt: null,
    } as FilterQuery<MembershipEntity>);
  }

  /** Active memberships for one user, newest chat activity first (the chat list). */
  async listForUser(institutionId: IdLike, userId: IdLike): Promise<ChatMembershipDocument[]> {
    const user = toObjectId(userId);
    if (!user) return [];
    return ChatMembershipModel.find(
      this.scoped(institutionId, { userId: user, leftAt: null } as FilterQuery<MembershipEntity>),
    ).exec();
  }

  async listMembers(institutionId: IdLike, chatId: IdLike): Promise<ChatMembershipDocument[]> {
    const chat = toObjectId(chatId);
    if (!chat) return [];
    return ChatMembershipModel.find(
      this.scoped(institutionId, { chatId: chat, leftAt: null } as FilterQuery<MembershipEntity>),
    ).exec();
  }

  async countMembers(institutionId: IdLike, chatId: IdLike): Promise<number> {
    return this.countScoped(institutionId, {
      chatId: requireObjectId(chatId),
      leftAt: null,
    } as FilterQuery<MembershipEntity>);
  }

  /**
   * Add a member, or revive a membership that had left.
   *
   * An upsert rather than an insert: the unique index means a user who left and came back must
   * reuse their row, and reviving it also clears `leftAt` in the same write.
   */
  async upsertMember(
    institutionId: IdLike,
    chatId: IdLike,
    userId: IdLike,
    role: ChatMemberRole = ChatMemberRole.MEMBER,
  ): Promise<void> {
    await ChatMembershipModel.updateOne(
      this.scoped(institutionId, {
        chatId: requireObjectId(chatId),
        userId: requireObjectId(userId),
      } as FilterQuery<MembershipEntity>),
      {
        $set: { leftAt: null },
        $setOnInsert: {
          role,
          muted: false,
          lastReadMessageId: null,
        },
      },
      { upsert: true },
    ).exec();
  }

  async setRole(
    institutionId: IdLike,
    chatId: IdLike,
    userId: IdLike,
    role: ChatMemberRole,
  ): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      {
        chatId: requireObjectId(chatId),
        userId: requireObjectId(userId),
      } as FilterQuery<MembershipEntity>,
      { $set: { role } },
    );
  }

  /** Revoke access. The row stays so the history of who was in the chat survives. */
  async markLeft(institutionId: IdLike, chatId: IdLike, userId: IdLike): Promise<boolean> {
    const modified = await this.updateOneScoped(
      institutionId,
      {
        chatId: requireObjectId(chatId),
        userId: requireObjectId(userId),
        leftAt: null,
      } as FilterQuery<MembershipEntity>,
      { $set: { leftAt: new Date() } },
    );
    return modified > 0;
  }

  /** Revoke everyone in a derived chat who is no longer entitled to it. */
  async markLeftExcept(
    institutionId: IdLike,
    chatId: IdLike,
    keepUserIds: readonly string[],
  ): Promise<number> {
    const keep = keepUserIds
      .map((id) => toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);
    return this.updateManyScoped(
      institutionId,
      {
        chatId: requireObjectId(chatId),
        leftAt: null,
        userId: { $nin: keep },
      } as FilterQuery<MembershipEntity>,
      { $set: { leftAt: new Date() } },
    );
  }

  async setMuted(
    institutionId: IdLike,
    chatId: IdLike,
    userId: IdLike,
    muted: boolean,
  ): Promise<boolean> {
    const modified = await this.updateOneScoped(
      institutionId,
      {
        chatId: requireObjectId(chatId),
        userId: requireObjectId(userId),
        leftAt: null,
      } as FilterQuery<MembershipEntity>,
      { $set: { muted } },
    );
    return modified > 0;
  }

  /**
   * Move the read marker forward only.
   *
   * `$lt` in the filter is the guard: a stale client (or a malicious one) replaying an older id
   * cannot un-read messages, because the update simply does not match.
   */
  async advanceReadMarker(
    institutionId: IdLike,
    chatId: IdLike,
    userId: IdLike,
    lastReadMessageId: IdLike,
  ): Promise<boolean> {
    const marker = requireObjectId(lastReadMessageId);
    const modified = await this.updateOneScoped(
      institutionId,
      {
        chatId: requireObjectId(chatId),
        userId: requireObjectId(userId),
        leftAt: null,
        $or: [{ lastReadMessageId: null }, { lastReadMessageId: { $lt: marker } }],
      } as FilterQuery<MembershipEntity>,
      { $set: { lastReadMessageId: marker } },
    );
    return modified > 0;
  }
}

class ChatMessageRepository extends TenantRepository<MessageEntity> {
  constructor() {
    super(ChatMessageModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<ChatMessageDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  /**
   * Create a message, or return the one this sender already created with the same
   * `clientMessageId`. A retried send is not a new message.
   */
  async createIdempotent(
    institutionId: IdLike,
    input: {
      chatId: IdLike;
      senderUserId: IdLike;
      body: string;
      clientMessageId: string;
      replyTo?: string | null;
    },
  ): Promise<{ message: ChatMessageDocument; created: boolean }> {
    const scope = {
      institutionId: requireObjectId(institutionId),
      chatId: requireObjectId(input.chatId),
      senderUserId: requireObjectId(input.senderUserId),
      clientMessageId: input.clientMessageId,
    };

    try {
      const message = await ChatMessageModel.create({
        ...scope,
        body: input.body,
        type: ChatMessageType.TEXT,
        replyTo: input.replyTo ? requireObjectId(input.replyTo) : null,
      });
      return { message, created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const existing = await ChatMessageModel.findOne(scope).exec();
      if (!existing) throw err;
      return { message: existing, created: false };
    }
  }

  /** A membership-change notice. Written by the server, so it has no sender and no client id. */
  async createSystem(
    institutionId: IdLike,
    chatId: IdLike,
    body: string,
  ): Promise<ChatMessageDocument> {
    return ChatMessageModel.create({
      institutionId: requireObjectId(institutionId),
      chatId: requireObjectId(chatId),
      senderUserId: null,
      body,
      type: ChatMessageType.SYSTEM,
    });
  }

  /**
   * One page of history, newest first, ending just before `before`.
   *
   * Exactly `limit` items are requested plus one probe, so "is there more?" needs no count.
   */
  async page(
    institutionId: IdLike,
    chatId: IdLike,
    options: { before?: string; limit: number },
  ): Promise<{ items: ChatMessageDocument[]; hasMore: boolean }> {
    const filter: FilterQuery<MessageEntity> = { chatId: requireObjectId(chatId) };
    if (options.before) {
      const cursor = toObjectId(options.before);
      // An unparseable cursor is treated as "from the start", never as an error.
      if (cursor) filter._id = { $lt: cursor };
    }

    const items = await ChatMessageModel.find(this.scoped(institutionId, filter))
      .sort({ _id: -1 })
      .limit(options.limit + 1)
      .exec();

    const hasMore = items.length > options.limit;
    return { items: hasMore ? items.slice(0, options.limit) : items, hasMore };
  }

  /** How many messages in this chat the member has not read, excluding their own. */
  async countUnread(
    institutionId: IdLike,
    chatId: IdLike,
    userId: IdLike,
    lastReadMessageId: IdLike | null,
  ): Promise<number> {
    const filter: FilterQuery<MessageEntity> = {
      chatId: requireObjectId(chatId),
      senderUserId: { $ne: requireObjectId(userId) },
      deletedAt: null,
    };
    if (lastReadMessageId) filter._id = { $gt: requireObjectId(lastReadMessageId) };
    return this.countScoped(institutionId, filter);
  }

  async applyEdit(institutionId: IdLike, messageId: IdLike, body: string): Promise<boolean> {
    const modified = await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(messageId), deletedAt: null } as FilterQuery<MessageEntity>,
      { $set: { body, editedAt: new Date() } },
    );
    return modified > 0;
  }

  /**
   * Soft-delete, and blank the body in the same write.
   *
   * "Deleted" that still holds the text is not deleted; the row survives only to keep replies
   * coherent and to record who removed it.
   */
  async softDelete(
    institutionId: IdLike,
    messageId: IdLike,
    deletedByUserId: IdLike,
  ): Promise<boolean> {
    const modified = await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(messageId), deletedAt: null } as FilterQuery<MessageEntity>,
      {
        $set: {
          body: '',
          deletedAt: new Date(),
          deletedByUserId: requireObjectId(deletedByUserId),
        },
      },
    );
    return modified > 0;
  }

  /** Newest message per chat, for the chat list preview ordering. */
  async lastMessageAtFor(
    institutionId: IdLike,
    chatIds: readonly IdLike[],
  ): Promise<Map<string, Date>> {
    const ids = chatIds.map((id) => toObjectId(id)).filter((id): id is Types.ObjectId => id !== null);
    if (ids.length === 0) return new Map();

    const rows = await ChatMessageModel.aggregate<{ _id: Types.ObjectId; at: Date }>([
      { $match: this.scoped(institutionId, { chatId: { $in: ids } } as FilterQuery<MessageEntity>) },
      { $group: { _id: '$chatId', at: { $max: '$createdAt' } } },
    ]).exec();

    return new Map(rows.map((row) => [String(row._id), row.at]));
  }
}

export const chatRepository = new ChatRepository();
export const chatMembershipRepository = new ChatMembershipRepository();
export const chatMessageRepository = new ChatMessageRepository();
