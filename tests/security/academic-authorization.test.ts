/**
 * Phase 3 authorization: the scope hierarchy, announcement authority, and cross-tenant
 * isolation for academic and community data.
 *
 * The rule under test throughout is that holding a permission is not the same as holding the
 * data. `attendance:read:scope` is held by faculty, mentors, HODs and the principal alike, and
 * each of them must see a different slice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnnouncementScope, AttendanceStatus, Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createTenant,
  disconnectTestDatabase,
  login,
  type TestTenant,
  type TestUser,
} from '../../server/tests/helpers/testHarness.js';
import {
  BATCH,
  SECTION,
  attendancePattern,
  createClub,
  createDepartment,
  createFaculty,
  createStudentInSection,
  createSubjectAndClass,
  seedAttendance,
  setDepartmentHod,
  type AcademicClass,
} from '../../server/tests/helpers/academicFixtures.js';

let tenant: TestTenant;
let cse: string;
let ece: string;

/** Section A of CSE, taught by `facultyA`. */
let facultyA: TestUser;
let classA: AcademicClass;
let studentA: TestUser;

/** Section B of CSE, taught by `facultyB`. */
let facultyB: TestUser;
let classB: AcademicClass;
let studentB: TestUser;

/** A student in a different department entirely. */
let studentEce: TestUser;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  cse = await createDepartment(tenant, 'CSE', 'Computer Science');
  ece = await createDepartment(tenant, 'ECE', 'Electronics');

  facultyA = await createFaculty(tenant, { localPart: 'facultya', departmentId: cse });
  facultyB = await createFaculty(tenant, { localPart: 'facultyb', departmentId: cse });

  classA = await createSubjectAndClass(tenant, {
    code: 'CS101',
    departmentId: cse,
    facultyUserId: facultyA.id,
    section: SECTION,
  });
  classB = await createSubjectAndClass(tenant, {
    code: 'CS102',
    departmentId: cse,
    facultyUserId: facultyB.id,
    section: 'B',
  });

  studentA = await createStudentInSection(tenant, {
    localPart: 'studenta',
    rollNo: 'S-A1',
    departmentId: cse,
    section: SECTION,
  });
  studentB = await createStudentInSection(tenant, {
    localPart: 'studentb',
    rollNo: 'S-B1',
    departmentId: cse,
    section: 'B',
  });
  studentEce = await createStudentInSection(tenant, {
    localPart: 'studentece',
    rollNo: 'S-E1',
    departmentId: ece,
    section: SECTION,
  });

  // Give everyone some attendance so an over-broad read would actually return rows.
  await seedAttendance(tenant, {
    klass: classA,
    markedByUserId: facultyA.id,
    periods: attendancePattern(studentA.id, 8, 10),
  });
  await seedAttendance(tenant, {
    klass: classB,
    markedByUserId: facultyB.id,
    periods: attendancePattern(studentB.id, 5, 10, 2),
  });
  await seedAttendance(tenant, {
    klass: classA,
    markedByUserId: facultyA.id,
    periods: attendancePattern(studentEce.id, 3, 10, 3),
  });
});

