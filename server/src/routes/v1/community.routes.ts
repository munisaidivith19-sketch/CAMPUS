/**
 * Community routes: announcements, clubs, events, discussions, moderation, notifications and
 * search.
 *
 * Route order matters where a literal path could be swallowed by a parameter route
 * (`/events/registrations` before `/events/:id`), so the specific paths are declared first.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import {
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
  moderationQueueQuerySchema,
  moderationReportDecisionSchema,
  notificationQuerySchema,
  paginationQuerySchema,
  reportContentSchema,
  searchQuerySchema,
} from '@campusconnect/validation';
import * as moderation from '../../controllers/moderation.controller.js';
import * as community from '../../controllers/community.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';

export const communityRouter = Router();
communityRouter.use(authenticate, resolveTenant);

// --- Announcements -----------------------------------------------------------

communityRouter.get(
  '/announcements',
  authorize({ anyOf: [Permission.ANNOUNCEMENT_READ] }),
  validate({ query: announcementQuerySchema }),
  community.getAnnouncements,
);

communityRouter.post(
  '/announcements',
  authorize({ anyOf: [Permission.ANNOUNCEMENT_CREATE] }),
  validate({ body: createAnnouncementSchema }),
  community.postAnnouncement,
);

communityRouter.get(
  '/announcements/:id',
  authorize({ anyOf: [Permission.ANNOUNCEMENT_READ] }),
  validate({ params: idParamSchema }),
  community.getAnnouncementById,
);

communityRouter.post(
  '/announcements/:id/read',
  authorize({ anyOf: [Permission.ANNOUNCEMENT_READ] }),
  validate({ params: idParamSchema }),
  community.postAnnouncementRead,
);

// --- Clubs -------------------------------------------------------------------

communityRouter.get(
  '/clubs',
  authorize({ anyOf: [Permission.CLUB_READ] }),
  validate({ query: clubQuerySchema }),
  community.getClubs,
);

// Declared before '/clubs/:id' so the literal segment is not captured as an id.
communityRouter.patch(
  '/clubs/memberships/:id',
  authorize({ anyOf: [Permission.CLUB_MANAGE] }),
  validate({ params: idParamSchema, body: clubMembershipDecisionSchema }),
  community.patchMembership,
);

communityRouter.get(
  '/clubs/:id',
  authorize({ anyOf: [Permission.CLUB_READ] }),
  validate({ params: idParamSchema }),
  community.getClubById,
);

communityRouter.get(
  '/clubs/:id/members',
  authorize({ anyOf: [Permission.CLUB_READ] }),
  validate({ params: idParamSchema, query: paginationQuerySchema }),
  community.getClubMembers,
);

communityRouter.post(
  '/clubs/:id/join',
  authorize({ anyOf: [Permission.CLUB_JOIN] }),
  validate({ params: idParamSchema }),
  community.postClubJoin,
);

/** Leave a club (or withdraw a request). The derived club-chat membership goes with it. */
communityRouter.post(
  '/clubs/:id/leave',
  authorize({ anyOf: [Permission.CLUB_JOIN] }),
  validate({ params: idParamSchema }),
  community.postClubLeave,
);

// --- Events ------------------------------------------------------------------

communityRouter.get(
  '/events',
  authorize({ anyOf: [Permission.EVENT_READ] }),
  validate({ query: eventQuerySchema }),
  community.getEvents,
);

communityRouter.post(
  '/events',
  authorize({ anyOf: [Permission.EVENT_CREATE] }),
  validate({ body: createEventSchema }),
  community.postEvent,
);

communityRouter.get(
  '/events/registrations',
  authorize({ anyOf: [Permission.EVENT_READ] }),
  validate({ query: paginationQuerySchema }),
  community.getMyRegistrations,
);

communityRouter.get(
  '/events/:id',
  authorize({ anyOf: [Permission.EVENT_READ] }),
  validate({ params: idParamSchema }),
  community.getEventById,
);

communityRouter.post(
  '/events/:id/register',
  authorize({ anyOf: [Permission.EVENT_REGISTER] }),
  validate({ params: idParamSchema }),
  community.postEventRegistration,
);

/** The attendee mints their own check-in code for an event they registered for. */
communityRouter.post(
  '/events/:id/qr',
  authorize({ anyOf: [Permission.EVENT_REGISTER] }),
  validate({ params: idParamSchema }),
  community.postEventQr,
);

