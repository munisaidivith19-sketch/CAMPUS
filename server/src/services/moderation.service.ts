/**
 * The moderation queue (Phase 3 completion).
 *
 * Reports are grouped by the content they are about, ranked most-reported first, and routed by
 * where that content lives (policies/moderationScope.ts): each moderator sees only the reports
 * their scope reaches, and a report outside it does not exist for them (NOT_FOUND).
 *
 * What a moderator sees is deliberately limited:
 *  - a plain-text, truncated preview — never markup, never attachments;
 *  - no preview at all for direct messages and private groups, which are recorded but not
 *    moderatable;
 *  - reporter names only for callers who may read the audit trail.
 *
 * Decisions reuse the modules' own removal paths (discussion.service, chat.service), so a
 * removal here is exactly the removal that module would do — soft, audited, body removed.
 */
import {
  AuditAction,
  AuditResult,
  ContentStatus,
  type ModerationActionDTO,
  type ModerationQueueItemDTO,
  type ReportTargetType,
} from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import type {
  ModerationQueueQuery,
  ModerationReportDecisionInput,
} from '@campusconnect/validation';
import type { ReportContext } from '../models/ContentReport.model.js';
import {
  contentReportRepository,
  moderationActionRepository,
  type ReportGroup,
} from '../repositories/moderation.repository.js';
import { commentRepository, discussionRepository } from '../repositories/discussion.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { PageRequest } from '../repositories/base.repository.js';
import {
  canSeeReporters,
  canUseModeration,
  reportVisibility,
  type ModeratorReach,
} from '../policies/moderationScope.js';
import { Errors } from '../utils/errors.js';
import { Permission } from '@campusconnect/types';
import { recordAudit, type AuditContext } from './audit.service.js';
import { messageForModeration, moderationReach, removeMessageAsModerator } from './chat.service.js';
import { moderateContent } from './discussion.service.js';

