/**
 * Role dashboards (Phase 3 completion).
 *
 * Each dashboard is gated on the ROLE it belongs to (a student asking for the HOD dashboard is
 * AUTHORIZATION_DENIED, the platform's convention for a same-tenant capability you do not
 * have), and then narrowed to the caller's SCOPE through the existing resolvers — so a mentor
 * with no section, or an HOD with no department, gets an empty dashboard rather than a wider
 * one. Every list is capped. Attendance follows the SUM/SUM contract via `summarize`.
 */
import {
  ATTENDANCE_WARNING_THRESHOLD,
  AnnouncementScope,
  ClubMembershipStatus,
  CorrectionStatus,
  Role,
  type AttendanceFigure,
  type ClubAdminDashboardDTO,
  type DashboardClassSlot,
  type DashboardStudentRow,
  type FacultyDashboardDTO,
  type HodDashboardDTO,
  type MentorDashboardDTO,
  type PrincipalDashboardDTO,
  type StudentDashboardDTO,
  type TimetableDTO,
} from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import { AnnouncementModel } from '../models/Announcement.model.js';
import { dashboardRepository, type Counts } from '../repositories/dashboard.repository.js';
import {
  attendanceCorrectionRepository,
  attendanceRepository,
  normalizeAttendanceDate,
} from '../repositories/attendance.repository.js';
import { classRepository, subjectRepository } from '../repositories/academics.repository.js';
import { clubMembershipRepository, clubRepository } from '../repositories/club.repository.js';
import { departmentRepository } from '../repositories/institution.repository.js';
import { eventRepository } from '../repositories/event.repository.js';
import {
  facultyProfileRepository,
  studentProfileRepository,
} from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { Errors } from '../utils/errors.js';
import { getTimetable } from './academics.service.js';
import {
  getAttendanceOverview,
  listCorrectionsForReviewer,
  summarize,
} from './attendance.service.js';
import { listAnnouncements } from './announcement.service.js';
import { listChats } from './chat.service.js';
import { listMyRegistrations } from './event.service.js';
import { listQueue } from './moderation.service.js';
import { unreadNotificationCount } from './notification.service.js';

const LIST_CAP = 10;
const SHORT_CAP = 5;
const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function requireRole(principal: Principal, roles: readonly Role[]): void {
  if (!principal.roles.some((role) => roles.includes(role))) throw Errors.forbidden();
}

function figure(counts: Counts): AttendanceFigure {
  const { present, total, percentage, belowThreshold } = summarize(counts.present, counts.total);
  return { present, total, percentage, belowThreshold };
}

async function safeTimetable(
  principal: Principal,
  scope: 'SECTION' | 'FACULTY',
): Promise<TimetableDTO | null> {
  try {
    return await getTimetable(principal, { scope });
  } catch {
    return null;
  }
}

function todaySlots(timetable: TimetableDTO | null, now: Date): DashboardClassSlot[] {
  const day = DAY_KEYS[now.getDay()];
  return (timetable?.entries ?? [])
    .filter((entry) => entry.day === day)
    .sort((a, b) => a.period - b.period)
    .map((entry) => ({
      period: entry.period,
      classId: entry.classId,
      subject: { code: entry.subject.code, name: entry.subject.name },
      room: entry.room,
    }));
}

/** Names and roll numbers for a set of students, in one pass each. */
async function studentRows(
  institutionId: string,
  buckets: Array<{ key: string | null; present: number; total: number }>,
): Promise<DashboardStudentRow[]> {
  const userIds = buckets.map((bucket) => bucket.key).filter((key): key is string => key !== null);
  const [profiles, users] = await Promise.all([
    studentProfileRepository.findManyByUserIds(institutionId, userIds),
    Promise.all(userIds.map((id) => userRepository.findById(institutionId, id))),
  ]);
  const rollByUser = new Map(profiles.map((profile) => [String(profile.userId), profile.rollNo]));
  const nameByUser = new Map(
    users.filter((user) => user !== null).map((user) => [String(user?._id), user?.fullName ?? '']),
  );
  return buckets
    .filter((bucket) => bucket.key !== null)
    .map((bucket) => ({
      userId: bucket.key as string,
      fullName: nameByUser.get(bucket.key as string) ?? 'Unknown',
      rollNo: rollByUser.get(bucket.key as string) ?? null,
      attendance: figure(bucket),
    }));
}

