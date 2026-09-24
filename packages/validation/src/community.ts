/**
 * Community request schemas (Phase 3 Part A).
 *
 * Announcement targeting is the interesting one: the scope determines which reference field is
 * required, and the refinement rejects an inconsistent pair (e.g. scope=SECTION with no section)
 * before it can reach a service and silently broadcast wider than intended.
 */
import { z } from 'zod';
import {
  AnnouncementPriority,
  AnnouncementScope,
  ClubMembershipStatus,
  EventStatus,
  Role,
  SearchResultKind,
} from '@campusconnect/types';
import { UPLOAD } from '@campusconnect/config';
import { attachmentIdsSchema, objectIdSchema, paginationQuerySchema } from './common.js';

// --- Announcements -----------------------------------------------------------

const announcementTargetSchema = z
  .object({
    scope: z.nativeEnum(AnnouncementScope),
    departmentId: objectIdSchema.optional(),
    batch: z.string().trim().max(20).optional(),
    section: z.string().trim().max(10).optional(),
    clubId: objectIdSchema.optional(),
    role: z.nativeEnum(Role).optional(),
  })
  .superRefine((target, ctx) => {
    // Each scope needs its own reference; a missing one would widen the audience.
    const required: Partial<Record<AnnouncementScope, keyof typeof target>> = {
      [AnnouncementScope.DEPARTMENT]: 'departmentId',
      [AnnouncementScope.BATCH]: 'batch',
      [AnnouncementScope.SECTION]: 'section',
      [AnnouncementScope.CLUB]: 'clubId',
      [AnnouncementScope.ROLE]: 'role',
    };

    const field = required[target.scope];
    if (field && target[field] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${String(field)} is required when scope is ${target.scope}`,
      });
    }

    // SECTION targeting also needs the batch, or it would hit every batch's "A" section.
    if (target.scope === AnnouncementScope.SECTION && target.batch === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['batch'],
        message: 'batch is required when scope is SECTION',
      });
    }
  });

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(10_000),
    priority: z.nativeEnum(AnnouncementPriority).default(AnnouncementPriority.NORMAL),
    target: announcementTargetSchema,
    publishAt: z.coerce.date().optional(),
    expireAt: z.coerce.date().optional(),
    attachmentFileIds: attachmentIdsSchema(UPLOAD.ANNOUNCEMENT_MAX_ATTACHMENTS),
  })
  .refine((v) => !v.expireAt || !v.publishAt || v.expireAt > v.publishAt, {
    message: 'expireAt must be after publishAt',
    path: ['expireAt'],
  });
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const announcementQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  priority: z.nativeEnum(AnnouncementPriority).optional(),
  q: z.string().trim().max(120).optional(),
});

// --- Clubs -------------------------------------------------------------------

export const clubQuerySchema = paginationQuerySchema.extend({
  category: z.string().trim().max(60).optional(),
  q: z.string().trim().max(120).optional(),
  /** Rule-based suggestions for the caller; never AI (that is Phase 5). */
  suggested: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const clubMembershipDecisionSchema = z.object({
  decision: z.enum([ClubMembershipStatus.APPROVED, ClubMembershipStatus.REJECTED]),
});
export type ClubMembershipDecisionInput = z.infer<typeof clubMembershipDecisionSchema>;

export const createClubSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(1).max(2000),
  interests: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

// --- Events ------------------------------------------------------------------

export const createEventSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(1).max(5000),
    category: z.string().trim().min(2).max(60),
    venue: z.string().trim().min(1).max(200),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    capacity: z.coerce.number().int().min(1).max(100_000).optional(),
    organizer: z.object({
      type: z.enum(['CLUB', 'DEPARTMENT']),
      clubId: objectIdSchema.optional(),
      departmentId: objectIdSchema.optional(),
    }),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine((v) => (v.organizer.type === 'CLUB' ? Boolean(v.organizer.clubId) : true), {
    message: 'clubId is required for a club-organized event',
    path: ['organizer', 'clubId'],
  })
  .refine((v) => (v.organizer.type === 'DEPARTMENT' ? Boolean(v.organizer.departmentId) : true), {
    message: 'departmentId is required for a department-organized event',
    path: ['organizer', 'departmentId'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const eventQuerySchema = paginationQuerySchema.extend({
  category: z.string().trim().max(60).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  q: z.string().trim().max(120).optional(),
  upcomingOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  suggested: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** Check-in submits only the opaque QR token; identity is resolved server-side. */
export const eventCheckInSchema = z.object({
  token: z.string().trim().min(20).max(256),
});

// --- Discussions, comments, moderation ---------------------------------------

export const createDiscussionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10_000),
  category: z.string().trim().min(2).max(60),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export type CreateDiscussionInput = z.infer<typeof createDiscussionSchema>;

export const discussionQuerySchema = paginationQuerySchema.extend({
  category: z.string().trim().max(60).optional(),
  tag: z.string().trim().max(30).optional(),
  q: z.string().trim().max(120).optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  parentCommentId: objectIdSchema.optional(),
});

export const reportContentSchema = z.object({
  // CHAT_MESSAGE is reportable from inside the chat; the queue routes it to that chat's moderators.
  targetType: z.enum(['DISCUSSION', 'COMMENT', 'CHAT_MESSAGE']),
  targetId: objectIdSchema,
  reason: z.string().trim().min(5, 'Say what is wrong with this content').max(500),
});
export type ReportContentInput = z.infer<typeof reportContentSchema>;

export const moderationDecisionSchema = z.object({
  action: z.enum(['REMOVE', 'DISMISS']),
  note: z.string().trim().max(500).optional(),
});
export type ModerationDecisionInput = z.infer<typeof moderationDecisionSchema>;

export const moderationQueueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).default('OPEN'),
});
export type ModerationQueueQuery = z.infer<typeof moderationQueueQuerySchema>;

/**
 * A decision from the moderation queue. Removing someone's content needs a stated reason —
 * it is shown in the history and recorded in the audit trail.
 */
export const moderationReportDecisionSchema = z
  .object({
    targetType: z.enum(['DISCUSSION', 'COMMENT', 'CHAT_MESSAGE']),
    targetId: objectIdSchema,
    action: z.enum(['REMOVE', 'DISMISS']),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'REMOVE' && (!value.note || value.note.length < 5)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Say why this is being removed',
      });
    }
  });
export type ModerationReportDecisionInput = z.infer<typeof moderationReportDecisionSchema>;

// --- Notifications & search ---------------------------------------------------

export const notificationQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(2, 'Search for at least 2 characters').max(120),
  kinds: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((kind) => kind.trim().toUpperCase())
            .filter((kind): kind is SearchResultKind =>
              Object.values(SearchResultKind).includes(kind as SearchResultKind),
            )
        : undefined,
    ),
});

export const idParamSchema = z.object({ id: objectIdSchema });
