/**
 * Events: discovery, registration and QR check-in.
 *
 * Check-in reuses the Phase 2 `QRToken` rather than inventing an event-specific code. The token
 * stays opaque, single-use and short-lived, and the purpose check means a student-ID code cannot
 * be presented at an event scanner. Identity is resolved server-side from the token; the scanner
 * never learns anything the server did not hand it.
 *
 * Recommendations are RULE-BASED (category overlap with declared interests, plus events from
 * clubs the student belongs to) and carry their reasons. No AI — that is Phase 5.
 */
import type { Principal } from '@campusconnect/security';
import {
  AuditAction,
  AuditResult,
  ClubMembershipStatus,
  EventRegistrationStatus,
  EventStatus,
  NotificationType,
  QRPurpose,
  Role,
  type EventDTO,
  type EventRegistrationDTO,
  type QRIssueDTO,
} from '@campusconnect/types';
import type { CreateEventInput } from '@campusconnect/validation';
import { eventRegistrationRepository, eventRepository } from '../repositories/event.repository.js';
import { clubMembershipRepository, clubRepository } from '../repositories/club.repository.js';
import { departmentRepository } from '../repositories/institution.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import type { PageRequest } from '../repositories/base.repository.js';
import { Errors } from '../utils/errors.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { issueQrToken, verifyQrToken } from './qr.service.js';
import type { EventDocument } from '../models/Event.model.js';

/** Pure rule: why (if at all) this event is suggested to this student. */
export function matchEventReasons(
  profile: { interests: string[]; clubIds: string[] },
  candidate: { category: string; clubId: string | null },
): string[] {
  const reasons: string[] = [];

  if (profile.interests.includes(candidate.category.toLowerCase())) {
    reasons.push(`Matches your interest in ${candidate.category.toLowerCase()}`);
  }
  if (candidate.clubId && profile.clubIds.includes(candidate.clubId)) {
    reasons.push('Hosted by a club you belong to');
  }

  return reasons;
}

async function organizerName(institutionId: string, event: EventDocument): Promise<string> {
  if (event.organizerType === 'CLUB' && event.clubId) {
    const club = await clubRepository.findById(institutionId, event.clubId);
    return club?.name ?? 'Unknown club';
  }
  if (event.departmentId) {
    const department = await departmentRepository.findById(institutionId, event.departmentId);
    return department?.name ?? 'Unknown department';
  }
  return 'Campus';
}

async function toEventDTO(
  institutionId: string,
  event: EventDocument,
  userId: string,
  matchReasons: string[] = [],
): Promise<EventDTO> {
  const [registration, name] = await Promise.all([
    eventRegistrationRepository.findForUserAndEvent(institutionId, String(event._id), userId),
    organizerName(institutionId, event),
  ]);

  return {
    id: String(event._id),
    title: event.title,
    description: event.description,
    category: event.category,
    venue: event.venue,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    capacity: event.capacity ?? null,
    registeredCount: event.registeredCount,
    seatsRemaining: event.capacity === null || event.capacity === undefined
      ? null
      : Math.max(0, event.capacity - event.registeredCount),
    status: event.status,
    organizer: {
      type: event.organizerType,
      id: event.clubId ? String(event.clubId) : event.departmentId ? String(event.departmentId) : null,
      name,
    },
    registration:
      registration && registration.status !== EventRegistrationStatus.CANCELLED
        ? {
            status: registration.status,
            checkedInAt: registration.checkInAt ? registration.checkInAt.toISOString() : null,
          }
        : null,
    matchReasons,
  };
}

export async function listEvents(
  principal: Principal,
  page: PageRequest,
  options: {
    category?: string;
    status?: EventStatus;
    search?: string;
    upcomingOnly?: boolean;
    suggested?: boolean;
  } = {},
): Promise<{ items: EventDTO[]; total: number }> {
  const { institutionId } = principal;

  if (!options.suggested) {
    const result = await eventRepository.list(institutionId, page, {
      category: options.category,
      status: options.status,
      search: options.search,
      upcomingOnly: options.upcomingOnly,
    });
    return {
      items: await Promise.all(
        result.items.map((event) => toEventDTO(institutionId, event, principal.userId)),
      ),
      total: result.total,
    };
  }

  const [profile, memberships] = await Promise.all([
    studentProfileRepository.findByUserId(institutionId, principal.userId),
    clubMembershipRepository.listForUser(institutionId, principal.userId, [ClubMembershipStatus.APPROVED]),
  ]);

  const discovery = {
    interests: profile?.interests ?? [],
    clubIds: memberships.map((membership) => String(membership.clubId)),
  };

  // Only upcoming events are worth suggesting.
  const candidates = await eventRepository.list(
    institutionId,
    { page: 1, limit: 100 },
    { upcomingOnly: true, status: EventStatus.PUBLISHED },
  );

  const matched = candidates.items
    .map((event) => ({
      event,
      reasons: matchEventReasons(discovery, {
        category: event.category,
        clubId: event.clubId ? String(event.clubId) : null,
      }),
    }))
    .filter((entry) => entry.reasons.length > 0)
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        a.event.startsAt.getTime() - b.event.startsAt.getTime(),
    );

  const start = (page.page - 1) * page.limit;
  return {
    items: await Promise.all(
      matched
        .slice(start, start + page.limit)
        .map((entry) => toEventDTO(institutionId, entry.event, principal.userId, entry.reasons)),
    ),
    total: matched.length,
  };
}

