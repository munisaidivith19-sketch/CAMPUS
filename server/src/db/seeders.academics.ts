/**
 * Phase 3 synthetic seed: academics and community.
 *
 * SYNTHETIC DATA ONLY — fictional people, fictional coursework. Absence patterns are
 * deterministic (derived from the student's index, not randomness) so a seeded database always
 * produces the same attendance percentages, including two students deliberately placed below
 * the 75% threshold so the warning path is demonstrable straight after seeding.
 */
import {
  AnnouncementPriority,
  AnnouncementScope,
  AttendanceStatus,
  ClubMembershipStatus,
  Role,
} from '@campusconnect/types';
import type { InstitutionDocument } from '../models/Institution.model.js';
import { ClubModel } from '../models/Club.model.js';
import { UserModel } from '../models/User.model.js';
import { attendanceRepository } from '../repositories/attendance.repository.js';
import {
  classRepository,
  subjectRepository,
  timetableRepository,
} from '../repositories/academics.repository.js';
import { announcementRepository } from '../repositories/announcement.repository.js';
import { clubMembershipRepository, clubRepository } from '../repositories/club.repository.js';
import { discussionRepository, commentRepository } from '../repositories/discussion.repository.js';
import { eventRegistrationRepository, eventRepository } from '../repositories/event.repository.js';
import { departmentRepository } from '../repositories/institution.repository.js';
import {
  facultyProfileRepository,
  studentProfileRepository,
} from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { requireObjectId } from '../repositories/base.repository.js';
import { ensureUser } from './seeders.js';
import { logger } from '../utils/logger.js';

const BATCH = '2022-2026';
const SECTION = 'A';
/** Teaching days of attendance history to generate. */
const TEACHING_DAYS = 20;

interface SeedStudent {
  localPart: string;
  fullName: string;
  rollNo: string;
  interests: string[];
  /** 1 in N periods missed. A low number means a student below the threshold. */
  absenceEveryN: number;
}

const COHORT: SeedStudent[] = [
  {
    localPart: 'asha.student',
    fullName: 'Asha Rao',
    rollNo: '1JN22CS001',
    interests: ['coding', 'robotics'],
    absenceEveryN: 12,
  },
  {
    localPart: 'bhavana.s',
    fullName: 'Bhavana Shetty',
    rollNo: '1JN22CS002',
    interests: ['music', 'photography'],
    absenceEveryN: 10,
  },
  {
    localPart: 'chirag.n',
    fullName: 'Chirag Nayak',
    rollNo: '1JN22CS003',
    interests: ['coding'],
    absenceEveryN: 9,
  },
  {
    localPart: 'divya.k',
    fullName: 'Divya Kamath',
    rollNo: '1JN22CS004',
    interests: ['robotics', 'coding'],
    absenceEveryN: 11,
  },
  // Deliberately below 75%: these two miss roughly every third period.
  {
    localPart: 'esha.p',
    fullName: 'Esha Pai',
    rollNo: '1JN22CS005',
    interests: ['photography'],
    absenceEveryN: 3,
  },
  {
    localPart: 'farhan.a',
    fullName: 'Farhan Ahmed',
    rollNo: '1JN22CS006',
    interests: ['music'],
    absenceEveryN: 3,
  },
  {
    localPart: 'gita.r',
    fullName: 'Gita Rao',
    rollNo: '1JN22CS007',
    interests: ['coding', 'music'],
    absenceEveryN: 14,
  },
  {
    localPart: 'harish.b',
    fullName: 'Harish Bhat',
    rollNo: '1JN22CS008',
    interests: ['robotics'],
    absenceEveryN: 13,
  },
];

const SUBJECTS = [
  { code: 'CS301', name: 'Data Structures', credits: 4 },
  { code: 'CS302', name: 'Operating Systems', credits: 4 },
  { code: 'CS303', name: 'Database Systems', credits: 3 },
  { code: 'CS304', name: 'Computer Networks', credits: 3 },
  { code: 'CS305', name: 'Software Engineering', credits: 3 },
];

