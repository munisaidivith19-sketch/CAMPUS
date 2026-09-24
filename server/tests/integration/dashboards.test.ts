/**
 * Role dashboards: each is role-gated, scope-narrowed, capped, and uses SUM/SUM attendance.
 * The cases that matter most are the empty ones — a mentor with no section, an HOD with no
 * department — which must come back empty, never wider.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClubMembershipStatus, Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createTenant,
  createUser,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
  type TestUser,
} from '../helpers/testHarness.js';
import {
  BATCH,
  attendancePattern,
  createClub,
  createDepartment,
  createFaculty,
  createStudentInSection,
  createSubjectAndClass,
  createTimetable,
  seedAttendance,
  setDepartmentHod,
  type AcademicClass,
} from '../helpers/academicFixtures.js';

let tenant: TestTenant;
let cse: string;
let ece: string;
let student: TestUser;
let studentSession: LoggedIn;
let classmate: TestUser;
let faculty: TestUser;
let otherFaculty: TestUser;
let classA: AcademicClass;
let classB: AcademicClass;
let eceClass: AcademicClass;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  cse = await createDepartment(tenant, 'CSE', 'Computer Science');
  ece = await createDepartment(tenant, 'ECE', 'Electronics');

  student = await createStudentInSection(tenant, {
    localPart: 'stud',
    rollNo: 'D001',
    departmentId: cse,
  });
  classmate = await createStudentInSection(tenant, {
    localPart: 'mate',
    rollNo: 'D002',
    departmentId: cse,
  });
  faculty = await createFaculty(tenant, { localPart: 'fac', departmentId: cse });
  otherFaculty = await createFaculty(tenant, { localPart: 'fac2', departmentId: cse });

  classA = await createSubjectAndClass(tenant, {
    code: 'CS201',
    departmentId: cse,
    facultyUserId: faculty.id,
  });
  classB = await createSubjectAndClass(tenant, {
    code: 'CS202',
    departmentId: cse,
    facultyUserId: otherFaculty.id,
  });
  eceClass = await createSubjectAndClass(tenant, {
    code: 'EC201',
    departmentId: ece,
    facultyUserId: otherFaculty.id,
    section: 'E',
  });

  // Unequal totals on purpose: SUM/SUM = 4/6 = 66.67%, while averaging the two subject
  // percentages (75% and 50%) would say 62.5%.
  await seedAttendance(tenant, {
    klass: classA,
    markedByUserId: faculty.id,
    periods: attendancePattern(student.id, 3, 4, 1),
  });
  await seedAttendance(tenant, {
    klass: classB,
    markedByUserId: otherFaculty.id,
    periods: attendancePattern(student.id, 1, 2, 1),
  });
  // The classmate is a strong attender in class A.
  await seedAttendance(tenant, {
    klass: classA,
    markedByUserId: faculty.id,
    periods: attendancePattern(classmate.id, 4, 4, 2),
  });

  studentSession = await login(student);
});

const get = (session: LoggedIn, kind: string) =>
  api().get(`/api/v1/dashboards/${kind}`).set('authorization', `Bearer ${session.accessToken}`);

describe('student dashboard', () => {
  it('reports attendance by SUM/SUM, per subject and overall, with the below-threshold flags', async () => {
    const response = await get(studentSession, 'student');
    expect(response.status).toBe(200);
    const { attendance } = response.body.data;
    expect(attendance.overall).toEqual({
      present: 4,
      total: 6,
      percentage: 66.67,
      belowThreshold: true,
    });
    const bySubject = Object.fromEntries(
      (
        attendance.bySubject as Array<{
          subject: { code: string };
          percentage: number;
          belowThreshold: boolean;
        }>
      ).map((row) => [row.subject.code, [row.percentage, row.belowThreshold]]),
    );
    expect(bySubject).toEqual({ CS201: [75, false], CS202: [50, true] });
  });

  it('shows today’s timetable, clubs and unread counts', async () => {
    await createTimetable(tenant, [
      {
        day: DAY_KEYS[new Date().getDay()] ?? 'MON',
        period: 2,
        classId: classA.classId,
        room: 'L1',
      },
    ]);
    const clubId = await createClub(tenant, { name: 'Chess' });
    const join = await api()
      .post(`/api/v1/clubs/${clubId}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const admin = await createAndLogin(tenant, { roles: [Role.SYSTEM_ADMIN], localPart: 'sys' });
    await api()
      .patch(`/api/v1/clubs/memberships/${join.body.data.id}`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: ClubMembershipStatus.APPROVED });

    const response = await get(studentSession, 'student');
    expect(response.body.data.today).toEqual([
      expect.objectContaining({
        period: 2,
        classId: classA.classId,
        subject: { code: 'CS201', name: 'CS201 Subject' },
        room: 'L1',
      }),
    ]);
    expect(response.body.data.clubs).toEqual([{ id: clubId, name: 'Chess', role: 'MEMBER' }]);
    expect(response.body.data.unreadNotifications).toBeGreaterThanOrEqual(1); // the approval
  });

  it('is refused the staff dashboards', async () => {
    for (const kind of ['faculty', 'mentor', 'hod', 'principal', 'club-admin']) {
      const response = await get(studentSession, kind);
      expect(response.status, kind).toBe(403);
    }
  });
});

describe('faculty dashboard', () => {
  it('covers only the classes they teach', async () => {
    const session = await login(faculty);
    const response = await get(session, 'faculty');
    expect(response.status).toBe(200);
    expect(response.body.data.classCount).toBe(1);
    // The student is at 75% in class A: not below threshold THERE, even though they are
    // below it overall — a faculty member sees their own classes, not the student's record.
    expect(response.body.data.lowAttendance).toEqual([]);

    const other = await get(await login(otherFaculty), 'faculty');
    const names = (
      other.body.data.lowAttendance as Array<{ userId: string; attendance: { percentage: number } }>
    ).map((row) => [row.userId, row.attendance.percentage]);
    expect(names).toEqual([[student.id, 50]]);
  });

  it('counts today’s slots still to be marked, and stops counting once marked', async () => {
    const day = DAY_KEYS[new Date().getDay()] ?? 'MON';
    await createTimetable(tenant, [{ day, period: 7, classId: classA.classId }]);
    const session = await login(faculty);

    const before = await get(session, 'faculty');
    expect(before.body.data.today).toEqual([expect.objectContaining({ period: 7, marked: false })]);
    expect(before.body.data.pendingToMark).toBe(1);

    const today = new Date().toISOString();
    await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        classId: classA.classId,
        date: today,
        period: 7,
        records: [
          { studentUserId: student.id, status: 'PRESENT' },
          { studentUserId: classmate.id, status: 'PRESENT' },
        ],
      });

    const after = await get(session, 'faculty');
    expect(after.body.data.pendingToMark).toBe(0);
    expect(after.body.data.today[0].marked).toBe(true);
  });
});

describe('mentor dashboard', () => {
  it('is empty — not wider — for a mentor with no section', async () => {
    const mentor = await login(
      await createFaculty(tenant, {
        localPart: 'nosection',
        roles: [Role.CLASS_MENTOR],
        departmentId: cse,
      }),
    );
    const response = await get(mentor, 'mentor');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      section: null,
      rosterSize: 0,
      lowAttendance: [],
      pendingCorrections: 0,
    });
    expect(response.body.data.sectionAttendance.total).toBe(0);
  });

  it('shows the section’s roster and SUM/SUM attendance', async () => {
    const mentor = await login(
      await createFaculty(tenant, {
        localPart: 'mentor',
        roles: [Role.CLASS_MENTOR],
        departmentId: cse,
        mentorOf: { batch: BATCH, section: 'A' },
      }),
    );
    const response = await get(mentor, 'mentor');
    expect(response.body.data.section).toEqual({ batch: BATCH, section: 'A' });
    expect(response.body.data.rosterSize).toBe(2);
    // 4/6 (student) + 4/4 (classmate) = 8/10.
    expect(response.body.data.sectionAttendance).toEqual({
      present: 8,
      total: 10,
      percentage: 80,
      belowThreshold: false,
    });
    expect(response.body.data.lowAttendance.map((row: { userId: string }) => row.userId)).toEqual([
      student.id,
    ]);
  });
});

describe('HOD dashboard', () => {
  it('covers their department only', async () => {
    const hodUser = await createFaculty(tenant, {
      localPart: 'hod',
      roles: [Role.HOD],
      departmentId: cse,
    });
    await setDepartmentHod(tenant, cse, hodUser.id);
    const response = await get(await login(hodUser), 'hod');
    expect(response.status).toBe(200);
    expect(response.body.data.department).toMatchObject({ id: cse, code: 'CSE' });
    const codes = (response.body.data.byClass as Array<{ subjectCode: string }>)
      .map((row) => row.subjectCode)
      .sort();
    expect(codes).toEqual(['CS201', 'CS202']);
    expect(codes).not.toContain('EC201');
    // All CSE records: 3/4 + 1/2 + 4/4 = 8/10.
    expect(response.body.data.attendance).toMatchObject({ present: 8, total: 10, percentage: 80 });
    expect(response.body.data.faculty.map((row: { userId: string }) => row.userId).sort()).toEqual(
      [faculty.id, otherFaculty.id].sort(),
    );
  });

  it('is empty for an HOD with no department', async () => {
    const hod = await createAndLogin(tenant, { roles: [Role.HOD], localPart: 'orphanhod' });
    const response = await get(hod, 'hod');
    expect(response.body.data).toMatchObject({ department: null, byClass: [], faculty: [] });
  });
});

describe('principal dashboard', () => {
  it('rolls attendance up by department from counts, and reports security and moderation counts', async () => {
    await seedAttendance(tenant, {
      klass: eceClass,
      markedByUserId: otherFaculty.id,
      periods: attendancePattern(classmate.id, 0, 2, 5),
    });
    const principal = await createAndLogin(tenant, {
      roles: [Role.PRINCIPAL],
      localPart: 'principal',
    });
    const response = await get(principal, 'principal');
    expect(response.status).toBe(200);
    const byDept = Object.fromEntries(
      (
        response.body.data.byDepartment as Array<{ code: string; present: number; total: number }>
      ).map((row) => [row.code, [row.present, row.total]]),
    );
    expect(byDept).toEqual({ CSE: [8, 10], ECE: [0, 2] });
    expect(response.body.data.attendance).toMatchObject({
      present: 8,
      total: 12,
      percentage: 66.67,
    });
    expect(response.body.data.security.loginsLast24h).toBeGreaterThanOrEqual(2);
    expect(response.body.data.security.activeSessions).toBeGreaterThanOrEqual(2);
    expect(response.body.data.moderationQueue).toBe(0);
  });

  it('never includes another institution’s data', async () => {
    const other = await createTenant();
    const theirPrincipal = await createAndLogin(other, {
      roles: [Role.PRINCIPAL],
      localPart: 'theirs',
    });
    const response = await get(theirPrincipal, 'principal');
    expect(response.body.data.attendance.total).toBe(0);
    expect(response.body.data.byDepartment).toEqual([]);
    expect(response.body.data.clubActivity).toEqual([]);
  });
});

describe('club admin dashboard', () => {
  it('lists only the clubs they administer, with pending requests', async () => {
    const adminUser = await createUser(tenant, { roles: [Role.CLUB_ADMIN], localPart: 'cadmin' });
    const mine = await createClub(tenant, { name: 'Robotics', adminUserIds: [adminUser.id] });
    await createClub(tenant, { name: 'Drama' });
    await api()
      .post(`/api/v1/clubs/${mine}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const response = await get(await login(adminUser), 'club-admin');
    expect(response.status).toBe(200);
    expect(response.body.data.clubs).toEqual([
      expect.objectContaining({ id: mine, name: 'Robotics', pendingRequests: 1, events: [] }),
    ]);
  });
});