export async function getEvent(principal: Principal, eventId: string): Promise<EventDTO> {
  const event = await eventRepository.findById(principal.institutionId, eventId);
  if (!event) throw Errors.notFound();
  return toEventDTO(principal.institutionId, event, principal.userId);
}

/** Creating for a club requires being that club's admin; departments require staff authority. */
async function assertCanOrganize(
  principal: Principal,
  organizer: CreateEventInput['organizer'],
): Promise<void> {
  if (principal.roles.includes(Role.SYSTEM_ADMIN) || principal.roles.includes(Role.PRINCIPAL)) return;

  if (organizer.type === 'CLUB') {
    if (!organizer.clubId) throw Errors.forbidden();
    const club = await clubRepository.findById(principal.institutionId, organizer.clubId);
    if (!club) throw Errors.notFound();
    const isClubAdmin = club.adminUserIds.some((id) => String(id) === principal.userId);
    if (!isClubAdmin) throw Errors.forbidden();
    return;
  }

  // Department events: teaching staff only.
  const staffRoles: readonly Role[] = [Role.FACULTY, Role.CLASS_MENTOR, Role.HOD];
  if (!principal.roles.some((role) => staffRoles.includes(role))) throw Errors.forbidden();
}

export async function createEvent(
  principal: Principal,
  input: CreateEventInput,
  context: AuditContext,
): Promise<EventDTO> {
  const { institutionId } = principal;
  await assertCanOrganize(principal, input.organizer);

  const event = await eventRepository.create({
    institutionId,
    title: input.title,
    description: input.description,
    category: input.category,
    venue: input.venue,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    capacity: input.capacity ?? null,
    organizerType: input.organizer.type,
    clubId: input.organizer.clubId ?? null,
    departmentId: input.organizer.departmentId ?? null,
    createdByUserId: principal.userId,
  });

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.EVENT_CREATED,
    resourceType: 'Event',
    resourceId: String(event._id),
    result: AuditResult.SUCCESS,
    context,
  });

  // Club events are announced to that club's members.
  if (input.organizer.type === 'CLUB' && input.organizer.clubId) {
    const members = await clubMembershipRepository.listForClub(
      institutionId,
      input.organizer.clubId,
      { page: 1, limit: 500 },
      ClubMembershipStatus.APPROVED,
    );
    await notifyUsers(
      institutionId,
      members.items.map((m) => String(m.userId)),
      {
        type: NotificationType.EVENT,
        title: `New event: ${event.title}`,
        body: `${event.venue} · ${event.startsAt.toDateString()}`,
        link: `/events/${String(event._id)}`,
      },
    );
  }

  return toEventDTO(institutionId, event, principal.userId);
}

export async function registerForEvent(
  principal: Principal,
  eventId: string,
  context: AuditContext,
): Promise<EventRegistrationDTO> {
  const { institutionId } = principal;

  const event = await eventRepository.findById(institutionId, eventId);
  if (!event) throw Errors.notFound();
  if (event.status !== EventStatus.PUBLISHED) {
    throw Errors.conflict('Registration is not open for this event.');
  }
  if (event.endsAt < new Date()) throw Errors.conflict('This event has already ended.');

  const existing = await eventRegistrationRepository.findForUserAndEvent(institutionId, eventId, principal.userId);
  if (existing && existing.status !== EventRegistrationStatus.CANCELLED) {
    throw Errors.conflict('You are already registered for this event.');
  }

  // Take the seat first: the conditional increment is what makes capacity race-free.
  const reserved = await eventRepository.reserveSeat(institutionId, eventId);
  if (!reserved) throw Errors.conflict('This event is full.');

  let registration;
  try {
    registration = await eventRegistrationRepository.create({
      institutionId,
      eventId,
      userId: principal.userId,
    });
  } catch (err) {
    // Give the seat back if the registration row could not be written.
    await eventRepository.releaseSeat(institutionId, eventId);
    if ((err as { code?: number }).code === 11000) {
      throw Errors.conflict('You are already registered for this event.');
    }
    throw err;
  }

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.EVENT_REGISTERED,
    resourceType: 'EventRegistration',
    resourceId: String(registration._id),
    result: AuditResult.SUCCESS,
    context,
  });

  return {
    id: String(registration._id),
    eventId,
    eventTitle: event.title,
    userId: principal.userId,
    status: registration.status,
    checkInAt: null,
    createdAt: registration.createdAt.toISOString(),
  };
}

