/**
 * Fixtures for the Phase 3 suites: departments, subjects, classes, cohorts and attendance.
 *
 * These build data through the real repositories rather than raw inserts, so a fixture cannot
 * drift from what the application would actually write (and a schema change breaks the fixtures
 * loudly rather than producing rows the services cannot read).
 */
import { AttendanceStatus, Role } from '@campusconnect/types';
import { DepartmentModel } from '../../src/models/Department.model.js';
import {
  classRepository,
  subjectRepository,
  timetableRepository,
} from '../../src/repositories/academics.repository.js';
import { attendanceRepository } from '../../src/repositories/attendance.repository.js';
import { clubRepository } from '../../src/repositories/club.repository.js';
import {
  facultyProfileRepository,
  studentProfileRepository,
} from '../../src/repositories/profile.repository.js';
import { requireObjectId } from '../../src/repositories/base.repository.js';
import { createUser, type TestTenant, type TestUser } from './testHarness.js';

export const BATCH = '2024-2028';
export const SECTION = 'A';

export async function createDepartment(
  tenant: TestTenant,
  code = 'CSE',
  name = 'Computer Science',
): Promise<string> {
  const department = await DepartmentModel.create({
    institutionId: requireObjectId(tenant.institutionId),
    name,
    code: code.toUpperCase(),
  });
  return String(department._id);
}

export async function setDepartmentHod(
  _tenant: TestTenant,
  departmentId: string,
  hodUserId: string,
): Promise<void> {
  await DepartmentModel.updateOne(
    { _id: requireObjectId(departmentId) },
    { $set: { hodUserId: requireObjectId(hodUserId) } },
  ).exec();
}

export interface AcademicClass {
  classId: string;
  subjectId: string;
  subjectCode: string;
}

export async function createSubjectAndClass(
  tenant: TestTenant,
  options: {
    code: string;
    name?: string;
    departmentId?: string | null;
    facultyUserId?: string | null;
    batch?: string;
    section?: string;
  },
): Promise<AcademicClass> {
  const subject = await subjectRepository.create({
    institutionId: tenant.institutionId,
    code: options.code,
    name: options.name ?? `${options.code} Subject`,
    credits: 3,
    departmentId: options.departmentId ?? null,
  });

  const klass = await classRepository.create({
    institutionId: tenant.institutionId,
    subjectId: String(subject._id),
    batch: options.batch ?? BATCH,
    section: options.section ?? SECTION,
    departmentId: options.departmentId ?? null,
    facultyUserId: options.facultyUserId ?? null,
  });

  return { classId: String(klass._id), subjectId: String(subject._id), subjectCode: subject.code };
}

/** A student with a profile placing them in a specific section. */
export async function createStudentInSection(
  tenant: TestTenant,
  options: {
    localPart?: string;
    rollNo: string;
    departmentId?: string | null;
    batch?: string;
    section?: string;
    interests?: string[];
  },
): Promise<TestUser> {
  const user = await createUser(tenant, { roles: [Role.STUDENT], localPart: options.localPart });

  await studentProfileRepository.create({
    institutionId: tenant.institutionId,
    userId: user.id,
    rollNo: options.rollNo,
    departmentId: options.departmentId ?? null,
    batch: options.batch ?? BATCH,
    section: options.section ?? SECTION,
  });

  if (options.interests) {
    await studentProfileRepository.setInterests(tenant.institutionId, user.id, options.interests);
  }

  return user;
}

/** A faculty member, optionally mentoring a section. */
export async function createFaculty(
  tenant: TestTenant,
  options: {
    localPart?: string;
    roles?: Role[];
    departmentId?: string | null;
    mentorOf?: { batch: string; section: string } | null;
  } = {},
): Promise<TestUser> {
  const user = await createUser(tenant, {
    roles: options.roles ?? [Role.FACULTY],
    localPart: options.localPart,
  });

  await facultyProfileRepository.create({
    institutionId: tenant.institutionId,
    userId: user.id,
    departmentId: options.departmentId ?? null,
    designation: 'Assistant Professor',
  });

  if (options.mentorOf) {
    await facultyProfileRepository.setMentorSection(tenant.institutionId, user.id, options.mentorOf);
  }

  return user;
}

/** Write attendance rows directly, for tests that need history without going through HTTP. */
export async function seedAttendance(
  tenant: TestTenant,
  options: {
    klass: AcademicClass;
    markedByUserId: string;
    /** One entry per period; each lists the students present/absent for that period. */
    periods: Array<{ date: Date; period: number; records: Array<{ studentUserId: string; status: AttendanceStatus }> }>;
  },
): Promise<void> {
  for (const entry of options.periods) {
    await attendanceRepository.markRoster({
      institutionId: tenant.institutionId,
      classId: options.klass.classId,
      subjectId: options.klass.subjectId,
      date: entry.date,
      period: entry.period,
      markedByUserId: options.markedByUserId,
      records: entry.records,
    });
  }
}

/**
 * Generate `total` periods for one student where `present` of them are PRESENT — a compact way
 * to set up an exact attendance percentage.
 */
export function attendancePattern(
  studentUserId: string,
  present: number,
  total: number,
  startPeriod = 1,
): Array<{ date: Date; period: number; records: Array<{ studentUserId: string; status: AttendanceStatus }> }> {
  const base = Date.UTC(2026, 0, 5); // a Monday
  return Array.from({ length: total }, (_, index) => ({
    date: new Date(base + index * 24 * 60 * 60 * 1000),
    period: startPeriod,
    records: [
      {
        studentUserId,
        status: index < present ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT,
      },
    ],
  }));
}

export async function createClub(
  tenant: TestTenant,
  options: { name: string; category?: string; interests?: string[]; adminUserIds?: string[] },
): Promise<string> {
  const club = await clubRepository.create({
    institutionId: tenant.institutionId,
    name: options.name,
    category: options.category ?? 'Technology',
    description: `${options.name} description for testing.`,
    interests: options.interests ?? [],
    adminUserIds: options.adminUserIds ?? [],
  });
  return String(club._id);
}

export async function createTimetable(
  tenant: TestTenant,
  entries: Array<{ day: string; period: number; classId: string; room?: string }>,
  batch = BATCH,
  section = SECTION,
): Promise<void> {
  await timetableRepository.upsertSection({
    institutionId: tenant.institutionId,
    batch,
    section,
    entries,
  });
}