const CLUBS = [
  {
    name: 'Coding Club',
    category: 'Technology',
    description: 'Weekly problem solving, hackathons and peer code review.',
    interests: ['coding', 'algorithms'],
  },
  {
    name: 'Robotics Society',
    category: 'Technology',
    description: 'Build autonomous robots and compete in inter-college events.',
    interests: ['robotics', 'electronics'],
  },
  {
    name: 'Music Club',
    category: 'Arts',
    description: 'Jam sessions, the college band and the annual concert.',
    interests: ['music'],
  },
  {
    name: 'Photography Circle',
    category: 'Arts',
    description: 'Photo walks, darkroom workshops and the campus photo annual.',
    interests: ['photography'],
  },
];

/** Weekday-only dates, walking backwards from today. */
function teachingDates(count: number): Date[] {
  const dates: Date[] = [];
  const cursor = new Date();
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    // 0 = Sunday, 6 = Saturday.
    if (day !== 0 && day !== 6) {
      dates.push(
        new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate())),
      );
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

export async function seedAcademicsAndCommunity(institution: InstitutionDocument): Promise<void> {
  const institutionId = String(institution._id);
  const domain = institution.domains[0] ?? 'jnn.edu.in';

  const department = await departmentRepository.findByCode(institutionId, 'CSE');
  if (!department) {
    logger.warn('CSE department missing; skipping Phase 3 seed');
    return;
  }
  const departmentId = String(department._id);

  // --- Staff wiring: the HOD heads CSE, the mentor owns section A -------------
  const [hod, mentor, faculty] = await Promise.all([
    userRepository.findByEmail(institutionId, `rajesh.hod@${domain}`),
    userRepository.findByEmail(institutionId, `meera.mentor@${domain}`),
    userRepository.findByEmail(institutionId, `vikram.faculty@${domain}`),
  ]);

  if (hod) await departmentRepository.setHod(institutionId, departmentId, hod._id);
  if (mentor) {
    await facultyProfileRepository.setMentorSection(institutionId, mentor._id, {
      batch: BATCH,
      section: SECTION,
    });
  }

  // --- Cohort ----------------------------------------------------------------
  const students: Array<{ userId: string; seed: SeedStudent }> = [];

  for (const seed of COHORT) {
    const user = await ensureUser({
      institutionId,
      email: `${seed.localPart}@${domain}`,
      password: 'StudentPass#2026',
      fullName: seed.fullName,
      roles: [Role.STUDENT],
      primaryRole: Role.STUDENT,
    });

    let profile = await studentProfileRepository.findByUserId(institutionId, user._id);
    profile ??= await studentProfileRepository.create({
      institutionId,
      userId: user._id,
      rollNo: seed.rollNo,
      departmentId,
      batch: BATCH,
      year: 4,
      section: SECTION,
    });

    await studentProfileRepository.setInterests(institutionId, user._id, seed.interests);
    students.push({ userId: String(user._id), seed });
  }

  // --- Subjects and classes ---------------------------------------------------
  const teacherRotation = [faculty, mentor, faculty, hod, mentor];
  const classIds: string[] = [];

  for (const [index, definition] of SUBJECTS.entries()) {
    let subject = await subjectRepository.findOneScoped(institutionId, { code: definition.code });
    subject ??= await subjectRepository.create({
      institutionId,
      code: definition.code,
      name: definition.name,
      credits: definition.credits,
      departmentId,
    });

    let klass = await classRepository.findOneScoped(institutionId, {
      subjectId: subject._id,
      batch: BATCH,
      section: SECTION,
    });
    klass ??= await classRepository.create({
      institutionId,
      subjectId: subject._id,
      batch: BATCH,
      section: SECTION,
      departmentId,
      facultyUserId: teacherRotation[index]?._id ?? faculty?._id ?? null,
    });

    classIds.push(String(klass._id));
  }

  // --- Timetable: one period per subject per day, Monday to Friday ------------
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
  await timetableRepository.upsertSection({
    institutionId,
    batch: BATCH,
    section: SECTION,
    departmentId,
    entries: days.flatMap((day) =>
      classIds.map((classId, period) => ({
        day,
        period: period + 1,
        classId,
        room: `CS-${101 + period}`,
      })),
    ),
  });

  // --- Attendance history -----------------------------------------------------
  const dates = teachingDates(TEACHING_DAYS);
  const markedBy = faculty?._id ?? hod?._id;

  if (markedBy) {
    let periodCounter = 0;
    for (const [classIndex, classId] of classIds.entries()) {
      const klass = await classRepository.findById(institutionId, classId);
      if (!klass) continue;

      for (const [dayIndex, date] of dates.entries()) {
        periodCounter += 1;
        await attendanceRepository.markRoster({
          institutionId,
          classId,
          subjectId: klass.subjectId,
          date,
          period: classIndex + 1,
          markedByUserId: markedBy,
          records: students.map(({ userId, seed }, studentIndex) => ({
            studentUserId: userId,
            // Deterministic: the same seed always yields the same percentages.
            status:
              (dayIndex + studentIndex + classIndex) % seed.absenceEveryN === 0
                ? AttendanceStatus.ABSENT
                : AttendanceStatus.PRESENT,
          })),
        });
      }
    }
    logger.info({ periods: periodCounter }, 'Seeded attendance history');
  }

  // --- Clubs ------------------------------------------------------------------
  const clubIds: string[] = [];
  for (const definition of CLUBS) {
    let club = await ClubModel.findOne({
      institutionId: requireObjectId(institutionId),
      name: definition.name,
    }).exec();
    club ??= await clubRepository.create({
      institutionId,
      name: definition.name,
      category: definition.category,
      description: definition.description,
      interests: definition.interests,
      // The class mentor administers the clubs in the synthetic dataset.
      adminUserIds: mentor ? [mentor._id] : [],
    });
    clubIds.push(String(club._id));
  }

  // The mentor administers these clubs, so they also hold the CLUB_ADMIN role — without it
  // they could not approve members or open the club-admin dashboard (both need club:manage).
  // This also makes the mentor a multi-role user, which the dashboard's role switcher shows.
  if (mentor && !mentor.roles.includes(Role.CLUB_ADMIN)) {
    await UserModel.updateOne(
      { _id: mentor._id },
      { $addToSet: { roles: Role.CLUB_ADMIN } },
    ).exec();
  }

  // Approved members for the first club; a pending request on the second.
  const codingClubId = clubIds[0];
  const roboticsClubId = clubIds[1];

  if (codingClubId) {
    for (const { userId, seed } of students.filter((s) => s.seed.interests.includes('coding'))) {
      const existing = await clubMembershipRepository.findForUserAndClub(
        institutionId,
        codingClubId,
        userId,
      );
      if (existing?.status === ClubMembershipStatus.APPROVED) continue;

      await clubMembershipRepository.requestJoin(institutionId, codingClubId, userId);
      const membership = await clubMembershipRepository.findForUserAndClub(
        institutionId,
        codingClubId,
        userId,
      );
      if (membership && mentor) {
        await clubMembershipRepository.decide(
          institutionId,
          membership._id,
          ClubMembershipStatus.APPROVED,
          mentor._id,
        );
        await clubRepository.adjustMemberCount(institutionId, codingClubId, 1);
      }
      logger.debug({ rollNo: seed.rollNo }, 'Seeded club membership');
    }
  }

  // A pending request so the approval flow has something to act on.
  const pendingStudent = students.find((s) => s.seed.interests.includes('robotics'));
  if (roboticsClubId && pendingStudent) {
    await clubMembershipRepository.requestJoin(
      institutionId,
      roboticsClubId,
      pendingStudent.userId,
    );
  }

  // --- Events ------------------------------------------------------------------
  const inDays = (n: number): Date => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

  const eventDefinitions = [
    {
      title: 'Hackathon 2026',
      description: 'A 24-hour build sprint. Teams of up to four.',
      category: 'Technology',
      venue: 'CS Block Lab 1',
      startsAt: inDays(7),
      endsAt: inDays(8),
      capacity: 60,
      organizerType: 'CLUB' as const,
      clubId: codingClubId,
    },
    {
      title: 'Open Mic Night',
      description: 'Perform, or just come and listen.',
      category: 'Arts',
      venue: 'Auditorium',
      startsAt: inDays(3),
      endsAt: inDays(3),
      capacity: 120,
      organizerType: 'CLUB' as const,
      clubId: clubIds[2],
    },
    {
      title: 'Industry Talk: Distributed Systems',
      description: 'A guest lecture from an engineer working on large-scale systems.',
      category: 'Technology',
      venue: 'Seminar Hall',
      startsAt: inDays(12),
      endsAt: inDays(12),
      capacity: null,
      organizerType: 'DEPARTMENT' as const,
      departmentId,
    },
  ];

  for (const definition of eventDefinitions) {
    const existing = await eventRepository.findOneScoped(institutionId, {
      title: definition.title,
    });
    if (existing) continue;
    if (!hod) break;

    const event = await eventRepository.create({
      institutionId,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      venue: definition.venue,
      startsAt: definition.startsAt,
      endsAt: definition.endsAt,
      capacity: definition.capacity ?? null,
      organizerType: definition.organizerType,
      clubId: 'clubId' in definition ? (definition.clubId ?? null) : null,
      departmentId: 'departmentId' in definition ? (definition.departmentId ?? null) : null,
      createdByUserId: mentor?._id ?? hod._id,
    });

    // A couple of registrations so the check-in flow has attendees.
    for (const { userId } of students.slice(0, 3)) {
      const reserved = await eventRepository.reserveSeat(institutionId, String(event._id));
      if (!reserved) break;
      await eventRegistrationRepository.create({
        institutionId,
        eventId: String(event._id),
        userId,
      });
    }
  }

  // --- Announcements ------------------------------------------------------------
  const announcementDefinitions = [
    {
      title: 'Mid-semester examination schedule published',
      body: 'The mid-semester timetable is now available. Check your section timetable for room allocations.',
      priority: AnnouncementPriority.HIGH,
      author: hod,
      target: { scope: AnnouncementScope.DEPARTMENT, departmentId: requireObjectId(departmentId) },
    },
    {
      title: 'Section A: lab records due Friday',
      body: 'Please submit your Data Structures lab records before Friday 5pm.',
      priority: AnnouncementPriority.NORMAL,
      author: mentor,
      target: { scope: AnnouncementScope.SECTION, batch: BATCH, section: SECTION },
    },
  ];

  for (const definition of announcementDefinitions) {
    if (!definition.author) continue;
    const existing = await announcementRepository.findOneScoped(institutionId, {
      title: definition.title,
    });
    if (existing) continue;

    await announcementRepository.create({
      institutionId,
      authorUserId: definition.author._id,
      title: definition.title,
      body: definition.body,
      priority: definition.priority,
      target: definition.target as never,
      publishAt: new Date(),
      expireAt: null,
    });
  }

  // --- Discussions ----------------------------------------------------------------
  const discussionDefinitions = [
    {
      title: 'Best resources for learning graph algorithms?',
      body: 'Looking for something beyond the textbook — videos or problem sets both welcome.',
      category: 'Academics',
      tags: ['algorithms', 'study'],
    },
    {
      title: 'Lost: blue water bottle near the CS block',
      body: 'Left it in Lab 2 on Tuesday afternoon. Please message me if you have seen it.',
      category: 'Campus',
      tags: ['lost-and-found'],
    },
  ];

  for (const [index, definition] of discussionDefinitions.entries()) {
    const existing = await discussionRepository.findOneScoped(institutionId, {
      title: definition.title,
    });
    if (existing) continue;

    const author = students[index]?.userId;
    if (!author) continue;

    const discussion = await discussionRepository.create({
      institutionId,
      authorUserId: author,
      title: definition.title,
      body: definition.body,
      category: definition.category,
      tags: definition.tags,
    });

    const commenter = students[index + 1]?.userId;
    if (commenter) {
      await commentRepository.create({
        institutionId,
        discussionId: String(discussion._id),
        authorUserId: commenter,
        body: 'Seconding this — I would find that useful too.',
      });
      await discussionRepository.incrementCommentCount(institutionId, String(discussion._id), 1);
    }
  }

  logger.info(
    { students: students.length, classes: classIds.length, clubs: clubIds.length },
    'Seeded academics and community data',
  );
}
