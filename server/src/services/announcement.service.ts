/**
 * Announcements.
 *
 * Two independent checks run on every publish:
 *  1. the route confirms the caller holds `announcement:create` at all;
 *  2. `assertCanAnnounceTo` confirms they may address THAT audience — a faculty member cannot
 *     publish college-wide, an HOD cannot publish to another department, a club admin cannot
 *     publish to a club they do not run.
 *
 * Reading is the mirror image: the audience filter is built from who the reader is, so a reader
 * can never see an announcement that was not addressed to them.
 */
import type { Principal } from '@campusconnect/security';
import {
  LinkedResourceType,
  type AttachmentDTO,
  AnnouncementPriority,
  AnnouncementScope,
  AuditAction,
  AuditResult,
  NotificationType,
  Role,
  type AnnouncementDTO,
} from '@campusconnect/types';
import { Types } from 'mongoose';
import type { CreateAnnouncementInput } from '@campusconnect/validation';
import { announcementRepository } from '../repositories/announcement.repository.js';
import { clubRepository, clubMembershipRepository } from '../repositories/club.repository.js';
import { departmentRepository } from '../repositories/institution.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { requireObjectId, type PageRequest } from '../repositories/base.repository.js';
import { Errors } from '../utils/errors.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { buildAudienceContext, resolveAcademicScope } from './scope.service.js';
import type { AnnouncementDocument } from '../models/Announcement.model.js';
import {
  attachmentsFor,
  linkFiles,
  registerLinkedResourceReader,
  unlinkFiles,
} from './file.service.js';

/** Recipients notified per announcement. Beyond this the feed still shows it to everyone. */
const NOTIFICATION_FANOUT_CAP = 500;

/**
 * May this principal address this audience?
 *
 * Fails closed: an unrecognised combination is a denial, never a default-allow.
 */
async function assertCanAnnounceTo(
  principal: Principal,
  target: CreateAnnouncementInput['target'],
): Promise<void> {
  const { institutionId, roles } = principal;

  if (roles.includes(Role.SYSTEM_ADMIN)) return;
  const isPrincipal = roles.includes(Role.PRINCIPAL);

  switch (target.scope) {
    case AnnouncementScope.COLLEGE:
    case AnnouncementScope.ROLE:
      // Institution-wide reach belongs to the principal only.
      if (!isPrincipal) throw Errors.forbidden();
      return;

    case AnnouncementScope.DEPARTMENT: {
      if (isPrincipal) return;
      if (!roles.includes(Role.HOD)) throw Errors.forbidden();

      const headed = await departmentRepository.listHeadedBy(institutionId, principal.userId);
      const ownsDepartment = headed.some((d) => String(d._id) === target.departmentId);
      if (!ownsDepartment) throw Errors.forbidden();
      return;
    }

    case AnnouncementScope.BATCH:
    case AnnouncementScope.SECTION: {
      if (isPrincipal || roles.includes(Role.HOD)) return;
      if (!roles.includes(Role.FACULTY) && !roles.includes(Role.CLASS_MENTOR)) {
        throw Errors.forbidden();
      }

      // A mentor/faculty member must actually reach that section.
      const scope = await resolveAcademicScope(principal);
      if (target.scope === AnnouncementScope.SECTION) {
        const owns = scope.sections.some(
          (s) =>
            s.batch === target.batch && s.section.toUpperCase() === target.section?.toUpperCase(),
        );
        if (!owns) throw Errors.forbidden();
      }
      return;
    }

    case AnnouncementScope.CLUB: {
      if (isPrincipal) throw Errors.forbidden();
      if (!target.clubId) throw Errors.forbidden();

      const club = await clubRepository.findById(institutionId, target.clubId);
      if (!club) throw Errors.notFound();

      const isClubAdmin = club.adminUserIds.some((id) => String(id) === principal.userId);
      if (!isClubAdmin) throw Errors.forbidden();
      return;
    }

    case AnnouncementScope.HOSTEL: {
      if (isPrincipal || roles.includes(Role.HOSTEL_WARDEN)) return;
      throw Errors.forbidden();
    }

    default:
      // Unknown scope: deny rather than guess.
      throw Errors.forbidden();
  }
}