/** Students below the threshold within a set of classes, worst first, capped. */
async function lowAttendanceIn(
  institutionId: string,
  classIds: string[] | null,
): Promise<DashboardStudentRow[]> {
  const buckets = await attendanceRepository.countsByStudent(institutionId, classIds);
  const low = buckets
    .filter((bucket) => summarize(bucket.present, bucket.total).belowThreshold)
    .sort((a, b) => a.present / a.total - b.present / b.total)
    .slice(0, LIST_CAP);
  return studentRows(institutionId, low);
}

async function pendingCorrectionsIn(
  institutionId: string,
  classIds: string[] | null,
): Promise<number> {
  const page = await attendanceCorrectionRepository.listForReviewer(
    institutionId,
    { page: 1, limit: 1 },
    classIds,
    CorrectionStatus.PENDING,
  );
  return page.total;
}

// --- Student ---------------------------------------------------------------------

export async function studentDashboard(
  principal: Principal,
  now = new Date(),
): Promise<StudentDashboardDTO> {
  requireRole(principal, [Role.STUDENT]);
  const { institutionId, userId } = principal;

  const [overview, timetable, unread, latest, registrations, memberships, notifications, chats] =
    await Promise.all([
      getAttendanceOverview(principal, undefined),
      safeTimetable(principal, 'SECTION'),
      listAnnouncements(principal, { page: 1, limit: 1 }, { unreadOnly: true }),
      listAnnouncements(principal, { page: 1, limit: SHORT_CAP }),
      listMyRegistrations(principal, { page: 1, limit: 50 }),
      clubMembershipRepository.listForUser(institutionId, userId, [ClubMembershipStatus.APPROVED]),
      unreadNotificationCount(institutionId, userId),
      listChats(principal).catch(() => []),
    ]);

  const registeredEventIds = registrations.items
    .filter((row) => row.status !== 'CANCELLED')
    .map((row) => row.eventId);
  const events = await eventRepository.findManyByIds(institutionId, registeredEventIds);
  const upcoming = events
    .filter((event) => event.startsAt >= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, SHORT_CAP)
    .map((event) => ({
      id: String(event._id),
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      venue: event.venue,
    }));

  const clubs = await clubRepository.findManyByIds(
    institutionId,
    memberships.map((row) => String(row.clubId)),
  );
  const clubName = new Map(clubs.map((club) => [String(club._id), club.name]));

  return {
    attendance: {
      overall: {
        present: overview.overall.present,
        total: overview.overall.total,
        percentage: overview.overall.percentage,
        belowThreshold: overview.overall.belowThreshold,
      },
      bySubject: overview.bySubject.map((row) => ({
        subject: row.subject ? { code: row.subject.code, name: row.subject.name } : null,
        present: row.present,
        total: row.total,
        percentage: row.percentage,
        belowThreshold: row.belowThreshold,
      })),
      threshold: overview.threshold,
    },
    today: todaySlots(timetable, now),
    announcements: {
      unread: unread.total,
      latest: latest.items.map((row) => ({
        id: row.id,
        title: row.title,
        priority: row.priority,
        publishAt: row.publishAt,
        read: row.read,
      })),
    },
    upcomingEvents: upcoming,
    clubs: memberships.slice(0, LIST_CAP).map((row) => ({
      id: String(row.clubId),
      name: clubName.get(String(row.clubId)) ?? 'Club',
      role: row.role,
    })),
    unreadNotifications: notifications,
    unreadChats: chats.reduce((sum, chat) => sum + chat.unreadCount, 0),
  };
}

