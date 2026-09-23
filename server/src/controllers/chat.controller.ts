/**
 * Chat HTTP handlers.
 *
 * Thin by design: each one resolves the principal, hands validated input to `chat.service`, and
 * sends what comes back. Every authorization decision lives in the service and the policy
 * module, because the socket layer calls the same functions and the two must not drift.
 */
import type { NextFunction, Request, Response } from 'express';
import type {
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
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import * as chatService from '../services/chat.service.js';

export async function getChats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await chatService.listChats(requirePrincipal(req)));
  } catch (err) {
    next(err);
  }
}

export async function postChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = validatedBody<typeof createChatSchema>(res);
    const chat = await chatService.createChat(requirePrincipal(req), input);
    sendSuccess(res, chat, { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getChatById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    sendSuccess(res, await chatService.getChat(requirePrincipal(req), id));
  } catch (err) {
    next(err);
  }
}

export async function postMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    const input = validatedBody<typeof addChatMembersSchema>(res);
    sendSuccess(res, await chatService.addMembers(requirePrincipal(req), id, input));
  } catch (err) {
    next(err);
  }
}

export async function deleteMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, userId } = validatedParams<typeof chatMemberParamSchema>(res);
    sendSuccess(res, await chatService.removeMember(requirePrincipal(req), id, userId));
  } catch (err) {
    next(err);
  }
}

export async function postLeave(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    sendSuccess(res, await chatService.leaveChat(requirePrincipal(req), id));
  } catch (err) {
    next(err);
  }
}

export async function getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    const query = validatedQuery<typeof chatMessageQuerySchema>(res);
    sendSuccess(res, await chatService.listMessages(requirePrincipal(req), id, query));
  } catch (err) {
    next(err);
  }
}

/**
 * The HTTP fallback for sending, for a client whose socket is down.
 *
 * It calls the same `chat.service.sendMessage` the socket handler does, so a message sent this
 * way is idempotent, rate-limited and fanned out exactly like any other.
 */
export async function postMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    const input = validatedBody<typeof sendMessageSchema>(res);
    const message = await chatService.sendMessage(requirePrincipal(req), id, input);
    sendSuccess(res, message, { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function patchMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, messageId } = validatedParams<typeof messageParamSchema>(res);
    const { body } = validatedBody<typeof editMessageSchema>(res);
    sendSuccess(res, await chatService.editMessage(requirePrincipal(req), id, messageId, body));
  } catch (err) {
    next(err);
  }
}

export async function deleteMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, messageId } = validatedParams<typeof messageParamSchema>(res);
    sendSuccess(
      res,
      await chatService.deleteMessage(requirePrincipal(req), id, messageId, getRequestContext(req)),
    );
  } catch (err) {
    next(err);
  }
}

export async function postRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    const { lastReadMessageId } = validatedBody<typeof markReadSchema>(res);
    sendSuccess(res, await chatService.markRead(requirePrincipal(req), id, lastReadMessageId));
  } catch (err) {
    next(err);
  }
}

export async function patchMute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof chatIdParamSchema>(res);
    const { muted } = validatedBody<typeof muteChatSchema>(res);
    sendSuccess(res, await chatService.setMuted(requirePrincipal(req), id, muted));
  } catch (err) {
    next(err);
  }
}

/** The user picker: a capped search, never a directory listing. */
export async function getChatUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = validatedQuery<typeof chatUserSearchSchema>(res);
    sendSuccess(res, await chatService.searchChatUsers(requirePrincipal(req), query));
  } catch (err) {
    next(err);
  }
}
