/**
 * Moderation-queue handlers. Thin: the scope rules live in policies/moderationScope.ts and the
 * work in moderation.service.
 */
import type { NextFunction, Request, Response } from 'express';
import type {
  moderationQueueQuerySchema,
  moderationReportDecisionSchema,
  paginationQuerySchema,
} from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import * as moderation from '../services/moderation.service.js';

export async function getReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = validatedQuery<typeof moderationQueueQuerySchema>(res);
    const result = await moderation.listQueue(requirePrincipal(req), query);
    sendSuccess(res, result.items, {
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        hasNext: query.page * query.limit < result.total,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function postDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = validatedBody<typeof moderationReportDecisionSchema>(res);
    sendSuccess(res, await moderation.decide(requirePrincipal(req), input, getRequestContext(req)));
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const result = await moderation.listHistory(requirePrincipal(req), { page, limit });
    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}
