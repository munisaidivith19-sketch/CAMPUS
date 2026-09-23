/**
 * Chat routes.
 *
 * Every route runs the full pipeline: authenticate → resolveTenant → authorize → validate →
 * controller. The permissions here are coarse on purpose — `chat:read` says you may use chat,
 * not which chat — and the service's membership check is what actually decides access. A
 * caller holding every permission still sees only the conversations they belong to.
 *
 * Literal paths are declared before parameter paths so `/chats/users` is not swallowed by
 * `/chats/:id`.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import {
  addChatMembersSchema,
  chatIdParamSchema,
  chatMemberParamSchema,
  chatMessageQuerySchema,
  chatUserSearchSchema,
  createChatSchema,
  editMessageSchema,
  markReadSchema,
  messageParamSchema,
  muteChatSchema,
  sendMessageSchema,
} from '@campusconnect/validation';
import * as chat from '../../controllers/chat.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { chatSendLimiter } from '../../middleware/rateLimit.middleware.js';

export const chatRouter = Router();
chatRouter.use(authenticate, resolveTenant);

/** The new-chat user picker. Declared first so it cannot be read as a chat id. */
chatRouter.get(
  '/chats/users',
  authorize({ anyOf: [Permission.CHAT_CREATE] }),
  validate({ query: chatUserSearchSchema }),
  chat.getChatUsers,
);

chatRouter.get('/chats', authorize({ anyOf: [Permission.CHAT_READ] }), chat.getChats);

chatRouter.post(
  '/chats',
  authorize({ anyOf: [Permission.CHAT_CREATE] }),
  validate({ body: createChatSchema }),
  chat.postChat,
);

chatRouter.get(
  '/chats/:id',
  authorize({ anyOf: [Permission.CHAT_READ] }),
  validate({ params: chatIdParamSchema }),
  chat.getChatById,
);

chatRouter.post(
  '/chats/:id/members',
  authorize({ anyOf: [Permission.CHAT_MANAGE] }),
  validate({ params: chatIdParamSchema, body: addChatMembersSchema }),
  chat.postMembers,
);

chatRouter.delete(
  '/chats/:id/members/:userId',
  authorize({ anyOf: [Permission.CHAT_MANAGE] }),
  validate({ params: chatMemberParamSchema }),
  chat.deleteMember,
);

chatRouter.post(
  '/chats/:id/leave',
  authorize({ anyOf: [Permission.CHAT_READ] }),
  validate({ params: chatIdParamSchema }),
  chat.postLeave,
);

chatRouter.get(
  '/chats/:id/messages',
  authorize({ anyOf: [Permission.CHAT_READ] }),
  validate({ params: chatIdParamSchema, query: chatMessageQuerySchema }),
  chat.getMessages,
);

/** The HTTP fallback for sending; the socket path calls the same service function. */
chatRouter.post(
  '/chats/:id/messages',
  chatSendLimiter,
  authorize({ anyOf: [Permission.CHAT_MESSAGE_SEND] }),
  validate({ params: chatIdParamSchema, body: sendMessageSchema }),
  chat.postMessage,
);

chatRouter.patch(
  '/chats/:id/messages/:messageId',
  authorize({ anyOf: [Permission.CHAT_MESSAGE_SEND] }),
  validate({ params: messageParamSchema, body: editMessageSchema }),
  chat.patchMessage,
);

/** Delete covers both cases: the sender withdrawing, and a moderator removing. */
chatRouter.delete(
  '/chats/:id/messages/:messageId',
  authorize({ anyOf: [Permission.CHAT_MESSAGE_SEND, Permission.CHAT_MODERATE] }),
  validate({ params: messageParamSchema }),
  chat.deleteMessage,
);

chatRouter.post(
  '/chats/:id/read',
  authorize({ anyOf: [Permission.CHAT_READ] }),
  validate({ params: chatIdParamSchema, body: markReadSchema }),
  chat.postRead,
);

chatRouter.patch(
  '/chats/:id/mute',
  authorize({ anyOf: [Permission.CHAT_READ] }),
  validate({ params: chatIdParamSchema, body: muteChatSchema }),
  chat.patchMute,
);