// --- Faculty ---------------------------------------------------------------------

export async function facultyDashboard(
  principal: Principal,
  now = new Date(),
): Promise<FacultyDashboardDTO> {
  requireRole(principal, [Role.FACULTY, Role.CLASS_MENTOR, Role.HOD]);
  const { institutionId, userId } = principal;

  const taught = await classRepository.listTaughtBy(institutionId, userId);
  const taughtIds = taught.map((klass) => String(klass._id));
  const classById = new Map(taught.map((klass) => [String(klass._id), klass]));

  const timetable = await safeTimetable(principal, 'FACULTY');
  // The faculty timetable can list any class this person is scheduled for; keep only those they
  // actually teach, so the "to mark" count matches what they may mark.
  const slots = todaySlots(timetable, now).filter((slot) => classById.has(slot.classId));
  const marked = await dashboardRepository.markedSlots(
    institutionId,
    taughtIds,
    normalizeAttendanceDate(now),
  );

  const today = slots.map((slot) => {
    const klass = classById.get(slot.classId);
    return {
      ...slot,
      batch: klass?.batch,
      section: klass?.section,
      marked: marked.has(`${slot.classId}:${slot.period}`),
    };
  });

  const [corrections, lowAttendance] = await Promise.all([
    listCorrectionsForReviewer(principal, { page: 1, limit: SHORT_CAP }, CorrectionStatus.PENDING),
    // Only their own classes: a faculty dashboard is not the mentor's or HOD's wider view.
    lowAttendanceIn(institutionId, taughtIds),
  ]);

  return {
    today,
    pendingToMark: today.filter((slot) => !slot.marked).length,
    corrections: {
      pending: corrections.total,
      latest: corrections.items.map((row) => ({
        id: row.id,
        studentName: row.requestedByName,
        subjectCode: row.subject?.code ?? null,
        date: row.date,
        createdAt: row.createdAt,
      })),
    },
    classCount: taught.length,
    lowAttendance,
    threshold: ATTENDANCE_WARNING_THRESHOLD,
  };
}

// --- Class mentor ----------------------------------------------------------------

export async function mentorDashboard(principal: Principal): Promise<MentorDashboardDTO> {
  requireRole(principal, [Role.CLASS_MENTOR]);
  const { institutionId, userId } = principal;

  const profile = await facultyProfileRepository.findByUserId(institutionId, userId);
  const section = profile?.mentorOf ?? null;
  const empty: MentorDashboardDTO = {
    section: null,
    rosterSize: 0,
    sectionAttendance: figure({ present: 0, total: 0 }),
    lowAttendance: [],
    pendingCorrections: 0,
    recentAnnouncements: [],
    threshold: ATTENDANCE_WARNING_THRESHOLD,
  };
  // No section assigned: an empty dashboard, never a wider one.
  if (!section) return empty;

  const [roster, sectionClasses] = await Promise.all([
    studentProfileRepository.listBySection(institutionId, section.batch, section.section),
    classRepository.listInSections(institutionId, [
      { batch: section.batch, section: section.section },
    ]),
  ]);
  const rosterIds = roster.map((row) => String(row.userId));
  const classIds = sectionClasses.map((klass) => String(klass._id));

  const [counts, lowAttendance, pendingCorrections, announcements] = await Promise.all([
    dashboardRepository.attendanceForStudents(institutionId, rosterIds),
    lowAttendanceIn(institutionId, classIds),
    pendingCorrectionsIn(institutionId, classIds),
    AnnouncementModel.find({
      institutionId,
      'target.scope': AnnouncementScope.SECTION,
      'target.section': section.section,
      $or: [{ 'target.batch': section.batch }, { 'target.batch': null }],
      publishAt: { $lte: new Date() },
    })
      .sort({ publishAt: -1 })
      .limit(SHORT_CAP)
      .lean()
      .exec(),
  ]);

  return {
    section: { batch: section.batch, section: section.section },
    rosterSize: roster.length,
    sectionAttendance: figure(counts),
    lowAttendance,
    pendingCorrections,
    recentAnnouncements: announcements.map((row) => ({
      id: String(row._id),
      title: row.title,
      publishAt: row.publishAt.toISOString(),
    })),
    threshold: ATTENDANCE_WARNING_THRESHOLD,
  };
}