/** Staff scan it at the door. Single-use and purpose-checked inside the service. */
communityRouter.post(
  '/events/:id/check-in',
  authorize({ anyOf: [Permission.EVENT_CHECKIN] }),
  validate({ params: idParamSchema, body: eventCheckInSchema }),
  community.postEventCheckIn,
);

// --- Discussions ---------------------------------------------------------------

communityRouter.get(
  '/discussions',
  authorize({ anyOf: [Permission.DISCUSSION_READ] }),
  validate({ query: discussionQuerySchema }),
  community.getDiscussions,
);

communityRouter.post(
  '/discussions',
  authorize({ anyOf: [Permission.DISCUSSION_CREATE] }),
  validate({ body: createDiscussionSchema }),
  community.postDiscussion,
);

communityRouter.get(
  '/discussions/:id',
  authorize({ anyOf: [Permission.DISCUSSION_READ] }),
  validate({ params: idParamSchema }),
  community.getDiscussionById,
);

communityRouter.get(
  '/discussions/:id/comments',
  authorize({ anyOf: [Permission.DISCUSSION_READ] }),
  validate({ params: idParamSchema, query: paginationQuerySchema }),
  community.getComments,
);

communityRouter.post(
  '/discussions/:id/comments',
  authorize({ anyOf: [Permission.COMMENT_CREATE] }),
  validate({ params: idParamSchema, body: createCommentSchema }),
  community.postComment,
);

communityRouter.post(
  '/comments/:id/reactions',
  authorize({ anyOf: [Permission.COMMENT_CREATE] }),
  validate({ params: idParamSchema }),
  community.postCommentReaction,
);

// --- Reporting & moderation ---------------------------------------------------------

communityRouter.post(
  '/reports',
  authorize({ anyOf: [Permission.REPORT_CREATE] }),
  validate({ body: reportContentSchema }),
  community.postReport,
);

communityRouter.get(
  '/moderation/queue',
  authorize({ anyOf: [Permission.MODERATION_REVIEW] }),
  validate({ query: paginationQuerySchema }),
  community.getModerationQueue,
);

communityRouter.post(
  '/moderation/discussions/:id',
  authorize({ anyOf: [Permission.MODERATION_REVIEW] }),
  validate({ params: idParamSchema, body: moderationDecisionSchema }),
  community.postModerationDecision,
);

communityRouter.post(
  '/moderation/comments/:id',
  authorize({ anyOf: [Permission.MODERATION_REVIEW] }),
  validate({ params: idParamSchema, body: moderationDecisionSchema }),
  community.postModerationDecision,
);

/**
 * The grouped, scope-narrowed moderation queue. Open to anyone who moderates anything —
 * community content (`moderation:review`) or chats (`chat:moderate`) — and the service shows
 * each of them only what their scope reaches.
 */
communityRouter.get(
  '/moderation/reports',
  authorize({ anyOf: [Permission.MODERATION_REVIEW, Permission.CHAT_MODERATE] }),
  validate({ query: moderationQueueQuerySchema }),
  moderation.getReports,
);

communityRouter.post(
  '/moderation/reports/decide',
  authorize({ anyOf: [Permission.MODERATION_REVIEW, Permission.CHAT_MODERATE] }),
  validate({ body: moderationReportDecisionSchema }),
  moderation.postDecision,
);

communityRouter.get(
  '/moderation/history',
  authorize({ anyOf: [Permission.MODERATION_REVIEW, Permission.CHAT_MODERATE] }),
  validate({ query: paginationQuerySchema }),
  moderation.getHistory,
);

// --- Notifications & search -----------------------------------------------------

communityRouter.get(
  '/notifications',
  authorize({ anyOf: [Permission.NOTIFICATION_READ_SELF] }),
  validate({ query: notificationQuerySchema }),
  community.getNotifications,
);

communityRouter.post(
  '/notifications/read-all',
  authorize({ anyOf: [Permission.NOTIFICATION_READ_SELF] }),
  community.postNotificationsReadAll,
);

communityRouter.patch(
  '/notifications/:id/read',
  authorize({ anyOf: [Permission.NOTIFICATION_READ_SELF] }),
  validate({ params: idParamSchema }),
  community.patchNotificationRead,
);

communityRouter.get(
  '/search',
  authorize({ anyOf: [Permission.SEARCH_QUERY] }),
  validate({ query: searchQuerySchema }),
  community.getSearch,
);
