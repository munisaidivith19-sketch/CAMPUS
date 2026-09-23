/** Subjects, classes and timetable — including the per-role scoping of what is visible. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createTenant,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
  type TestUser,
} from '../helpers/testHarness.js';
import {
  BATCH,
  SECTION,
  createDepartment,
  createFaculty,
  createStudentInSection,
  createSubjectAndClass,
  createTimetable,
} from '../helpers/academicFixtures.js';

let tenant: TestTenant;
let departmentId: string;
let faculty: TestUser;
let facultySession: LoggedIn;
let studentSession: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  faculty = await createFaculty(tenant, { localPart: 'prof', departmentId });
  facultySession = await login(faculty);

  const student = await createStudentInSection(tenant, {
    localPart: 'learner',
    rollNo: 'A001',
    departmentId,
  });
  studentSession = await login(student);
});

describe('subjects', () => {
  it('lists the catalog', async () => {
    await createSubjectAndClass(tenant, { code: 'MA101', departmentId, facultyUserId: faculty.id });
    await createSubjectAndClass(tenant, { code: 'PH101', departmentId, facultyUserId: faculty.id });

    const response = await api()
      .get('/api/v1/subjects')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination.total).toBe(2);
  });

  it('filters by department', async () => {
    const other = await createDepartment(tenant, 'ECE', 'Electronics');
    await createSubjectAndClass(tenant, { code: 'CS201', departmentId, facultyUserId: faculty.id });
    await createSubjectAndClass(tenant, { code: 'EC201', departmentId: other, facultyUserId: faculty.id });

    const response = await api()
      .get(`/api/v1/subjects?departmentId=${departmentId}`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].code).toBe('CS201');
  });
});

describe('classes', () => {
  it('shows a student the classes of their own section', async () => {
    await createSubjectAndClass(tenant, { code: 'CS301', departmentId, facultyUserId: faculty.id });
    // A class for a different section must not appear.
    await createSubjectAndClass(tenant, {
      code: 'CS302',
      departmentId,
      facultyUserId: faculty.id,
      section: 'B',
    });

    const response = await api()
      .get('/api/v1/classes')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].subject.code).toBe('CS301');
    expect(response.body.data[0].section).toBe(SECTION);
  });

  it('shows a faculty member only the classes they teach', async () => {
    const colleague = await createFaculty(tenant, { localPart: 'colleague', departmentId });

    await createSubjectAndClass(tenant, { code: 'CS401', departmentId, facultyUserId: faculty.id });
    await createSubjectAndClass(tenant, { code: 'CS402', departmentId, facultyUserId: colleague.id });

    const response = await api()
      .get('/api/v1/classes')
      .set('authorization', `Bearer ${facultySession.accessToken}`);

    const codes = (response.body.data as Array<{ subject: { code: string } }>).map((c) => c.subject.code);
    expect(codes).toEqual(['CS401']);
  });

  it('shows a principal every class in the college', async () => {
    const colleague = await createFaculty(tenant, { localPart: 'other', departmentId });
    await createSubjectAndClass(tenant, { code: 'CS501', departmentId, facultyUserId: faculty.id });
    await createSubjectAndClass(tenant, { code: 'CS502', departmentId, facultyUserId: colleague.id });

    const principal = await createFaculty(tenant, { localPart: 'head', roles: [Role.PRINCIPAL], departmentId });
    const principalSession = await login(principal);

    const response = await api()
      .get('/api/v1/classes')
      .set('authorization', `Bearer ${principalSession.accessToken}`);

    expect(response.body.data.length).toBe(2);
  });

  it('reports the roster size for a class', async () => {
    await createStudentInSection(tenant, { localPart: 'second', rollNo: 'A002', departmentId });
    await createSubjectAndClass(tenant, { code: 'CS601', departmentId, facultyUserId: faculty.id });

    const response = await api()
      .get('/api/v1/classes')
      .set('authorization', `Bearer ${facultySession.accessToken}`);

    expect(response.body.data[0].studentCount).toBe(2);
  });

  it('lets an HOD reassign teaching faculty', async () => {
    const klass = await createSubjectAndClass(tenant, { code: 'CS701', departmentId, facultyUserId: null });
    const hod = await createFaculty(tenant, { localPart: 'hoduser', roles: [Role.HOD], departmentId });
    const hodSession = await login(hod);

    const response = await api()
      .put(`/api/v1/classes/${klass.classId}/faculty`)
      .set('authorization', `Bearer ${hodSession.accessToken}`)
      .send({ facultyUserId: faculty.id });

    expect(response.status).toBe(200);
    expect(response.body.data.faculty.userId).toBe(faculty.id);
  });

  it('denies a plain faculty member the reassignment', async () => {
    const klass = await createSubjectAndClass(tenant, { code: 'CS702', departmentId });

    const response = await api()
      .put(`/api/v1/classes/${klass.classId}/faculty`)
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({ facultyUserId: faculty.id });

    expect(response.status).toBe(403);
  });
});

describe('timetable', () => {
  it('gives a student their section grid with subject and faculty resolved', async () => {
    const klass = await createSubjectAndClass(tenant, {
      code: 'CS801',
      departmentId,
      facultyUserId: faculty.id,
    });
    await createTimetable(tenant, [
      { day: 'MON', period: 1, classId: klass.classId, room: 'L1' },
      { day: 'TUE', period: 2, classId: klass.classId, room: 'L2' },
    ]);

    const response = await api()
      .get('/api/v1/timetable')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.scope).toBe('SECTION');
    expect(response.body.data.label).toBe(`${BATCH} ${SECTION}`);
    expect(response.body.data.entries).toHaveLength(2);
    expect(response.body.data.entries[0].subject.code).toBe('CS801');
    expect(response.body.data.entries[0].facultyName).toBe(faculty.fullName);
    expect(response.body.data.entries[0].room).toBe('L1');
  });

  it('gives a faculty member their own teaching schedule', async () => {
    const mine = await createSubjectAndClass(tenant, {
      code: 'CS901',
      departmentId,
      facultyUserId: faculty.id,
    });
    const colleague = await createFaculty(tenant, { localPart: 'peer', departmentId });
    const theirs = await createSubjectAndClass(tenant, {
      code: 'CS902',
      departmentId,
      facultyUserId: colleague.id,
    });

    await createTimetable(tenant, [
      { day: 'MON', period: 1, classId: mine.classId },
      { day: 'MON', period: 2, classId: theirs.classId },
    ]);

    const response = await api()
      .get('/api/v1/timetable?scope=FACULTY')
      .set('authorization', `Bearer ${facultySession.accessToken}`);

    expect(response.body.data.scope).toBe('FACULTY');
    // Only their own period appears, not the colleague's.
    expect(response.body.data.entries).toHaveLength(1);
    expect(response.body.data.entries[0].subject.code).toBe('CS901');
  });

  it('returns an empty grid rather than an error when none is published', async () => {
    const response = await api()
      .get('/api/v1/timetable')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.entries).toEqual([]);
  });
});
