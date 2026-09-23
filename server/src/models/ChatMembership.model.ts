/**
 * ChatMembership — the link between a user and a chat, and the only thing that grants access.
 *
 * Access is "there is a row here with `leftAt: null`". Leaving keeps the row (so the history of
 * who was in a group survives) but revokes access the moment it is stamped. For CLASS and CLUB
 * chats these rows are derived from the roster or the club's approved members and re-synced, so
 * losing the underlying membership stamps `leftAt` and access ends with it.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ChatMemberRole } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface ChatMembershipAttrs {
  institutionId: ObjectId;
  chatId: ObjectId;
  userId: ObjectId;
  role: ChatMemberRole;
  /** The newest message this member has read. Drives the unread count; only moves forward. */
  lastReadMessageId?: ObjectId | null;
  muted: boolean;
  /** Null while the membership is active. Stamped on leave, removal or derived-access loss. */
  leftAt?: Date | null;
}

const membershipSchema = new Schema<ChatMembershipAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      required: true,
      enum: Object.values(ChatMemberRole),
      default: ChatMemberRole.MEMBER,
    },
    lastReadMessageId: { type: Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    muted: { type: Boolean, required: true, default: false },
    leftAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * One row per (tenant, user, chat) — rejoining a group reuses the row rather than stacking a
 * second one, which would make "am I a member?" ambiguous. Tenant-leading, and it also serves
 * the hottest query in chat: "does this caller have access to this chat?".
 */
membershipSchema.index({ institutionId: 1, userId: 1, chatId: 1 }, { unique: true });

/** The other direction: who is in this chat (member list, fan-out on a new message). */
membershipSchema.index({ institutionId: 1, chatId: 1 });

export type ChatMembershipDocument = HydratedDocument<ChatMembershipAttrs & Timestamps>;
export const ChatMembershipModel = defineModel<ChatMembershipAttrs & Timestamps>(
  'ChatMembership',
  membershipSchema,
);