const PREVIEW_CHARS = 280;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/** Plain text only, control and bidi characters removed, bounded. */
function toPreviewText(text: string): string {
  const clean = text.replace(CONTROL, '').trim();
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS - 1)}…` : clean;
}

async function reachFor(principal: Principal): Promise<ModeratorReach> {
  const chat = await moderationReach(principal);
  return { ...chat, community: principal.permissions.includes(Permission.MODERATION_REVIEW) };
}

async function nameMap(
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    [...new Set(userIds)].map(async (id) => {
      const user = await userRepository.findById(institutionId, id);
      if (user) names.set(id, user.fullName);
    }),
  );
  return names;
}

interface Preview {
  preview: ModerationQueueItemDTO['preview'];
  alreadyRemoved: boolean;
  contextName: string | null;
  exists: boolean;
}

async function previewFor(
  institutionId: string,
  targetType: ReportTargetType,
  targetId: string,
  context: ReportContext,
  actionable: boolean,
): Promise<Preview> {
  if (targetType === 'DISCUSSION') {
    const row = await discussionRepository.findAnyById(institutionId, targetId);
    if (!row)
      return { preview: null, alreadyRemoved: true, contextName: 'Discussions', exists: false };
    const names = await nameMap(institutionId, [String(row.authorUserId)]);
    const removed = row.status !== ContentStatus.VISIBLE;
    return {
      preview: removed
        ? null
        : {
            text: toPreviewText(`${row.title}\n${row.body}`),
            author: names.get(String(row.authorUserId)) ?? null,
            createdAt: row.createdAt.toISOString(),
          },
      alreadyRemoved: removed,
      contextName: 'Discussions',
      exists: true,
    };
  }

  if (targetType === 'COMMENT') {
    const row = await commentRepository.findAnyById(institutionId, targetId);
    if (!row)
      return { preview: null, alreadyRemoved: true, contextName: 'Comments', exists: false };
    const names = await nameMap(institutionId, [String(row.authorUserId)]);
    const removed = row.status !== ContentStatus.VISIBLE;
    return {
      preview: removed
        ? null
        : {
            text: toPreviewText(row.body),
            author: names.get(String(row.authorUserId)) ?? null,
            createdAt: row.createdAt.toISOString(),
          },
      alreadyRemoved: removed,
      contextName: 'Comments',
      exists: true,
    };
  }

  // Private conversations: recorded, never opened up — not even the chat's name.
  if (!actionable || context.kind === 'DIRECT' || context.kind === 'GROUP') {
    return { preview: null, alreadyRemoved: false, contextName: null, exists: true };
  }

  const message = await messageForModeration(institutionId, targetId);
  if (!message) return { preview: null, alreadyRemoved: true, contextName: null, exists: false };
  return {
    preview:
      message.deleted || message.text === null
        ? null
        : {
            text: toPreviewText(message.text),
            author: message.author,
            createdAt: message.createdAt.toISOString(),
          },
    alreadyRemoved: message.deleted,
    contextName: message.chatName,
    exists: true,
  };
}

export async function listQueue(
  principal: Principal,
  query: ModerationQueueQuery,
): Promise<{ items: ModerationQueueItemDTO[]; total: number }> {
  if (!canUseModeration(principal)) throw Errors.forbidden();
  const { institutionId } = principal;
  const reach = await reachFor(principal);
  const showReporters = canSeeReporters(principal);

  const groups = await contentReportRepository.groupByTarget(institutionId, query.status);
  const visible = groups
    .map((group) => ({ group, visibility: reportVisibility(reach, group.context) }))
    .filter(({ visibility }) => visibility.visible);

  const start = (query.page - 1) * query.limit;
  const pageRows = visible.slice(start, start + query.limit);

  const reporterNames = showReporters
    ? await nameMap(
        institutionId,
        pageRows.flatMap(({ group }) =>
          group.reports.map((report) => String(report.reporterUserId)),
        ),
      )
    : new Map<string, string>();

  const items = await Promise.all(
    pageRows.map(async ({ group, visibility }) => {
      const preview = await previewFor(
        institutionId,
        group.targetType,
        String(group.targetId),
        group.context,
        visibility.actionable,
      );
      return toQueueItem(group, visibility.actionable, preview, showReporters, reporterNames);
    }),
  );

  return { items, total: visible.length };
}

function toQueueItem(
  group: ReportGroup,
  actionable: boolean,
  preview: Preview,
  showReporters: boolean,
  reporterNames: Map<string, string>,
): ModerationQueueItemDTO {
  return {
    targetType: group.targetType,
    targetId: String(group.targetId),
    context: { kind: group.context.kind, name: preview.contextName },
    reportCount: group.count,
    firstReportedAt: group.firstAt.toISOString(),
    lastReportedAt: group.lastAt.toISOString(),
    reports: group.reports.map((report) => ({
      reason: report.reason,
      reportedAt: report.at.toISOString(),
      reporter: showReporters
        ? {
            userId: String(report.reporterUserId),
            fullName: reporterNames.get(String(report.reporterUserId)) ?? 'Unknown',
          }
        : null,
    })),
    preview: preview.preview,
    actionable: actionable && !preview.alreadyRemoved,
    alreadyRemoved: preview.alreadyRemoved,
  };
}

/**
 * Remove or dismiss everything reported about one item.
 *
 * Out of scope, or nothing open → NOT_FOUND. A private conversation → CONFLICT: its reports
 * exist (the moderator can see them) but there is nothing they may act on.
 */
export async function decide(
  principal: Principal,
  input: ModerationReportDecisionInput,
  context: AuditContext,
): Promise<{ status: 'REMOVED' | 'DISMISSED'; closedReports: number }> {
  if (!canUseModeration(principal)) throw Errors.forbidden();
  const { institutionId, userId } = principal;

  const open = await contentReportRepository.findOpenForTarget(
    institutionId,
    input.targetType,
    input.targetId,
  );
  const first = open[0];
  if (!first) throw Errors.notFound();

  const reach = await reachFor(principal);
  const visibility = reportVisibility(reach, first.context);
  if (!visibility.visible) throw Errors.notFound();
  if (!visibility.actionable) {
    throw Errors.conflict(
      'Direct messages and private groups are not moderated. The report is kept on record.',
    );
  }

  const removing = input.action === 'REMOVE';
  const note = input.note ?? null;

  if (input.targetType === 'CHAT_MESSAGE') {
    if (removing) await removeMessageAsModerator(principal, input.targetId, note ?? '', context);
  } else if (removing) {
    const already =
      input.targetType === 'DISCUSSION'
        ? (await discussionRepository.findAnyById(institutionId, input.targetId))?.status !==
          ContentStatus.VISIBLE
        : (await commentRepository.findAnyById(institutionId, input.targetId))?.status !==
          ContentStatus.VISIBLE;
    if (!already) {
      await moderateContent(
        principal,
        input.targetType,
        input.targetId,
        { action: 'REMOVE', note: note ?? undefined },
        context,
      );
    }
  } else if (input.targetType === 'DISCUSSION') {
    await discussionRepository.clearReports(institutionId, input.targetId);
  } else {
    await commentRepository.clearReports(institutionId, input.targetId);
  }

  const closed = await contentReportRepository.closeOpen(
    institutionId,
    input.targetType,
    input.targetId,
    removing ? 'ACTIONED' : 'DISMISSED',
    userId,
  );

  await moderationActionRepository.record(institutionId, {
    targetType: input.targetType,
    targetId: input.targetId,
    action: input.action,
    actorUserId: userId,
    note,
    reportCount: Math.max(closed, open.length),
    context: first.context,
  });

  if (!removing) {
    await recordAudit({
      institutionId,
      actorUserId: userId,
      action: AuditAction.REPORT_DISMISSED,
      resourceType: input.targetType,
      resourceId: input.targetId,
      result: AuditResult.SUCCESS,
      context,
      reason: `Dismissed ${open.length} report(s)${note ? `: ${note.slice(0, 200)}` : ''}`,
    });
  }

  return { status: removing ? 'REMOVED' : 'DISMISSED', closedReports: closed };
}

/** The decisions this moderator's scope reaches, newest first. */
export async function listHistory(
  principal: Principal,
  page: PageRequest,
): Promise<{ items: ModerationActionDTO[]; total: number }> {
  if (!canUseModeration(principal)) throw Errors.forbidden();
  const { institutionId } = principal;
  const reach = await reachFor(principal);

  const result = await moderationActionRepository.list(institutionId, page);
  const visible = result.items.filter((row) => reportVisibility(reach, row.context).visible);
  const names = await nameMap(
    institutionId,
    visible.map((row) => String(row.actorUserId)),
  );

  return {
    items: visible.map((row) => ({
      id: String(row._id),
      targetType: row.targetType,
      targetId: String(row.targetId),
      action: row.action,
      actor: {
        userId: String(row.actorUserId),
        fullName: names.get(String(row.actorUserId)) ?? 'Unknown',
      },
      note: row.note ?? null,
      reportCount: row.reportCount,
      context: { kind: row.context.kind },
      at: row.createdAt.toISOString(),
    })),
    total: result.total,
  };
}
