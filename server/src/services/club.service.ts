/**
 * Clubs, membership and RULE-BASED discovery.
 *
 * Discovery here is deterministic and explainable — a set intersection on declared interests,
 * the categories a student already belongs to, and what peers in their own department joined.
 * Every suggestion carries the reason it matched, so a student can see *why* and the logic can
 * be unit-tested with plain inputs. There is no model, no scoring and no AI; AI-assisted
 * recommendations are Phase 5 and would be labelled as such rather than silently replacing this.
 */
import type { Principal } from '@campusconnect/security';
import {
  AuditAction,
  AuditResult,
  ClubMemberRole,
  ClubMembershipStatus,
  NotificationType,
  Role,
  type ClubDTO,
  type ClubMembershipDTO,
} from '@campusconnect/types';
import type { ClubMembershipDecisionInput } from '@campusconnect/validation';
import { clubMembershipRepository, clubRepository } from '../repositories/club.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { PageRequest } from '../repositories/base.repository.js';
import { Errors } from '../utils/errors.js';
import { syncClubChatMembership } from './chat.service.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import type { ClubDocument } from '../models/Club.model.js';

/** The inputs the deterministic matcher works from. Kept plain so the rules are testable. */
export interface DiscoveryProfile {
  interests: string[];
  departmentId: string | null;
  /** Categories of clubs the student is already an approved member of. */
  joinedCategories: string[];
  /** Club ids the student already has any membership row for. */
  existingClubIds: string[];
}

export interface DiscoveryCandidate {
  id: string;
  category: string;
  interests: string[];
  /** Approved members who share the student's department. */
  departmentPeerCount: number;
}

/**
 * The pure matching rule. Returns the reasons this club matched, or an empty array if it did
 * not. Order is deterministic so output is stable across runs.
 */
export function matchClubReasons(
  profile: DiscoveryProfile,
  candidate: DiscoveryCandidate,
): string[] {
  // Never suggest something the student already has a membership row for.
  if (profile.existingClubIds.includes(candidate.id)) return [];

  const reasons: string[] = [];

  const shared = candidate.interests
    .filter((interest) => profile.interests.includes(interest))
    .sort();
  for (const interest of shared) {
    reasons.push(`Matches your interest in ${interest}`);
  }

  if (profile.joinedCategories.includes(candidate.category)) {
    reasons.push(`Similar to ${candidate.category} clubs you already joined`);
  }

  if (profile.departmentId && candidate.departmentPeerCount >= 2) {
    reasons.push(`${candidate.departmentPeerCount} students from your department are members`);
  }

  return reasons;
}

async function buildDiscoveryProfile(
  institutionId: string,
  userId: string,
): Promise<DiscoveryProfile> {
  const [profile, memberships] = await Promise.all([
    studentProfileRepository.findByUserId(institutionId, userId),
    clubMembershipRepository.listForUser(institutionId, userId, [
      ClubMembershipStatus.APPROVED,
      ClubMembershipStatus.REQUESTED,
    ]),
  ]);

  const joinedClubIds = memberships.map((membership) => String(membership.clubId));
  const joinedClubs = await clubRepository.findManyByIds(institutionId, joinedClubIds);

  return {
    interests: profile?.interests ?? [],
    departmentId: profile?.departmentId ? String(profile.departmentId) : null,
    joinedCategories: [...new Set(joinedClubs.map((club) => club.category))],
    existingClubIds: joinedClubIds,
  };
}

/** How many approved members of each club share the given department. */
async function departmentPeerCounts(
  institutionId: string,
  clubs: ClubDocument[],
  departmentId: string | null,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!departmentId) return counts;

  const departmentStudents = await studentProfileRepository.listByDepartment(
    institutionId,
    departmentId,
  );
  const departmentUserIds = new Set(departmentStudents.map((profile) => String(profile.userId)));

  await Promise.all(
    clubs.map(async (club) => {
      const members = await clubMembershipRepository.listForClub(
        institutionId,
        String(club._id),
        { page: 1, limit: 200 },
        ClubMembershipStatus.APPROVED,
      );
      const peers = members.items.filter((m) => departmentUserIds.has(String(m.userId))).length;
      counts.set(String(club._id), peers);
    }),
  );

  return counts;
}