/** Resolve who should be notified about a new announcement (capped). */
async function resolveRecipients(
  institutionId: string,
  target: CreateAnnouncementInput['target'],
): Promise<string[]> {
  switch (target.scope) {
    case AnnouncementScope.SECTION: {
      if (!target.batch || !target.section) return [];
      const roster = await studentProfileRepository.listBySection(
        institutionId,
        target.batch,
        target.section,
      );
      return roster.map((profile) => String(profile.userId));
    }

    case AnnouncementScope.BATCH: {
      const all = await studentProfileRepository.listAll(institutionId);
      return all
        .filter((profile) => profile.batch === target.batch)
        .map((profile) => String(profile.userId));
    }

    case AnnouncementScope.DEPARTMENT: {
      if (!target.departmentId) return [];
      const roster = await studentProfileRepository.listByDepartment(
        institutionId,
        target.departmentId,
      );
      return roster.map((profile) => String(profile.userId));
    }

    case AnnouncementScope.CLUB: {
      if (!target.clubId) return [];
      const memberships = await clubMembershipRepository.listForClub(institutionId, target.clubId, {
        page: 1,
        limit: NOTIFICATION_FANOUT_CAP,
      });
      return memberships.items.map((membership) => String(membership.userId));
    }

    case AnnouncementScope.ROLE: {
      const users = await userRepository.listUsers(
        institutionId,
        { page: 1, limit: NOTIFICATION_FANOUT_CAP },
        target.role ? { role: target.role } : {},
      );
      return users.items.map((user) => String(user._id));
    }

    case AnnouncementScope.COLLEGE:
    default: {
      const users = await userRepository.listUsers(institutionId, {
        page: 1,
        limit: NOTIFICATION_FANOUT_CAP,
      });
      return users.items.map((user) => String(user._id));
    }
  }
}

function toAnnouncementDTO(
  announcement: AnnouncementDocument,
  readerUserId: string,
  authorNames: Map<string, string>,
  attachments: AttachmentDTO[] = [],
): AnnouncementDTO {
  return {
    id: String(announcement._id),
    title: announcement.title,
    body: announcement.body,
    priority: announcement.priority,
    target: {
      scope: announcement.target.scope,
      departmentId: announcement.target.departmentId
        ? String(announcement.target.departmentId)
        : null,
      batch: announcement.target.batch ?? null,
      section: announcement.target.section ?? null,
      clubId: announcement.target.clubId ? String(announcement.target.clubId) : null,
      role: announcement.target.role ?? null,
    },
    author: {
      userId: String(announcement.authorUserId),
      fullName: authorNames.get(String(announcement.authorUserId)) ?? 'Unknown',
    },
    publishAt: announcement.publishAt.toISOString(),
    expireAt: announcement.expireAt ? announcement.expireAt.toISOString() : null,
    read: announcement.readBy.some((id) => String(id) === readerUserId),
    attachments,
    createdAt: announcement.createdAt.toISOString(),
  };
}

/** Attachment metadata for announcements, each in the order its author attached them. */
async function announcementAttachments(
  institutionId: string,
  announcements: readonly AnnouncementDocument[],
): Promise<Map<string, AttachmentDTO[]>> {
  const withFiles = announcements.filter((row) => (row.attachmentFileIds ?? []).length > 0);
  if (withFiles.length === 0) return new Map();
  const byId = await attachmentsFor(
    institutionId,
    LinkedResourceType.ANNOUNCEMENT,
    withFiles.map((row) => String(row._id)),
  );
  for (const row of withFiles) {
    const order = row.attachmentFileIds.map(String);
    byId.get(String(row._id))?.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  return byId;
}

export async function createAnnouncement(
  principal: Principal,
  input: CreateAnnouncementInput,
  context: AuditContext,
): Promise<AnnouncementDTO> {
  const { institutionId } = principal;

  await assertCanAnnounceTo(principal, input.target);

  // Files are linked to a pre-allocated id first, all or nothing: an announcement is never
  // stored pointing at a file its author could not attach.
  const fileIds = input.attachmentFileIds ?? [];
  const announcementId = new Types.ObjectId();
  const resource = { type: LinkedResourceType.ANNOUNCEMENT, id: announcementId };
  await linkFiles(principal, fileIds, resource);

  let announcement: AnnouncementDocument;
  try {
    announcement = await announcementRepository.create({
      id: announcementId,
      attachmentFileIds: fileIds,
      institutionId,
      authorUserId: principal.userId,
      title: input.title,
      body: input.body,
      priority: input.priority ?? AnnouncementPriority.NORMAL,
      target: {
        scope: input.target.scope,
        departmentId: input.target.departmentId ? requireObjectId(input.target.departmentId) : null,
        batch: input.target.batch ?? null,
        section: input.target.section ?? null,
        clubId: input.target.clubId ? requireObjectId(input.target.clubId) : null,
        role: input.target.role ?? null,
      },
      publishAt: input.publishAt ?? new Date(),
      expireAt: input.expireAt ?? null,
    });
  } catch (err) {
    await unlinkFiles(institutionId, fileIds, resource);
    throw err;
  }

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.ANNOUNCEMENT_CREATED,
    resourceType: 'Announcement',
    resourceId: String(announcement._id),
    result: AuditResult.SUCCESS,
    context,
    reason: `scope=${input.target.scope} priority=${announcement.priority}`,
  });

  // Scheduled announcements notify when they go live, not when they are drafted.
  if (announcement.publishAt <= new Date()) {
    const recipients = await resolveRecipients(institutionId, input.target);
    await notifyUsers(
      institutionId,
      recipients.filter((id) => id !== principal.userId),
      {
        type: NotificationType.ANNOUNCEMENT,
        title: announcement.title,
        body: `New ${announcement.priority.toLowerCase()} priority announcement.`,
        link: `/announcements/${String(announcement._id)}`,
      },
    );
  }

  const authorNames = new Map([[principal.userId, 'You']]);
  const attachments = await announcementAttachments(institutionId, [announcement]);
  return toAnnouncementDTO(
    announcement,
    principal.userId,
    authorNames,
    attachments.get(String(announcement._id)),
  );
}

