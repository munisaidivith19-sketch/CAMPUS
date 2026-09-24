/**
 * Chat schemas — REST bodies and queries, and every socket event payload.
 *
 * Socket payloads are validated exactly like HTTP bodies. A socket is not a trusted channel
 * just because the connection was authenticated: the handshake proves who is sending, never
 * what they are sending. `noInjection` below is the socket-side equivalent of the HTTP
 * sanitize middleware, since a socket frame never passes through Express.
 */
import { z } from 'zod';
import { UPLOAD } from '@campusconnect/config';
import { attachmentIdsSchema, objectIdSchema } from './common.js';

/** Bodies are plain text and bounded. The UI renders them as text; there is no markup contract. */
export const messageBodySchema = z.string().trim().min(1, 'Write a message').max(4000);

/**
 * The client's own id for a message, used to make sending idempotent: a retry after a dropped
 * ack must not post twice. Opaque to the server, so it is length-capped and charset-limited
 * rather than parsed.
 */
export const clientMessageIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientMessageId must be url-safe');

/**
 * Reject Mongo operators and dotted keys anywhere in a payload.
 *
 * HTTP requests are stripped by sanitize.middleware before Zod ever sees them; socket frames
 * are not, so this runs on every socket payload and on chat bodies for good measure.
 */
export function hasDangerousKeys(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasDangerousKeys(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => key.startsWith('$') || key.includes('.') || hasDangerousKeys(item, depth + 1),
  );
}

/**
 * Refuse a payload containing operator or dotted keys, checked on the RAW input.
 *
 * It has to be a preprocess rather than a refinement: Zod strips unknown keys while parsing, so
 * a refinement would inspect a payload from which `$where` had already been quietly removed and
 * happily pass it. Over HTTP the sanitize middleware strips these before Zod runs at all; over a
 * socket there is no middleware, and this is the only thing standing in the way.
 */
export const noInjection = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value, ctx) => {
    if (hasDangerousKeys(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Payload contains disallowed keys',
      });
      return z.NEVER;
    }
    return value;
  }, schema);

// --- REST ---------------------------------------------------------------------

/**
 * Creating a chat. DIRECT takes the other person; GROUP takes a name and an initial roster.
 * CLASS and CLUB chats are derived from the roster or the club and cannot be created here, so
 * the union simply has no member for them.
 */
export const createChatSchema = noInjection(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('DIRECT'),
      userId: objectIdSchema,
    }),
    z.object({
      type: z.literal('GROUP'),
      name: z.string().trim().min(1).max(80),
      memberIds: z.array(objectIdSchema).max(255).default([]),
    }),
  ]),
);
export type CreateChatInput = z.infer<typeof createChatSchema>;

export const chatIdParamSchema = z.object({ id: objectIdSchema });
export const chatMemberParamSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });

export const addChatMembersSchema = noInjection(
  z.object({ userIds: z.array(objectIdSchema).min(1).max(100) }),
);
export type AddChatMembersInput = z.infer<typeof addChatMembersSchema>;

/** Cursor pagination: `before` is a message id, never an offset. */
export const chatMessageQuerySchema = z.object({
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type ChatMessageQuery = z.infer<typeof chatMessageQuerySchema>;

/**
 * A message is text, attachments, or both — never neither. The body may be empty only when at
 * least one file rides along, so an attachment can be sent without a caption.
 */
const messageContentShape = {
  body: z.string().trim().max(4000).default(''),
  clientMessageId: clientMessageIdSchema,
  replyTo: objectIdSchema.optional(),
  attachmentFileIds: attachmentIdsSchema(UPLOAD.CHAT_MAX_ATTACHMENTS),
};

const requireContent = (
  value: { body: string; attachmentFileIds: string[] },
  ctx: z.RefinementCtx,
) => {
  if (value.body.length === 0 && value.attachmentFileIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: 'Write a message' });
  }
};

export const sendMessageSchema = noInjection(
  z.object(messageContentShape).superRefine(requireContent),
);
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = noInjection(z.object({ body: messageBodySchema }));
export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const messageParamSchema = z.object({ id: objectIdSchema, messageId: objectIdSchema });

export const markReadSchema = noInjection(z.object({ lastReadMessageId: objectIdSchema }));
export type MarkReadInput = z.infer<typeof markReadSchema>;

export const muteChatSchema = noInjection(z.object({ muted: z.boolean() }));
export type MuteChatInput = z.infer<typeof muteChatSchema>;

/**
 * The user picker behind "new chat".
 *
 * A search, never a directory dump: `q` is required and results are capped, so a student cannot
 * page through everyone in the institution.
 */
export const chatUserSearchSchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters').max(60),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export type ChatUserSearchQuery = z.infer<typeof chatUserSearchSchema>;

// --- Socket events -------------------------------------------------------------

export const socketChatIdSchema = noInjection(z.object({ chatId: objectIdSchema }));
export type SocketChatIdPayload = z.infer<typeof socketChatIdSchema>;

export const socketSendMessageSchema = noInjection(
  z.object({ chatId: objectIdSchema, ...messageContentShape }).superRefine(requireContent),
);
export type SocketSendMessagePayload = z.infer<typeof socketSendMessageSchema>;

export const socketReadSchema = noInjection(
  z.object({ chatId: objectIdSchema, lastReadMessageId: objectIdSchema }),
);
export type SocketReadPayload = z.infer<typeof socketReadSchema>;

export const socketTypingSchema = noInjection(
  z.object({ chatId: objectIdSchema, typing: z.boolean() }),
);
export type SocketTypingPayload = z.infer<typeof socketTypingSchema>;
