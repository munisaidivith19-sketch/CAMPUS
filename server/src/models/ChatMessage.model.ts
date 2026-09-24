/**
 * ChatMessage — one message.
 *
 * **Not end-to-end encrypted.** The body is stored as plain text so it can be moderated and
 * searched by its own chat's members; it must never appear in logs, push payloads, emails or
 * audit entries (SECURITY.md).
 *
 * Deletion is soft, but the body is *removed*, not hidden: a deleted message keeps its place in
 * the thread (so replies still make sense) and keeps who deleted it for moderation, while the
 * text itself is gone from the document.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ChatMessageType } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

/** How long a sender may edit their own message. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60_000;

export interface ChatMessageAttrs {
  institutionId: ObjectId;
  chatId: ObjectId;
  /** Null for SYSTEM messages, which the server writes itself. */
  senderUserId?: ObjectId | null;
  /** May be empty when the message carries attachments only. */
  body: string;
  /**
   * Files attached at send time (Part C-3), in the order they were sent. Access to them is
   * inherited from this message through `File.linkedResource`; this list is only the order.
   */
  attachmentFileIds: ObjectId[];
  replyTo?: ObjectId | null;
  type: ChatMessageType;
  /** The sender's own id for this message, for idempotent sends. Null for SYSTEM. */
  clientMessageId?: string | null;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  deletedByUserId?: ObjectId | null;
}

const messageSchema = new Schema<ChatMessageAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
    senderUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    body: { type: String, default: '', maxlength: 4000 },
    attachmentFileIds: { type: [Schema.Types.ObjectId], ref: 'File', default: [] },
    replyTo: { type: Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    type: {
      type: String,
      required: true,
      enum: Object.values(ChatMessageType),
      default: ChatMessageType.TEXT,
    },
    clientMessageId: { type: String, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

/**
 * Cursor pagination. `_id` descending is the sort AND the cursor: ObjectIds are monotonic per
 * process, so "older than this id" is a range scan on the same index the sort uses. An offset
 * would drift every time someone sends a message mid-scroll, which in a chat is constantly.
 */
messageSchema.index({ institutionId: 1, chatId: 1, _id: -1 });

/**
 * Idempotent send: the same `clientMessageId` from the same sender can only ever produce one
 * message, so a retry after a dropped ack is a duplicate-key error rather than a second
 * message. Partial because SYSTEM messages have no client id and must not collide on null.
 */
messageSchema.index(
  { institutionId: 1, chatId: 1, senderUserId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);

export type ChatMessageDocument = HydratedDocument<ChatMessageAttrs & Timestamps>;
export const ChatMessageModel = defineModel<ChatMessageAttrs & Timestamps>(
  'ChatMessage',
  messageSchema,
);