export async function listAnnouncements(
  principal: Principal,
  page: PageRequest,
  options: { unreadOnly?: boolean; priority?: AnnouncementPriority; search?: string } = {},
): Promise<{ items: AnnouncementDTO[]; total: number }> {
  const { institutionId } = principal;
  const audience = await buildAudienceContext(principal);

  const result = await announcementRepository.listForAudience(
    institutionId,
    audience,
    page,
    options,
  );

  const users = await userRepository.listUsers(institutionId, { page: 1, limit: 300 });
  const authorNames = new Map(users.items.map((user) => [String(user._id), user.fullName]));

  const attachments = await announcementAttachments(institutionId, result.items);

  return {
    items: await Promise.all(
      result.items.map((row) =>
        toAnnouncementDTO(row, principal.userId, authorNames, attachments.get(String(row._id))),
      ),
    ),
    total: result.total,
  };
}

/** Detail view. Reading marks it read, which is what "read/unread" means to a user. */
export async function getAnnouncement(
  principal: Principal,
  announcementId: string,
): Promise<AnnouncementDTO> {
  const { institutionId } = principal;
  const audience = await buildAudienceContext(principal);

  // Not addressed to this reader → indistinguishable from not existing.
  const addressed = await announcementRepository.isAddressedTo(
    institutionId,
    announcementId,
    audience,
  );
  if (!addressed) throw Errors.notFound();

  const announcement = await announcementRepository.findById(institutionId, announcementId);
  if (!announcement) throw Errors.notFound();

  await announcementRepository.markRead(institutionId, announcementId, principal.userId);

  const author = await userRepository.findById(institutionId, announcement.authorUserId);
  const authorNames = new Map(author ? [[String(author._id), author.fullName]] : []);

  const attachments = await announcementAttachments(institutionId, [announcement]);
  const dto = toAnnouncementDTO(
    announcement,
    principal.userId,
    authorNames,
    attachments.get(announcementId),
  );
  // Reflect the read we just performed rather than the pre-read snapshot.
  return { ...dto, read: true };
}

export async function markAnnouncementRead(
  principal: Principal,
  announcementId: string,
): Promise<void> {
  const audience = await buildAudienceContext(principal);
  const addressed = await announcementRepository.isAddressedTo(
    principal.institutionId,
    announcementId,
    audience,
  );
  if (!addressed) throw Errors.notFound();

  await announcementRepository.markRead(principal.institutionId, announcementId, principal.userId);
}

/**
 * Announcements' answer to "may this principal open a file attached to this one?": exactly when
 * the announcement is addressed to them (evaluated now, against who they are now), or they
 * wrote it.
 */
registerLinkedResourceReader(LinkedResourceType.ANNOUNCEMENT, async (principal, resource) => {
  const announcement = await announcementRepository.findById(principal.institutionId, resource.id);
  if (!announcement) return false;
  if (String(announcement.authorUserId) === principal.userId) return true;
  const audience = await buildAudienceContext(principal);
  return announcementRepository.isAddressedTo(
    principal.institutionId,
    String(resource.id),
    audience,
  );
});