describe('a student sees only their own attendance', () => {
  it('cannot request another student’s summary', async () => {
    const session = await login(studentA);

    const response = await api()
      .get(`/api/v1/attendance/summary?studentUserId=${studentB.id}`)
      .set('authorization', `Bearer ${session.accessToken}`);

    // NOT_FOUND, not FORBIDDEN — a refusal must not confirm the record exists.
    expect(response.status).toBe(404);
  });

  it('gets their own figures when asking for themselves explicitly', async () => {
    const session = await login(studentA);

    const response = await api()
      .get(`/api/v1/attendance/summary?studentUserId=${studentA.id}`)
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.overall.total).toBe(10);
  });

  it('cannot list another student’s records', async () => {
    const session = await login(studentA);

    const response = await api()
      .get(`/api/v1/attendance?studentUserId=${studentB.id}`)
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('gets only their own rows from an unfiltered list', async () => {
    const session = await login(studentA);

    const response = await api()
      .get('/api/v1/attendance?limit=100')
      .set('authorization', `Bearer ${session.accessToken}`);

    const owners = new Set(
      (response.body.data as Array<{ studentUserId: string }>).map((r) => r.studentUserId),
    );
    expect([...owners]).toEqual([studentA.id]);
  });
});

describe('faculty are limited to the classes they teach', () => {
  it('sees their own class roster but not a colleague’s', async () => {
    const session = await login(facultyA);

    const response = await api()
      .get('/api/v1/attendance/scope-summary')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
    const ids = (response.body.data.students as Array<{ userId: string }>).map((s) => s.userId);
    // Class A covers studentA and (because they were marked in it) studentEce.
    expect(ids).toContain(studentA.id);
    expect(ids).not.toContain(studentB.id);
  });

  it('cannot mark attendance for a class they do not teach', async () => {
    const session = await login(facultyA);

    const response = await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        classId: classB.classId,
        date: new Date().toISOString(),
        period: 1,
        records: [{ studentUserId: studentB.id, status: AttendanceStatus.PRESENT }],
      });

    expect(response.status).toBe(403);
  });

  it('cannot open the roster of a class they do not teach', async () => {
    const session = await login(facultyA);

    const response = await api()
      .get(`/api/v1/attendance/roster/${classB.classId}?date=${new Date().toISOString()}&period=1`)
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('cannot decide a correction raised on another teacher’s class', async () => {
    // studentB raises a correction on class B (facultyB's class).
    const studentSession = await login(studentB);
    const records = await api()
      .get('/api/v1/attendance?limit=50')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const absent = (records.body.data as Array<{ id: string; status: string }>).find(
      (r) => r.status === AttendanceStatus.ABSENT,
    );
    expect(absent).toBeTruthy();

    const requested = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({
        attendanceId: absent?.id,
        newValue: AttendanceStatus.PRESENT,
        reason: 'I was present for this period.',
      });
    expect(requested.status).toBe(201);

    // facultyA, who teaches a different class, must not be able to decide it.
    const outsiderSession = await login(facultyA);
    const response = await api()
      .patch(`/api/v1/attendance/corrections/${requested.body.data.id}`)
      .set('authorization', `Bearer ${outsiderSession.accessToken}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(404);
  });
});

describe('a class mentor is limited to their section', () => {
  it('sees every student in their section and none outside it', async () => {
    const mentor = await createFaculty(tenant, {
      localPart: 'mentora',
      roles: [Role.CLASS_MENTOR],
      departmentId: cse,
      mentorOf: { batch: BATCH, section: SECTION },
    });
    const session = await login(mentor);

    const response = await api()
      .get('/api/v1/attendance/scope-summary')
      .set('authorization', `Bearer ${session.accessToken}`);

    const ids = (response.body.data.students as Array<{ userId: string }>).map((s) => s.userId);
    expect(ids).toContain(studentA.id);
    // Section B is outside their remit.
    expect(ids).not.toContain(studentB.id);
  });

  it('with no assigned section resolves to an empty scope, not to everyone', async () => {
    const unassigned = await createFaculty(tenant, {
      localPart: 'unassigned',
      roles: [Role.CLASS_MENTOR],
      departmentId: cse,
      mentorOf: null,
    });
    const session = await login(unassigned);

    const response = await api()
      .get('/api/v1/attendance/scope-summary')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
    // Fail closed: holding the permission without an assignment grants nothing.
    expect(response.body.data.students).toHaveLength(0);
  });
});

describe('an HOD is limited to their department', () => {
  it('sees both sections of their own department but not another department', async () => {
    const hod = await createFaculty(tenant, { localPart: 'hodcse', roles: [Role.HOD], departmentId: cse });
    await setDepartmentHod(tenant, cse, hod.id);
    const session = await login(hod);

    const response = await api()
      .get('/api/v1/attendance/scope-summary')
      .set('authorization', `Bearer ${session.accessToken}`);

    const ids = (response.body.data.students as Array<{ userId: string }>).map((s) => s.userId);
    expect(ids).toContain(studentA.id);
    expect(ids).toContain(studentB.id);
  });

  it('cannot read a student in a department they do not head', async () => {
    const hod = await createFaculty(tenant, { localPart: 'hodece', roles: [Role.HOD], departmentId: ece });
    await setDepartmentHod(tenant, ece, hod.id);
    const session = await login(hod);

    const response = await api()
      .get(`/api/v1/attendance/summary?studentUserId=${studentA.id}`)
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(404);
  });
});

describe('a principal sees the whole college', () => {
  it('can read any student in the institution', async () => {
    const principal = await createFaculty(tenant, {
      localPart: 'principal',
      roles: [Role.PRINCIPAL],
      departmentId: cse,
    });
    const session = await login(principal);

    for (const student of [studentA, studentB, studentEce]) {
      const response = await api()
        .get(`/api/v1/attendance/summary?studentUserId=${student.id}`)
        .set('authorization', `Bearer ${session.accessToken}`);
      expect(response.status).toBe(200);
    }
  });
});

describe('announcement authority', () => {
  it('stops a faculty member publishing college-wide', async () => {
    const session = await login(facultyA);

    const response = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        title: 'Everyone listen',
        body: 'Overreach.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    expect(response.status).toBe(403);
  });

  it('stops a mentor publishing to a section that is not theirs', async () => {
    const mentor = await createFaculty(tenant, {
      localPart: 'mentorsec',
      roles: [Role.CLASS_MENTOR],
      departmentId: cse,
      mentorOf: { batch: BATCH, section: SECTION },
    });
    const session = await login(mentor);

    const allowed = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        title: 'My section',
        body: 'Fine.',
        target: { scope: AnnouncementScope.SECTION, batch: BATCH, section: SECTION },
      });
    expect(allowed.status).toBe(201);

    const refused = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        title: 'Not my section',
        body: 'Overreach.',
        target: { scope: AnnouncementScope.SECTION, batch: BATCH, section: 'B' },
      });
    expect(refused.status).toBe(403);
  });

  it('stops an HOD publishing to a department they do not head', async () => {
    const hod = await createFaculty(tenant, { localPart: 'hodx', roles: [Role.HOD], departmentId: cse });
    await setDepartmentHod(tenant, cse, hod.id);
    const session = await login(hod);

    const own = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        title: 'CSE notice',
        body: 'Fine.',
        target: { scope: AnnouncementScope.DEPARTMENT, departmentId: cse },
      });
    expect(own.status).toBe(201);

    const other = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        title: 'ECE notice',
        body: 'Overreach.',
        target: { scope: AnnouncementScope.DEPARTMENT, departmentId: ece },
      });
    expect(other.status).toBe(403);
  });

  it('denies a student publishing anything', async () => {
    const session = await login(studentA);

    const response = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        title: 'Student broadcast',
        body: 'Should be refused.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    expect(response.status).toBe(403);
  });
});

describe('cross-tenant isolation for academic and community data', () => {
  it('returns NOT_FOUND for another institution’s student, class and club', async () => {
    const other = await createTenant('other-college.test');
    const otherDept = await createDepartment(other, 'MEC', 'Mechanical');
    const otherFaculty = await createFaculty(other, { localPart: 'otherfaculty', departmentId: otherDept });
    const otherClass = await createSubjectAndClass(other, {
      code: 'ME101',
      departmentId: otherDept,
      facultyUserId: otherFaculty.id,
    });
    const otherStudent = await createStudentInSection(other, {
      localPart: 'otherstudent',
      rollNo: 'O-1',
      departmentId: otherDept,
    });
    const otherClub = await createClub(other, { name: 'Other Club' });

    // A principal — the widest scope there is — still cannot cross the tenant boundary.
    const principal = await createFaculty(tenant, {
      localPart: 'ourprincipal',
      roles: [Role.PRINCIPAL],
      departmentId: cse,
    });
    const session = await login(principal);

    const studentRead = await api()
      .get(`/api/v1/attendance/summary?studentUserId=${otherStudent.id}`)
      .set('authorization', `Bearer ${session.accessToken}`);
    expect(studentRead.status).toBe(404);

    // The roster probe needs a caller who actually holds `attendance:mark`, otherwise the
    // permission check would deny it first and the tenant boundary would go untested.
    const markerSession = await login(facultyA);
    const rosterRead = await api()
      .get(`/api/v1/attendance/roster/${otherClass.classId}?date=${new Date().toISOString()}&period=1`)
      .set('authorization', `Bearer ${markerSession.accessToken}`);
    expect(rosterRead.status).toBe(404);

    const clubRead = await api()
      .get(`/api/v1/clubs/${otherClub}`)
      .set('authorization', `Bearer ${session.accessToken}`);
    expect(clubRead.status).toBe(404);
  });

  it('never lists another institution’s classes or clubs', async () => {
    const other = await createTenant('second-college.test');
    const otherDept = await createDepartment(other, 'CIV', 'Civil');
    await createSubjectAndClass(other, { code: 'CE101', departmentId: otherDept });
    await createClub(other, { name: 'Their Society' });

    const principal = await createFaculty(tenant, {
      localPart: 'principal2',
      roles: [Role.PRINCIPAL],
      departmentId: cse,
    });
    const session = await login(principal);

    const classes = await api()
      .get('/api/v1/classes?limit=100')
      .set('authorization', `Bearer ${session.accessToken}`);
    const codes = (classes.body.data as Array<{ subject: { code: string } }>).map((c) => c.subject.code);
    expect(codes).not.toContain('CE101');

    const clubs = await api()
      .get('/api/v1/clubs?limit=100')
      .set('authorization', `Bearer ${session.accessToken}`);
    const names = (clubs.body.data as Array<{ name: string }>).map((c) => c.name);
    expect(names).not.toContain('Their Society');
  });

  it('cannot mark attendance into another institution', async () => {
    const other = await createTenant('third-college.test');
    const otherDept = await createDepartment(other, 'BIO', 'Biotech');
    const otherClass = await createSubjectAndClass(other, { code: 'BT101', departmentId: otherDept });
    const otherStudent = await createStudentInSection(other, {
      localPart: 'bio1',
      rollNo: 'B-1',
      departmentId: otherDept,
    });

    const session = await login(facultyA);
    const response = await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        classId: otherClass.classId,
        date: new Date().toISOString(),
        period: 1,
        records: [{ studentUserId: otherStudent.id, status: AttendanceStatus.PRESENT }],
      });

    expect(response.status).toBe(404);
  });

  it('does not deliver another institution’s announcements', async () => {
    const other = await createTenant('fourth-college.test');
    const otherPrincipal = await createFaculty(other, {
      localPart: 'theirprincipal',
      roles: [Role.PRINCIPAL],
    });
    const otherSession = await login(otherPrincipal);

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${otherSession.accessToken}`)
      .send({
        title: 'Their private notice',
        body: 'For their college only.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    const session = await login(studentA);
    const feed = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${session.accessToken}`);

    expect(feed.body.data).toHaveLength(0);

    const searched = await api()
      .get('/api/v1/search?q=private')
      .set('authorization', `Bearer ${session.accessToken}`);
    expect(searched.body.data).toHaveLength(0);
  });
});
