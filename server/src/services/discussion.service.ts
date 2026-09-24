/**
 * Discussions, comments, reporting and moderation.
 *
 * Moderation in Part A is backend-only: anyone can report, an authorized moderator can review
 * and remove, and every decision is audited. The queue UI is Part B.
 *
 * Removal never deletes. A removed thread keeps its content, gains a status, an actor, a
 * timestamp and a reason, and disappears from ordinary listings — so an appeal has something to
 * appeal against and the audit entry points at a record that still exists.
 */
import type { Principal } from '@campusconnect/security';
import {
  AuditAction,
  AuditResult,
  ContentStatus,
  type CommentDTO,
  type DiscussionDTO,
} from '@campusconnect/types';
import type {
  CreateDiscussionInput,
  ModerationDecisionInput,
  ReportContentInput,
} from '@campusconnect/validation';
import { commentRepository, discussionRepository } from '../repositories/discussion.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { toObjectId, type PageRequest } from '../repositories/base.repository.js';
import { contentReportRepository } from '../repositories/moderation.repository.js';
import type { ReportContext } from '../models/ContentReport.model.js';
import { Errors } from '../utils/errors.js';
import { assertReportableMessage } from './chat.service.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import type { DiscussionDocument } from '../models/Discussion.model.js';
import type { CommentDocument } from '../models/Comment.model.js';

async function authorNameMap(institutionId: string): Promise<Map<string, string>> {
  const users = await userRepository.listUsers(institutionId, { page: 1, limit: 300 });
  return new Map(users.items.map((user) => [String(user._id), user.fullName]));
}

function toDiscussionDTO(
  discussion: DiscussionDocument,
  names: Map<string, string>,
): DiscussionDTO {
  return {
    id: String(discussion._id),
    title: discussion.title,
    body: discussion.body,
    category: discussion.category,
    tags: [...discussion.tags],
    author: {
      userId: String(discussion.authorUserId),
      fullName: names.get(String(discussion.authorUserId)) ?? 'Unknown',
    },
    commentCount: discussion.commentCount,
    reportedCount: discussion.reportedCount,
    status: discussion.status,
    createdAt: discussion.createdAt.toISOString(),
  };
}

function toCommentDTO(
  comment: CommentDocument,
  names: Map<string, string>,
  readerUserId: string,
): CommentDTO {
  return {
    id: String(comment._id),
    discussionId: String(comment.discussionId),
    parentCommentId: comment.parentCommentId ? String(comment.parentCommentId) : null,
    body: comment.body,
    author: {
      userId: String(comment.authorUserId),
      fullName: names.get(String(comment.authorUserId)) ?? 'Unknown',
    },
    reactionCount: comment.reactedByUserIds.length,
    reactedByMe: comment.reactedByUserIds.some((id) => String(id) === readerUserId),
    reportedCount: comment.reportedCount,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function listDiscussions(
  principal: Principal,
  page: PageRequest,
  filters: { category?: string; tag?: string; search?: string } = {},
): Promise<{ items: DiscussionDTO[]; total: number }> {
  const { institutionId } = principal;
  const [result, names] = await Promise.all([
    discussionRepository.list(institutionId, page, filters),
    authorNameMap(institutionId),
  ]);
  return { items: result.items.map((row) => toDiscussionDTO(row, names)), total: result.total };
}

export async function getDiscussion(
  principal: Principal,
  discussionId: string,
): Promise<DiscussionDTO> {
  const { institutionId } = principal;
  // Removed threads are simply not found for ordinary readers.
  const discussion = await discussionRepository.findVisibleById(institutionId, discussionId);
  if (!discussion) throw Errors.notFound();

  const names = await authorNameMap(institutionId);
  return toDiscussionDTO(discussion, names);
}

export async function createDiscussion(
  principal: Principal,
  input: CreateDiscussionInput,
  context: AuditContext,
): Promise<DiscussionDTO> {
  const { institutionId } = principal;

  const discussion = await discussionRepository.create({
    institutionId,
    authorUserId: principal.userId,
    title: input.title,
    body: input.body,
    category: input.category,
    tags: input.tags,
  });

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.DISCUSSION_CREATED,
    resourceType: 'Discussion',
    resourceId: String(discussion._id),
    result: AuditResult.SUCCESS,
    context,
  });

  const names = new Map([[principal.userId, 'You']]);
  return toDiscussionDTO(discussion, names);
}

export async function listComments(
  principal: Principal,
  discussionId: string,
  page: PageRequest,
): Promise<{ items: CommentDTO[]; total: number }> {
  const { institutionId } = principal;

  const discussion = await discussionRepository.findVisibleById(institutionId, discussionId);
  if (!discussion) throw Errors.notFound();

  const [result, names] = await Promise.all([
    commentRepository.listForDiscussion(institutionId, discussionId, page),
    authorNameMap(institutionId),
  ]);

  return {
    items: result.items.map((row) => toCommentDTO(row, names, principal.userId)),
    total: result.total,
  };
}

export async function addComment(
  principal: Principal,
  discussionId: string,
  input: { body: string; parentCommentId?: string },
): Promise<CommentDTO> {
  const { institutionId } = principal;

  const discussion = await discussionRepository.findVisibleById(institutionId, discussionId);
  if (!discussion) throw Errors.notFound();

  // A reply must attach to a comment on THIS thread.
  if (input.parentCommentId) {
    const parent = await commentRepository.findAnyById(institutionId, input.parentCommentId);
    if (!parent || String(parent.discussionId) !== discussionId) throw Errors.notFound();
  }

  const comment = await commentRepository.create({
    institutionId,
    discussionId,
    parentCommentId: input.parentCommentId ?? null,
    authorUserId: principal.userId,
    body: input.body,
  });

  await discussionRepository.incrementCommentCount(institutionId, discussionId, 1);

  const names = new Map([[principal.userId, 'You']]);
  return toCommentDTO(comment, names, principal.userId);
}

