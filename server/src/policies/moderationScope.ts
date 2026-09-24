/**
 * Who may see and act on which reports — pure rules, no database.
 *
 * Reports are routed by WHERE the content lives, not merely by who holds a permission:
 *
 *  - Community content (discussions, comments) is institution-wide, so it belongs to holders of
 *    `moderation:review` (principal, HOD, system admin) — unchanged from Part A.
 *  - A class chat message belongs to the moderators of that class: the mentor of its section,
 *    the HOD of its department, principal/system admin — resolved from the academic scope.
 *  - A club chat message belongs to that club's admins, and to principal/system admin.
 *  - Direct messages and private groups are NOT moderated (Part C-2 decision). Their reports are
 *    recorded and shown to institution-wide moderators as non-actionable, without a preview — a
 *    private conversation is not opened up because someone reported it.
 *
 * A moderator with no backing assignment (a mentor without a section, a club admin of nothing)
 * reaches nothing beyond what their permissions alone grant.
 */
import { Permission } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import type { ModerationReach } from './chatAccess.js';
import type { ReportContext } from '../models/ContentReport.model.js';

export interface ModeratorReach extends ModerationReach {
  /** Holds `moderation:review`: discussions and comments. */
  community: boolean;
}

export interface ReportVisibility {
  visible: boolean;
  actionable: boolean;
}

export function canUseModeration(principal: Principal): boolean {
  return (
    principal.permissions.includes(Permission.MODERATION_REVIEW) ||
    principal.permissions.includes(Permission.CHAT_MODERATE)
  );
}

/** Where a report sits relative to what this moderator reaches. */
export function reportVisibility(reach: ModeratorReach, context: ReportContext): ReportVisibility {
  const source = context.sourceRef ? String(context.sourceRef) : null;
  switch (context.kind) {
    case 'COMMUNITY':
      return { visible: reach.community, actionable: reach.community };
    case 'DIRECT':
    case 'GROUP':
      // Recorded, never actionable; only institution-wide moderators see that it exists.
      return { visible: reach.institutionWide === true, actionable: false };
    case 'CLASS': {
      // null = institution-wide reach; [] = an empty scope that matches nothing.
      const ok = source !== null && (reach.classIds === null || reach.classIds.includes(source));
      return { visible: ok, actionable: ok };
    }
    case 'CLUB': {
      const ok =
        source !== null && (reach.institutionWide === true || reach.clubIds.includes(source));
      return { visible: ok, actionable: ok };
    }
    default:
      return { visible: false, actionable: false };
  }
}

/** Reporter identities are shown only to those who may read the audit trail. */
export function canSeeReporters(principal: Principal): boolean {
  return principal.permissions.includes(Permission.AUDIT_READ);
}