// --- HOD -------------------------------------------------------------------------

export async function hodDashboard(
  principal: Principal,
  now = new Date(),
): Promise<HodDashboardDTO> {
  requireRole(principal, [Role.HOD]);
  const { institutionId, userId } = principal;

  let departments = await departmentRepository.listHeadedBy(institutionId, userId);
  if (departments.length === 0) {
    const profile = await facultyProfileRepository.findByUserId(institutionId, userId);
    const own = profile?.departmentId
      ? await departmentRepository.findById(institutionId, profile.departmentId)
      : null;
    departments = own ? [own] : [];
  }
  const department = departments[0] ?? null;
  if (!department) {
    return {
      department: null,
      attendance: figure({ present: 0, total: 0 }),
      byClass: [],
      faculty: [],
      upcomingEvents: [],
      pendingCorrections: 0,
      threshold: ATTENDANCE_WARNING_THRESHOLD,
    };
  }

  const departmentId = String(department._id);
  const classes = await classRepository.listInDepartments(institutionId, [departmentId]);
  const classIds = classes.map((klass) => String(klass._id));

  const [counts, byClassCounts, subjects, events, pendingCorrections] = await Promise.all([
    dashboardRepository.attendanceForClasses(institutionId, classIds),
    dashboardRepository.attendanceByClass(institutionId, classIds),
    subjectRepository.findManyByIds(
      institutionId,
      classes.map((klass) => String(klass.subjectId)),
    ),
    dashboardRepository.eventsBetween(
      institutionId,
      now,
      new Date(now.getTime() + 60 * 86_400_000),
      { departmentIds: [departmentId] },
    ),
    pendingCorrectionsIn(institutionId, classIds),
  ]);

  const subjectCode = new Map(subjects.map((subject) => [String(subject._id), subject.code]));
  const countsByClass = new Map(byClassCounts.map((row) => [row.classId, row]));

  const facultyCounts = new Map<string, number>();
  for (const klass of classes) {
    if (!klass.facultyUserId) continue;
    const key = String(klass.facultyUserId);
    facultyCounts.set(key, (facultyCounts.get(key) ?? 0) + 1);
  }
  const facultyUsers = await Promise.all(
    [...facultyCounts.keys()].map((id) => userRepository.findById(institutionId, id)),
  );

  return {
    department: { id: departmentId, name: department.name, code: department.code },
    attendance: figure(counts),
    byClass: classes.slice(0, 50).map((klass) => ({
      classId: String(klass._id),
      subjectCode: subjectCode.get(String(klass.subjectId)) ?? '—',
      batch: klass.batch,
      section: klass.section,
      ...figure(countsByClass.get(String(klass._id)) ?? { present: 0, total: 0 }),
    })),
    faculty: facultyUsers
      .filter((user) => user !== null)
      .map((user) => ({
        userId: String(user?._id),
        fullName: user?.fullName ?? '',
        classCount: facultyCounts.get(String(user?._id)) ?? 0,
      }))
      .sort((a, b) => b.classCount - a.classCount)
      .slice(0, 50),
    upcomingEvents: events.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      venue: event.venue,
    })),
    pendingCorrections,
    threshold: ATTENDANCE_WARNING_THRESHOLD,
  };
}

// --- Principal (foundation) --------------------------------------------------------

