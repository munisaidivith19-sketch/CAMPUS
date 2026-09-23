/**
 * Community handlers: announcements, clubs, events, discussions, notifications and search.
 *
 * Grouped in one file because each handler is three lines of plumbing around a single service
 * call; splitting them further would add files without adding clarity. All business rules and
 * every authorization decision live in the services.
 */
import type { NextFunction, Request, Response } from 'express';
import { ClubMembershipStatus } from '@campusconnect/types';
import type {
  announcementQuerySchema,
  clubMembershipDecisionSchema,
  clubQuerySchema,
  createAnnouncementSchema,
  createCommentSchema,
  createDiscussionSchema,
  createEventSchema,
  discussionQuerySchema,
  eventCheckInSchema,
  eventQuerySchema,
  idParamSchema,
  moderationDecisionSchema,
  notificationQuerySchema,
  paginationQuerySchema,
  reportContentSchema,
  searchQuerySchema,
} from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import {
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  markAnnouncementRead,
} from '../services/announcement.service.js';
import { decideMembership, getClub, listClubMembers, listClubs, requestMembership } from '../services/club.service.js';
import {
  checkInWithQr,
  createEvent,
  getEvent,
  issueEventCheckInQr,
  listEvents,
  listMyRegistrations,
  registerForEvent,
} from '../services/event.service.js';
import {
  addComment,
  createDiscussion,
  getDiscussion,
  listComments,
  listDiscussions,
  listReportedContent,
  moderateContent,
  reportContent,
  toggleCommentReaction,
} from '../services/discussion.service.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification.service.js';
import { search } from '../services/search.service.js';
import { Errors } from '../utils/errors.js';

/** Shared pagination envelope helper — every list endpoint answers the same shape. */
function paginated<T>(res: Response, items: T[], page: number, limit: number, total: number): void {
  sendSuccess(res, items, {
    pagination: { page, limit, total, hasNext: page * limit < total },
  });
}

// --- Announcements -----------------------------------------------------------

export async function postAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const input = validatedBody<typeof createAnnouncementSchema>(res);
    sendSuccess(res, await createAnnouncement(principal, input, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getAnnouncements(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, unreadOnly, priority, q } = validatedQuery<typeof announcementQuerySchema>(res);
    const result = await listAnnouncements(principal, { page, limit }, { unreadOnly, priority, search: q });
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

export async function getAnnouncementById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await getAnnouncement(principal, id));
  } catch (err) {
    next(err);
  }
}

export async function postAnnouncementRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    await markAnnouncementRead(principal, id);
    sendSuccess(res, { status: 'READ' });
  } catch (err) {
    next(err);
  }
}

// --- Clubs -------------------------------------------------------------------

export async function getClubs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, category, q, suggested } = validatedQuery<typeof clubQuerySchema>(res);
    const result = await listClubs(principal, { page, limit }, { category, search: q, suggested });
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

export async function getClubById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await getClub(principal, id));
  } catch (err) {
    next(err);
  }
}

export async function postClubJoin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await requestMembership(principal, id, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getClubMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const status = typeof req.query.status === 'string' ? (req.query.status as ClubMembershipStatus) : undefined;
    const result = await listClubMembers(principal, id, { page, limit }, status);
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

export async function patchMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const input = validatedBody<typeof clubMembershipDecisionSchema>(res);
    sendSuccess(res, await decideMembership(principal, id, input, getRequestContext(req)));
  } catch (err) {
    next(err);
  }
}

// --- Events ------------------------------------------------------------------

export async function getEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, category, status, q, upcomingOnly, suggested } =
      validatedQuery<typeof eventQuerySchema>(res);
    const result = await listEvents(
      principal,
      { page, limit },
      { category, status, search: q, upcomingOnly, suggested },
    );
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

export async function getEventById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await getEvent(principal, id));
  } catch (err) {
    next(err);
  }
}

export async function postEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const input = validatedBody<typeof createEventSchema>(res);
    sendSuccess(res, await createEvent(principal, input, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function postEventRegistration(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await registerForEvent(principal, id, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function postEventQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await issueEventCheckInQr(principal, id, getRequestContext(req)));
  } catch (err) {
    next(err);
  }
}

export async function postEventCheckIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const { token } = validatedBody<typeof eventCheckInSchema>(res);
    sendSuccess(res, await checkInWithQr(principal, id, token, getRequestContext(req)));
  } catch (err) {
    next(err);
  }
}

export async function getMyRegistrations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const result = await listMyRegistrations(principal, { page, limit });
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

// --- Discussions & moderation -------------------------------------------------

export async function getDiscussions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, category, tag, q } = validatedQuery<typeof discussionQuerySchema>(res);
    const result = await listDiscussions(principal, { page, limit }, { category, tag, search: q });
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

export async function getDiscussionById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await getDiscussion(principal, id));
  } catch (err) {
    next(err);
  }
}

export async function postDiscussion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const input = validatedBody<typeof createDiscussionSchema>(res);
    sendSuccess(res, await createDiscussion(principal, input, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getComments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const result = await listComments(principal, id, { page, limit });
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}

export async function postComment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const input = validatedBody<typeof createCommentSchema>(res);
    sendSuccess(res, await addComment(principal, id, input), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function postCommentReaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    sendSuccess(res, await toggleCommentReaction(principal, id));
  } catch (err) {
    next(err);
  }
}

export async function postReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const input = validatedBody<typeof reportContentSchema>(res);
    sendSuccess(res, await reportContent(principal, input, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getModerationQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    sendSuccess(res, await listReportedContent(principal, { page, limit }));
  } catch (err) {
    next(err);
  }
}

export async function postModerationDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const input = validatedBody<typeof moderationDecisionSchema>(res);

    const targetType = req.path.includes('/comments/') ? 'COMMENT' : 'DISCUSSION';
    sendSuccess(res, await moderateContent(principal, targetType, id, input, getRequestContext(req)));
  } catch (err) {
    next(err);
  }
}

// --- Notifications & search ---------------------------------------------------

export async function getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, unreadOnly } = validatedQuery<typeof notificationQuerySchema>(res);
    const result = await listNotifications(
      principal.institutionId,
      principal.userId,
      { page, limit },
      unreadOnly,
    );

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function patchNotificationRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const marked = await markNotificationRead(principal.institutionId, principal.userId, id);
    // Another user's notification id simply does not match — reported as absent.
    if (!marked) throw Errors.notFound();
    sendSuccess(res, { status: 'READ' });
  } catch (err) {
    next(err);
  }
}

export async function postNotificationsReadAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const count = await markAllNotificationsRead(principal.institutionId, principal.userId);
    sendSuccess(res, { status: 'READ_ALL', count });
  } catch (err) {
    next(err);
  }
}

export async function getSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, q, kinds } = validatedQuery<typeof searchQuerySchema>(res);
    const result = await search(principal, q, { page, limit }, kinds);
    paginated(res, result.items, page, limit, result.total);
  } catch (err) {
    next(err);
  }
}