export async function toggleCommentReaction(
  principal: Principal,
  commentId: string,
): Promise<CommentDTO> {
  const { institutionId } = principal;

  const existing = await commentRepository.findAnyById(institutionId, commentId);
  if (!existing || existing.status !== ContentStatus.VISIBLE) throw Errors.notFound();

  const updated = await commentRepository.toggleReaction(
    institutionId,
    commentId,
    principal.userId,
  );
  if (!updated) throw Errors.notFound();

  const names = await authorNameMap(institutionId);
  return toCommentDTO(updated, names, principal.userId);
}

const toObjectIdOrNull = (id: string | null) => (id ? toObjectId(id) : null);

/** Report content for review. Anyone may report; the count drives the moderation queue. */
export async function reportContent(
  principal: Principal,
  input: ReportContentInput,
  context: AuditContext,
): Promise<{ status: 'REPORTED' }> {
  const { institutionId } = principal;

  // Each report is a row, once per reporter per target: a repeat report changes nothing, and a
  // report a moderator already dismissed stays dismissed. The Part A counters are bumped only for
  // a genuinely new report, so they count reporters rather than clicks.
  const record = (context: ReportContext): Promise<boolean> =>
    contentReportRepository.recordOnce(institutionId, {
      targetType: input.targetType,
      targetId: input.targetId,
      reporterUserId: principal.userId,
      reason: input.reason,
      context,
    });

  if (input.targetType === 'CHAT_MESSAGE') {
    // Reportable only from inside the chat: the membership check is what stops this endpoint
    // from becoming an oracle for "does this message id exist?".
    const where = await assertReportableMessage(principal, input.targetId);
    await record({
      kind: where.kind,
      chatId: toObjectIdOrNull(where.chatId),
      sourceRef: toObjectIdOrNull(where.sourceRef),
    });
  } else if (input.targetType === 'DISCUSSION') {
    const discussion = await discussionRepository.findVisibleById(institutionId, input.targetId);
    if (!discussion) throw Errors.notFound();
    if (await record({ kind: 'COMMUNITY' })) {
      await discussionRepository.incrementReportCount(institutionId, input.targetId);
    }
  } else {
    const comment = await commentRepository.findAnyById(institutionId, input.targetId);
    if (!comment || comment.status !== ContentStatus.VISIBLE) throw Errors.notFound();
    if (await record({ kind: 'COMMUNITY' })) {
      await commentRepository.incrementReportCount(institutionId, input.targetId);
    }
  }

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.CONTENT_REPORTED,
    resourceType: input.targetType,
    resourceId: input.targetId,
    result: AuditResult.SUCCESS,
    context,
    // The reporter's stated reason, kept short and non-sensitive.
    reason: input.reason.slice(0, 200),
  });

  return { status: 'REPORTED' };
}

/** The moderation queue: reported discussions and comments, most-reported first. */
export async function listReportedContent(
  principal: Principal,
  page: PageRequest,
): Promise<{
  discussions: DiscussionDTO[];
  comments: CommentDTO[];
}> {
  const { institutionId } = principal;

  const [discussions, comments, names] = await Promise.all([
    discussionRepository.listReported(institutionId, page),
    commentRepository.listReported(institutionId, page),
    authorNameMap(institutionId),
  ]);

  return {
    discussions: discussions.items.map((row) => toDiscussionDTO(row, names)),
    comments: comments.items.map((row) => toCommentDTO(row, names, principal.userId)),
  };
}

/**
 * Act on reported content. REMOVE hides it and records who, when and why; DISMISS clears the
 * report without touching the content. Both are audited.
 */
export async function moderateContent(
  principal: Principal,
  targetType: 'DISCUSSION' | 'COMMENT',
  targetId: string,
  input: ModerationDecisionInput,
  context: AuditContext,
): Promise<{ status: 'REMOVED' | 'DISMISSED' }> {
  const { institutionId } = principal;
  const removing = input.action === 'REMOVE';

  if (targetType === 'DISCUSSION') {
    const discussion = await discussionRepository.findAnyById(institutionId, targetId);
    if (!discussion) throw Errors.notFound();

    if (removing) {
      const removed = await discussionRepository.remove(
        institutionId,
        targetId,
        principal.userId,
        input.note ?? null,
      );
      if (!removed) throw Errors.conflict('This content has already been removed.');
    } else {
      await discussionRepository.clearReports(institutionId, targetId);
    }
  } else {
    const comment = await commentRepository.findAnyById(institutionId, targetId);
    if (!comment) throw Errors.notFound();

    if (removing) {
      const removed = await commentRepository.remove(
        institutionId,
        targetId,
        principal.userId,
        input.note ?? null,
      );
      if (!removed) throw Errors.conflict('This content has already been removed.');
      await discussionRepository.incrementCommentCount(
        institutionId,
        String(comment.discussionId),
        -1,
      );
    } else {
      await commentRepository.clearReports(institutionId, targetId);
    }
  }

  // Keep the report records in step with the decision, so the queue and history agree.
  await contentReportRepository.closeOpen(
    institutionId,
    targetType,
    targetId,
    removing ? 'ACTIONED' : 'DISMISSED',
    principal.userId,
  );

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.CONTENT_REMOVED,
    resourceType: targetType,
    resourceId: targetId,
    result: removing ? AuditResult.SUCCESS : AuditResult.DENIED,
    context,
    reason: removing ? `REMOVED: ${input.note ?? 'no note'}` : 'REPORT_DISMISSED',
  });

  return { status: removing ? 'REMOVED' : 'DISMISSED' };
}