export async function principalDashboard(
  principal: Principal,
  now = new Date(),
): Promise<PrincipalDashboardDTO> {
  requireRole(principal, [Role.PRINCIPAL, Role.SYSTEM_ADMIN]);
  const { institutionId } = principal;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [
    counts,
    byDepartment,
    departments,
    eventsThisMonth,
    clubsPage,
    perClub,
    queue,
    sessions,
    logins,
  ] = await Promise.all([
    dashboardRepository.attendanceForClasses(institutionId, null),
    dashboardRepository.attendanceByDepartment(institutionId),
    departmentRepository.listForInstitution(institutionId),
    dashboardRepository.countEventsBetween(institutionId, monthStart, monthEnd),
    clubRepository.list(institutionId, { page: 1, limit: 100 }, {}),
    dashboardRepository.eventsPerClub(institutionId, monthStart, monthEnd),
    listQueue(principal, { status: 'OPEN', page: 1, limit: 1 }).catch(() => ({
      items: [],
      total: 0,
    })),
    dashboardRepository.activeSessions(institutionId, now),
    dashboardRepository.loginsSince(institutionId, dayAgo),
  ]);

  const departmentById = new Map(departments.map((row) => [String(row._id), row]));

  return {
    attendance: figure(counts),
    byDepartment: byDepartment
      .map((row) => {
        const dept = row.departmentId ? departmentById.get(row.departmentId) : undefined;
        return {
          departmentId: row.departmentId,
          name: dept?.name ?? 'Unassigned classes',
          code: dept?.code ?? '—',
          ...figure(row),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code)),
    eventsThisMonth,
    clubActivity: clubsPage.items
      .map((club) => ({
        clubId: String(club._id),
        name: club.name,
        memberCount: club.memberCount,
        eventsThisMonth: perClub.get(String(club._id)) ?? 0,
      }))
      .sort((a, b) => b.eventsThisMonth - a.eventsThisMonth || b.memberCount - a.memberCount)
      .slice(0, SHORT_CAP),
    moderationQueue: queue.total,
    security: {
      activeSessions: sessions,
      loginsLast24h: logins.total,
      failedLoginsLast24h: logins.failed,
    },
    threshold: ATTENDANCE_WARNING_THRESHOLD,
  };
}

// --- Club admin --------------------------------------------------------------------

export async function clubAdminDashboard(
  principal: Principal,
  now = new Date(),
): Promise<ClubAdminDashboardDTO> {
  const { institutionId, userId } = principal;
  // Administering a club IS the assignment; the role alone, with no club, reaches nothing.
  const clubs = await clubRepository.listAdministeredBy(institutionId, userId);
  if (clubs.length === 0 && !principal.roles.includes(Role.CLUB_ADMIN)) throw Errors.forbidden();

  const clubIds = clubs.map((club) => String(club._id));
  const [pending, events] = await Promise.all([
    dashboardRepository.pendingRequestsPerClub(institutionId, clubIds),
    dashboardRepository.eventsBetween(
      institutionId,
      new Date(now.getTime() - 30 * 86_400_000),
      new Date(now.getTime() + 90 * 86_400_000),
      { clubIds },
      50,
    ),
  ]);
  const stats = await dashboardRepository.registrationStats(
    institutionId,
    events.map((event) => event.id),
  );

  return {
    clubs: clubs.slice(0, LIST_CAP).map((club) => ({
      id: String(club._id),
      name: club.name,
      memberCount: club.memberCount,
      pendingRequests: pending.get(String(club._id)) ?? 0,
      events: events
        .filter((event) => event.clubId === String(club._id))
        .slice(0, SHORT_CAP)
        .map((event) => ({
          id: event.id,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          capacity: event.capacity,
          registrations: stats.get(event.id)?.registrations ?? 0,
          checkIns: stats.get(event.id)?.checkIns ?? 0,
        })),
    })),
  };
}