/** Mint the check-in code a registered attendee shows at the door. */
export async function issueEventCheckInQr(
  principal: Principal,
  eventId: string,
  context: AuditContext,
): Promise<QRIssueDTO> {
  const { institutionId } = principal;

  const event = await eventRepository.findById(institutionId, eventId);
  if (!event) throw Errors.notFound();

  const registration = await eventRegistrationRepository.findForUserAndEvent(
    institutionId,
    eventId,
    principal.userId,
  );
  if (!registration || registration.status === EventRegistrationStatus.CANCELLED) {
    throw Errors.notFound();
  }
  if (registration.status === EventRegistrationStatus.CHECKED_IN) {
    throw Errors.conflict('You have already checked in.');
  }

  return issueQrToken(
    institutionId,
    principal.userId,
    principal.userId,
    QRPurpose.EVENT_CHECKIN,
    context,
  );
}

export interface EventCheckInResult {
  eventId: string;
  eventTitle: string;
  attendee: { userId: string; fullName: string; rollNo: string | null };
  checkedInAt: string;
}

/**
 * Check an attendee in from a scanned code.
 *
 * The token is validated for tenant, expiry, single use AND purpose before anything is written.
 * A replayed code fails at the single-use claim inside `verifyQrToken`, so the second scan of
 * the same code is rejected without reaching the registration.
 */
export async function checkInWithQr(
  principal: Principal,
  eventId: string,
  token: string,
  context: AuditContext,
): Promise<EventCheckInResult> {
  const { institutionId } = principal;

  const event = await eventRepository.findById(institutionId, eventId);
  if (!event) throw Errors.notFound();

  const verified = await verifyQrToken(
    institutionId,
    principal.userId,
    token,
    context,
    QRPurpose.EVENT_CHECKIN,
  );

  const registration = await eventRegistrationRepository.checkIn(
    institutionId,
    eventId,
    verified.subject.userId,
    principal.userId,
  );
  // Either not registered for THIS event, or already checked in.
  if (!registration) throw Errors.conflict('No open registration for this attendee.');

  await recordAudit({
    institutionId,
    actorUserId: principal.userId,
    action: AuditAction.EVENT_CHECKED_IN,
    resourceType: 'EventRegistration',
    resourceId: String(registration._id),
    result: AuditResult.SUCCESS,
    context,
    reason: `event=${String(event._id)}`,
  });

  return {
    eventId: String(event._id),
    eventTitle: event.title,
    attendee: {
      userId: verified.subject.userId,
      fullName: verified.subject.fullName,
      rollNo: verified.subject.rollNo,
    },
    checkedInAt: registration.checkInAt ? registration.checkInAt.toISOString() : new Date().toISOString(),
  };
}

export async function listMyRegistrations(
  principal: Principal,
  page: PageRequest,
): Promise<{ items: EventRegistrationDTO[]; total: number }> {
  const { institutionId } = principal;
  const result = await eventRegistrationRepository.listForUser(institutionId, principal.userId, page);

  const events = await eventRepository.findManyByIds(
    institutionId,
    result.items.map((registration) => String(registration.eventId)),
  );
  const titleByEventId = new Map(events.map((event) => [String(event._id), event.title]));

  return {
    items: result.items.map((registration) => ({
      id: String(registration._id),
      eventId: String(registration.eventId),
      eventTitle: titleByEventId.get(String(registration.eventId)) ?? 'Unknown event',
      userId: String(registration.userId),
      status: registration.status,
      checkInAt: registration.checkInAt ? registration.checkInAt.toISOString() : null,
      createdAt: registration.createdAt.toISOString(),
    })),
    total: result.total,
  };
}