async function toClubDTO(
  institutionId: string,
  club: ClubDocument,
  userId: string,
  matchReasons: string[] = [],
): Promise<ClubDTO> {
  const membership = await clubMembershipRepository.findForUserAndClub(
    institutionId,
    String(club._id),
    userId,
  );

  return {
    id: String(club._id),
    name: club.name,
    category: club.category,
    description: club.description,
    interests: [...club.interests],
    memberCount: club.memberCount,
    membership: membership ? { status: membership.status, role: membership.role } : null,
    matchReasons,
  };
}

export async function listClubs(
  principal: Principal,
  page: PageRequest,
  options: { category?: string; search?: string; suggested?: boolean } = {},
): Promise<{ items: ClubDTO[]; total: number }> {
  const { institutionId } = principal;

  if (!options.suggested) {
    const result = await clubRepository.list(institutionId, page, {
      category: options.category,
      search: options.search,
    });
    return {
      items: await Promise.all(
        result.items.map((club) => toClubDTO(institutionId, club, principal.userId)),
      ),
      total: result.total,
    };
  }

  // Suggestion mode: rule-based, and only clubs the student is not already involved with.
  const profile = await buildDiscoveryProfile(institutionId, principal.userId);
  const all = await clubRepository.list(
    institutionId,
    { page: 1, limit: 100 },
    {
      category: options.category,
    },
  );
  const peerCounts = await departmentPeerCounts(institutionId, all.items, profile.departmentId);

  const matched = all.items
    .map((club) => ({
      club,
      reasons: matchClubReasons(profile, {
        id: String(club._id),
        category: club.category,
        interests: [...club.interests],
        departmentPeerCount: peerCounts.get(String(club._id)) ?? 0,
      }),
    }))
    .filter((entry) => entry.reasons.length > 0)
    // More reasons = a stronger deterministic match; ties broken by popularity then name.
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        b.club.memberCount - a.club.memberCount ||
        a.club.name.localeCompare(b.club.name),
    );

  const start = (page.page - 1) * page.limit;
  const pageItems = matched.slice(start, start + page.limit);

  return {
    items: await Promise.all(
      pageItems.map((entry) =>
        toClubDTO(institutionId, entry.club, principal.userId, entry.reasons),
      ),
    ),
    total: matched.length,
  };
}

export async function getClub(principal: Principal, clubId: string): Promise<ClubDTO> {
  const club = await clubRepository.findById(principal.institutionId, clubId);
  if (!club) throw Errors.notFound();
  return toClubDTO(principal.institutionId, club, principal.userId);
}

export async function requestMembership(
  principal: Principal,
  clubId: string,
  context: AuditContext,
): Promise<ClubMembershipDTO> {
  const { institutionId } = principal;

  const club = await clubRepository.findById(institutionId, clubId);
  if (!club) throw Errors.notFound();

  const existing = await clubMembershipRepository.findForUserAndClub(
    institutionId,
    clubId,
    principal.userId,
  );
  if (existing?.status === ClubMembershipStatus.APPROVED) {
    throw Errors.conflict('You are already a member of this club.');
  }
  if (existing?.status === ClubMembershipStatus.REQUESTED) {
    throw Errors.conflict('Your request is already pending.');
  }

  const membership = await clubMembershipRepository.requestJoin(
    institutionId,
    clubId,
    principal.userId,
  );
  if (!membership) throw Errors.internal();

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.CLUB_MEMBERSHIP_REQUESTED,
    resourceType: 'ClubMembership',
    resourceId: String(membership._id),
    result: AuditResult.SUCCESS,
    context,
  });

  // Club admins are the ones who can act on this.
  await notifyUsers(
    institutionId,
    club.adminUserIds.map((id) => String(id)),
    {
      type: NotificationType.CLUB,
      title: `New membership request for ${club.name}`,
      body: 'A student has asked to join your club.',
      link: `/clubs/${clubId}`,
    },
  );

  return toMembershipDTO(institutionId, membership, club.name);
}

