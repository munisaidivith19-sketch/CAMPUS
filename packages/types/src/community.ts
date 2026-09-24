/**
 * Community contracts (Phase 3 Part A): announcements, clubs, events, discussions and
 * notifications.
 *
 * Recommendation surfaces here (`ClubDTO.matchReasons`, `EventDTO.matchReasons`) are
 * **rule-based only**. They carry the reasons a rule matched so the UI can show *why* something
 * was suggested. No model produces them; AI-assisted suggestions are Phase 5 and would be
 * labelled separately.
 */
import type { AttachmentDTO } from './files.js';

export const AnnouncementScope = {
  COLLEGE: 'COLLEGE',
  DEPARTMENT: 'DEPARTMENT',
  BATCH: 'BATCH',
  SECTION: 'SECTION',
  CLUB: 'CLUB',
  HOSTEL: 'HOSTEL',
  ROLE: 'ROLE',
} as const;
export type AnnouncementScope = (typeof AnnouncementScope)[keyof typeof AnnouncementScope];

export const AnnouncementPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type AnnouncementPriority = (typeof AnnouncementPriority)[keyof typeof AnnouncementPriority];

export const ClubMemberRole = {
  MEMBER: 'MEMBER',
  ADMIN: 'ADMIN',
} as const;
export type ClubMemberRole = (typeof ClubMemberRole)[keyof typeof ClubMemberRole];

export const ClubMembershipStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  LEFT: 'LEFT',
} as const;
export type ClubMembershipStatus = (typeof ClubMembershipStatus)[keyof typeof ClubMembershipStatus];

export const EventStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const EventRegistrationStatus = {
  REGISTERED: 'REGISTERED',
  CHECKED_IN: 'CHECKED_IN',
  CANCELLED: 'CANCELLED',
} as const;
export type EventRegistrationStatus =
  (typeof EventRegistrationStatus)[keyof typeof EventRegistrationStatus];

/** Shared visibility state for user-generated content subject to moderation. */
export const ContentStatus = {
  VISIBLE: 'VISIBLE',
  REMOVED: 'REMOVED',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const NotificationType = {
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  ATTENDANCE: 'ATTENDANCE',
  EVENT: 'EVENT',
  CLUB: 'CLUB',
  ACADEMIC: 'ACADEMIC',
  CHAT: 'CHAT',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/**
 * The outcome of an out-of-band delivery attempt.
 *
 * `SKIPPED` is distinct from `FAILED` on purpose: a provider that is NOT CONFIGURED, or a user
 * with no device registered, is not an error to investigate — it is an expected, degraded
 * state. Conflating the two would bury real failures in noise.
 */
export const DeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export interface NotificationDeliveryDTO {
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  /** Short, non-sensitive reason. Never a provider credential or a recipient address. */
  failureReason: string | null;
}

export interface AnnouncementTargetDTO {
  scope: AnnouncementScope;
  departmentId?: string | null;
  batch?: string | null;
  section?: string | null;
  clubId?: string | null;
  role?: string | null;
}

export interface AnnouncementDTO {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  target: AnnouncementTargetDTO;
  author: { userId: string; fullName: string };
  publishAt: string;
  expireAt: string | null;
  read: boolean;
  /** Metadata only; downloads go through `GET /files/:id`, which re-authorizes. */
  attachments: AttachmentDTO[];
  createdAt: string;
}

export interface ClubDTO {
  id: string;
  name: string;
  category: string;
  description: string;
  interests: string[];
  memberCount: number;
  /** The caller's own membership state, so the UI can render the right action. */
  membership: { status: ClubMembershipStatus; role: ClubMemberRole } | null;
  /** Rule-based discovery reasons; empty when the club was not suggested. */
  matchReasons: string[];
}

export interface ClubMembershipDTO {
  id: string;
  clubId: string;
  clubName: string;
  userId: string;
  userFullName: string;
  role: ClubMemberRole;
  status: ClubMembershipStatus;
  createdAt: string;
}

export interface EventDTO {
  id: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  registeredCount: number;
  seatsRemaining: number | null;
  status: EventStatus;
  organizer: { type: 'CLUB' | 'DEPARTMENT'; id: string | null; name: string };
  registration: { status: EventRegistrationStatus; checkedInAt: string | null } | null;
  matchReasons: string[];
}

export interface EventRegistrationDTO {
  id: string;
  eventId: string;
  eventTitle: string;
  userId: string;
  status: EventRegistrationStatus;
  checkInAt: string | null;
  createdAt: string;
}

export interface DiscussionDTO {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  author: { userId: string; fullName: string };
  commentCount: number;
  reportedCount: number;
  status: ContentStatus;
  createdAt: string;
}

export interface CommentDTO {
  id: string;
  discussionId: string;
  parentCommentId: string | null;
  body: string;
  author: { userId: string; fullName: string };
  reactionCount: number;
  reactedByMe: boolean;
  reportedCount: number;
  status: ContentStatus;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Where the client should navigate; a relative app path, never an external URL. */
  link: string | null;
  read: boolean;
  createdAt: string;
  /** Out-of-band delivery attempts. The in-app row stands regardless of what these say. */
  deliveries: NotificationDeliveryDTO[];
}

export const SearchResultKind = {
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  DISCUSSION: 'DISCUSSION',
  EVENT: 'EVENT',
  CLUB: 'CLUB',
} as const;
export type SearchResultKind = (typeof SearchResultKind)[keyof typeof SearchResultKind];

export interface SearchResultDTO {
  kind: SearchResultKind;
  id: string;
  title: string;
  snippet: string;
  link: string;
  occurredAt: string | null;
}

// --- Moderation (Phase 3 completion) ---------------------------------------------

export const ReportTargetType = {
  DISCUSSION: 'DISCUSSION',
  COMMENT: 'COMMENT',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
} as const;
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];

/** Where reported content lives — which decides who may moderate it. */
export type ReportContextKind = 'COMMUNITY' | 'DIRECT' | 'GROUP' | 'CLASS' | 'CLUB';

/**
 * One reported item in the moderation queue, with every open report on it grouped together.
 *
 * `preview` is plain text, truncated, and null for content that is not moderatable (direct
 * messages and private groups are recorded but never opened up). `reporters` is present only
 * for callers who may read the audit trail; everyone else sees reasons without names.
 */
export interface ModerationQueueItemDTO {
  targetType: ReportTargetType;
  targetId: string;
  context: { kind: ReportContextKind; name: string | null };
  reportCount: number;
  firstReportedAt: string;
  lastReportedAt: string;
  reports: Array<{
    reason: string;
    reportedAt: string;
    reporter: { userId: string; fullName: string } | null;
  }>;
  preview: { text: string; author: string | null; createdAt: string | null } | null;
  /** False for private conversations: the reports are recorded, but there is nothing to act on. */
  actionable: boolean;
  /** The content is already gone (removed or deleted by its author). */
  alreadyRemoved: boolean;
}

export interface ModerationActionDTO {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  action: 'REMOVE' | 'DISMISS';
  actor: { userId: string; fullName: string };
  note: string | null;
  reportCount: number;
  context: { kind: ReportContextKind };
  at: string;
}
