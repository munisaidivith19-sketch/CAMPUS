/**
 * Chat — one conversation.
 *
 * Membership lives in `ChatMembership` and messages in `ChatMessage` (DATABASE.md: memberships
 * are queried on their own, and messages are unbounded, so neither may be embedded here).
 *
 * `directKey` is what makes "open a DM with X" idempotent: the two user ids sorted and joined,
 * so both directions produce the same key and the unique index below settles a race between two
 * people opening the same conversation at the same moment. There is no application-level
 * check-then-create that could interleave.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { ChatType } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface ChatAttrs {
  institutionId: ObjectId;
  type: ChatType;
  /** Empty for DIRECT: the name shown is the other participant, resolved per caller. */
  name: string;
  createdByUserId?: ObjectId | null;
  /** The class or club a derived chat belongs to. Null for DIRECT and GROUP. */
  sourceRef?: ObjectId | null;
  /** `<sortedUserIdA>:<sortedUserIdB>` for DIRECT, null otherwise. */
  directKey?: string | null;
  /** Drives the chat list's ordering; null until the first message. */
  lastMessageAt?: Date | null;
}

const chatSchema = new Schema<ChatAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    type: { type: String, required: true, enum: Object.values(ChatType) },
    // NOT `required`: a DIRECT chat's name is legitimately empty (it is shown as the other
    // participant), and Mongoose treats an empty string as a missing required value.
    name: { type: String, required: false, default: '', trim: true, maxlength: 80 },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sourceRef: { type: Schema.Types.ObjectId, default: null },
    directKey: { type: String, default: null },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * One DM per pair, per tenant — and the uniqueness is enforced by the database, so two
 * simultaneous creates end with one chat and one duplicate-key error, not two chats.
 * Partial, because every non-DIRECT chat has a null `directKey` and they must not collide.
 */
chatSchema.index(
  { institutionId: 1, directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } },
);

/**
 * One chat per class and one per club. Same reasoning: the derived chat is created lazily on
 * first access, which two requests can attempt at once.
 */
chatSchema.index(
  { institutionId: 1, type: 1, sourceRef: 1 },
  { unique: true, partialFilterExpression: { sourceRef: { $type: 'objectId' } } },
);

/** The chat list is "my chats, most recent first"; the membership lookup leads, this sorts. */
chatSchema.index({ institutionId: 1, lastMessageAt: -1 });

export type ChatDocument = HydratedDocument<ChatAttrs & Timestamps>;
export const ChatModel = defineModel<ChatAttrs & Timestamps>('Chat', chatSchema);

/** Build the canonical DIRECT key for a pair of users. Order-independent by construction. */
export function directKeyFor(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(':');
}