export async function decideMembership(
  principal: Principal,
  membershipId: string,
  input: ClubMembershipDecisionInput,
  context: AuditContext,
): Promise<ClubMembershipDTO> {
  const { institutionId } = principal;

  const membership = await clubMembershipRepository.findById(institutionId, membershipId);
  if (!membership) throw Errors.notFound();

  const club = await clubRepository.findById(institutionId, membership.clubId);
  if (!club) throw Errors.notFound();

  // Only this club's admins (or a system admin) may decide.
  const isClubAdmin = club.adminUserIds.some((id) => String(id) === principal.userId);
  if (!isClubAdmin && !principal.roles.includes(Role.SYSTEM_ADMIN)) throw Errors.forbidden();

  const decided = await clubMembershipRepository.decide(
    institutionId,
    membershipId,
    input.decision,
    principal.userId,
  );
  if (!decided) throw Errors.conflict('This request has already been decided.');

  if (input.decision === ClubMembershipStatus.APPROVED) {
    await clubRepository.adjustMemberCount(institutionId, String(club._id), 1);
  }

  // The club chat's membership is derived from this decision, so it is re-synced here rather
  // than waiting for someone to open the chat: approval grants access, rejection revokes it.
  await syncClubChatMembership(institutionId, String(club._id));

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.CLUB_MEMBERSHIP_DECIDED,
    resourceType: 'ClubMembership',
    resourceId: String(decided._id),
    result: AuditResult.SUCCESS,
    context,
    reason: `${input.decision} for club ${club.name}`,
  });

  await notifyUsers(institutionId, [String(decided.userId)], {
    type: NotificationType.CLUB,
    title:
      input.decision === ClubMembershipStatus.APPROVED
        ? `You joined ${club.name}`
        : `Your request to join ${club.name} was declined`,
    body:
      input.decision === ClubMembershipStatus.APPROVED
        ? 'Your membership request was approved.'
        : 'Your membership request was not approved.',
    link: `/clubs/${String(club._id)}`,
  });

  return toMembershipDTO(institutionId, decided, club.name);
}

/**
 * Leave a club (or withdraw a pending request).
 *
 * The club chat's membership is derived from this one, so it is re-synced immediately: leaving
 * the club takes the club chat — and its attachments — with it on the very next request.
 * A club admin must hand the club over first; an admin-less club would be unmanageable.
 */
export async function leaveClub(
  principal: Principal,
  clubId: string,
  context: AuditContext,
): Promise<{ status: 'LEFT' }> {
  const { institutionId, userId } = principal;

  const club = await clubRepository.findById(institutionId, clubId);
  if (!club) throw Errors.notFound();
  if (club.adminUserIds.some((id) => String(id) === userId)) {
    throw Errors.conflict(
      'Club admins cannot leave their club. Ask a system administrator to hand it over first.',
    );
  }

  const previous = await clubMembershipRepository.leave(institutionId, clubId, userId);
  // Not a member, never asked, or already left: nothing to leave.
  if (!previous) throw Errors.notFound();

  if (previous.status === ClubMembershipStatus.APPROVED) {
    await clubRepository.adjustMemberCount(institutionId, clubId, -1);
  }
  await syncClubChatMembership(institutionId, clubId);

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.CLUB_MEMBERSHIP_LEFT,
    resourceType: 'ClubMembership',
    resourceId: String(previous._id),
    result: AuditResult.SUCCESS,
    context,
    reason: previous.status === ClubMembershipStatus.APPROVED ? 'LEFT' : 'REQUEST_WITHDRAWN',
  });

  return { status: 'LEFT' };
}

export async function listClubMembers(
  principal: Principal,
  clubId: string,
  page: PageRequest,
  status?: ClubMembershipStatus,
): Promise<{ items: ClubMembershipDTO[]; total: number }> {
  const { institutionId } = principal;

  const club = await clubRepository.findById(institutionId, clubId);
  if (!club) throw Errors.notFound();

  const isClubAdmin = club.adminUserIds.some((id) => String(id) === principal.userId);
  // Pending requests are only visible to the people who can act on them.
  if (
    status === ClubMembershipStatus.REQUESTED &&
    !isClubAdmin &&
    !principal.roles.includes(Role.SYSTEM_ADMIN)
  ) {
    throw Errors.forbidden();
  }

  const result = await clubMembershipRepository.listForClub(institutionId, clubId, page, status);
  return {
    items: await Promise.all(result.items.map((m) => toMembershipDTO(institutionId, m, club.name))),
    total: result.total,
  };
}

async function toMembershipDTO(
  institutionId: string,
  membership: {
    _id: unknown;
    clubId: unknown;
    userId: unknown;
    role: ClubMemberRole;
    status: ClubMembershipStatus;
    createdAt: Date;
  },
  clubName: string,
): Promise<ClubMembershipDTO> {
  const user = await userRepository.findById(institutionId, String(membership.userId));
  return {
    id: String(membership._id),
    clubId: String(membership.clubId),
    clubName,
    userId: String(membership.userId),
    userFullName: user?.fullName ?? 'Unknown',
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt.toISOString(),
  };
}
