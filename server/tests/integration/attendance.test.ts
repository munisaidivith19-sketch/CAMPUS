/**
 * Attendance end to end: marking, the student's view, and the correction workflow.
 *
 * The percentage assertions here use UNEQUAL subject totals on purpose, so the test would fail
 * if the aggregation ever started averaging per-subject percentages.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttendanceStatus, Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
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
  attendancePattern,
  createDepartment,
  createFaculty,
  createStudentInSection,
  createSubjectAndClass,
  seedAttendance,
  type AcademicClass,
} from '../helpers/academicFixtures.js';

let tenant: TestTenant;
let departmentId: string;
let faculty: TestUser;
let facultySession: LoggedIn;
let student: TestUser;
let studentSession: LoggedIn;
let klass: AcademicClass;

const TODAY = new Date(Date.UTC(2026, 1, 2));

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  faculty = await createFaculty(tenant, { localPart: 'teacher', departmentId });
  facultySession = await login(faculty);

  student = await createStudentInSection(tenant, { localPart: 'pupil', rollNo: 'R001', departmentId });
  studentSession = await login(student);

  klass = await createSubjectAndClass(tenant, {
    code: 'CS101',
    departmentId,
    facultyUserId: faculty.id,
  });
});

describe('marking attendance', () => {
  it('records the roster and reports what it created', async () => {
    const response = await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({
        classId: klass.classId,
        date: TODAY.toISOString(),
        period: 1,
        records: [{ studentUserId: student.id, status: AttendanceStatus.PRESENT }],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.marked).toBe(1);
    expect(response.body.data.created).toBe(1);
  });

  it('is idempotent for the same period — no duplicate rows', async () => {
    const payload = {
      classId: klass.classId,
      date: TODAY.toISOString(),
      period: 1,
      records: [{ studentUserId: student.id, status: AttendanceStatus.PRESENT }],
    };

    await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send(payload);
    await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send(payload);

    const summary = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    // One conducted period, not two.
    expect(summary.body.data.overall.total).toBe(1);
  });

  it('re-marking changes the value and is audited rather than silent', async () => {
    await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({
        classId: klass.classId,
        date: TODAY.toISOString(),
        period: 1,
        records: [{ studentUserId: student.id, status: AttendanceStatus.ABSENT }],
      });

    const changed = await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({
        classId: klass.classId,
        date: TODAY.toISOString(),
        period: 1,
        records: [{ studentUserId: student.id, status: AttendanceStatus.PRESENT }],
      });

    expect(changed.body.data.changed).toBe(1);

    const admin = await createAndLogin(tenant, { roles: [Role.SYSTEM_ADMIN], localPart: 'auditor' });
    const audit = await api()
      .get('/api/v1/admin/audit-logs?limit=50')
      .set('authorization', `Bearer ${admin.accessToken}`);

    const entry = (audit.body.data as Array<{ action: string; reason: string | null }>).find(
      (row) => row.action === 'ATTENDANCE_UPDATED',
    );
    expect(entry?.reason).toContain('ABSENT -> PRESENT');
  });

  it('refuses to mark a student who is not in that class', async () => {
    const outsider = await createStudentInSection(tenant, {
      localPart: 'outsider',
      rollNo: 'R999',
      departmentId,
      section: 'B',
    });

    const response = await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({
        classId: klass.classId,
        date: TODAY.toISOString(),
        period: 1,
        records: [{ studentUserId: outsider.id, status: AttendanceStatus.PRESENT }],
      });

    expect(response.status).toBe(422);
  });

  it('denies a student trying to mark attendance', async () => {
    const response = await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({
        classId: klass.classId,
        date: TODAY.toISOString(),
        period: 1,
        records: [{ studentUserId: student.id, status: AttendanceStatus.PRESENT }],
      });

    expect(response.status).toBe(403);
  });

  it('exposes the roster a faculty member marks against', async () => {
    const response = await api()
      .get(`/api/v1/attendance/roster/${klass.classId}?date=${TODAY.toISOString()}&period=1`)
      .set('authorization', `Bearer ${facultySession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.students).toHaveLength(1);
    expect(response.body.data.students[0].rollNo).toBe('R001');
    expect(response.body.data.students[0].status).toBeNull();
  });
});

describe('the student view', () => {
  it('computes the percentage from counts across unequal subject totals', async () => {
    // Subject A: 1/1 present. Subject B: 0/20 present. Correct overall = 1/21 ≈ 4.76%.
    const second = await createSubjectAndClass(tenant, {
      code: 'CS102',
      departmentId,
      facultyUserId: faculty.id,
    });

    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 1, 1),
    });
    await seedAttendance(tenant, {
      klass: second,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 0, 20, 2),
    });

    const response = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.overall.present).toBe(1);
    expect(response.body.data.overall.total).toBe(21);
    expect(response.body.data.overall.percentage).toBe(4.76);
    // The mean of 100% and 0% would have been 50%.
    expect(response.body.data.overall.percentage).not.toBe(50);
  });

  it('raises the below-75% warning', async () => {
    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 7, 10),
    });

    const response = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.body.data.overall.percentage).toBe(70);
    expect(response.body.data.warning).toBe(true);
    expect(response.body.data.threshold).toBe(75);
  });

  it('does not warn a student sitting exactly on the threshold', async () => {
    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 15, 20),
    });

    const response = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.body.data.overall.percentage).toBe(75);
    expect(response.body.data.warning).toBe(false);
  });

  it('breaks the figure down per subject', async () => {
    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 8, 10),
    });

    const response = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.body.data.bySubject).toHaveLength(1);
    expect(response.body.data.bySubject[0].subject.code).toBe('CS101');
    expect(response.body.data.bySubject[0].percentage).toBe(80);
  });

  it('returns an empty overview rather than an error when nothing is recorded', async () => {
    const response = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.overall.total).toBe(0);
    expect(response.body.data.warning).toBe(false);
  });

  it('reports a trend bucketed over time', async () => {
    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 6, 10),
    });

    const response = await api()
      .get('/api/v1/attendance/trend?granularity=WEEKLY')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    const totals = (response.body.data as Array<{ total: number }>).reduce((sum, p) => sum + p.total, 0);
    expect(totals).toBe(10);
  });
});

describe('the correction workflow', () => {
  async function markAbsentAndGetRecordId(): Promise<string> {
    await api()
      .post('/api/v1/attendance')
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({
        classId: klass.classId,
        date: TODAY.toISOString(),
        period: 1,
        records: [{ studentUserId: student.id, status: AttendanceStatus.ABSENT }],
      });

    const records = await api()
      .get('/api/v1/attendance')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    return records.body.data[0].id as string;
  }

  it('runs request → approve → record corrected, with an audit trail', async () => {
    const attendanceId = await markAbsentAndGetRecordId();

    const requested = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({
        attendanceId,
        newValue: AttendanceStatus.PRESENT,
        reason: 'I was present and signed the register that day.',
      });

    expect(requested.status).toBe(201);
    expect(requested.body.data.status).toBe('PENDING');
    expect(requested.body.data.oldValue).toBe('ABSENT');

    const decided = await api()
      .patch(`/api/v1/attendance/corrections/${requested.body.data.id}`)
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({ decision: 'APPROVED', note: 'Register confirms attendance.' });

    expect(decided.status).toBe(200);
    expect(decided.body.data.status).toBe('APPROVED');

    // The underlying record actually changed.
    const summary = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(summary.body.data.overall.present).toBe(1);

    const admin = await createAndLogin(tenant, { roles: [Role.SYSTEM_ADMIN], localPart: 'audit2' });
    const audit = await api()
      .get('/api/v1/admin/audit-logs?limit=50')
      .set('authorization', `Bearer ${admin.accessToken}`);

    const entry = (audit.body.data as Array<{ action: string; reason: string | null }>).find(
      (row) => row.action === 'ATTENDANCE_CORRECTION_DECIDED',
    );
    // The trail carries the original value, the new value and the outcome.
    expect(entry?.reason).toBe('APPROVED: ABSENT -> PRESENT');
  });

  it('leaves the record untouched when rejected', async () => {
    const attendanceId = await markAbsentAndGetRecordId();

    const requested = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ attendanceId, newValue: AttendanceStatus.PRESENT, reason: 'I think this is wrong.' });

    await api()
      .patch(`/api/v1/attendance/corrections/${requested.body.data.id}`)
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({ decision: 'REJECTED', note: 'Register shows absent.' });

    const summary = await api()
      .get('/api/v1/attendance/summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(summary.body.data.overall.present).toBe(0);
  });

  it('cannot be decided twice', async () => {
    const attendanceId = await markAbsentAndGetRecordId();
    const requested = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ attendanceId, newValue: AttendanceStatus.PRESENT, reason: 'Please review this record.' });

    await api()
      .patch(`/api/v1/attendance/corrections/${requested.body.data.id}`)
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({ decision: 'APPROVED' });

    const second = await api()
      .patch(`/api/v1/attendance/corrections/${requested.body.data.id}`)
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({ decision: 'REJECTED' });

    expect(second.status).toBe(409);
  });

  it('rejects a second pending request for the same record', async () => {
    const attendanceId = await markAbsentAndGetRecordId();
    const body = {
      attendanceId,
      newValue: AttendanceStatus.PRESENT,
      reason: 'Requesting a review of this record.',
    };

    await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send(body);

    const duplicate = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send(body);

    expect(duplicate.status).toBe(409);
  });

  it('refuses a request for another student’s record', async () => {
    const attendanceId = await markAbsentAndGetRecordId();
    const other = await createStudentInSection(tenant, {
      localPart: 'meddler',
      rollNo: 'R002',
      departmentId,
    });
    const otherSession = await login(other);

    const response = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${otherSession.accessToken}`)
      .send({
        attendanceId,
        newValue: AttendanceStatus.PRESENT,
        reason: 'Trying to change a record that is not mine.',
      });

    expect(response.status).toBe(404);
  });

  it('refuses a request that would not change anything', async () => {
    const attendanceId = await markAbsentAndGetRecordId();

    const response = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({
        attendanceId,
        newValue: AttendanceStatus.ABSENT,
        reason: 'Asking for the value it already has.',
      });

    expect(response.status).toBe(422);
  });

  it('shows the student their own requests', async () => {
    const attendanceId = await markAbsentAndGetRecordId();
    await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ attendanceId, newValue: AttendanceStatus.PRESENT, reason: 'Please check the register.' });

    const mine = await api()
      .get('/api/v1/attendance/corrections/mine')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
  });

  it('notifies the student when a decision is made', async () => {
    const attendanceId = await markAbsentAndGetRecordId();
    const requested = await api()
      .post('/api/v1/attendance/corrections')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ attendanceId, newValue: AttendanceStatus.PRESENT, reason: 'Register confirms I attended.' });

    await api()
      .patch(`/api/v1/attendance/corrections/${requested.body.data.id}`)
      .set('authorization', `Bearer ${facultySession.accessToken}`)
      .send({ decision: 'APPROVED' });

    const notifications = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const titles = (notifications.body.data as Array<{ title: string }>).map((n) => n.title);
    expect(titles).toContain('Attendance correction approved');
  });
});

describe('scope roster view', () => {
  it('gives a mentor their whole section, ordered by who is most at risk', async () => {
    const mentor = await createFaculty(tenant, {
      localPart: 'mentor',
      roles: [Role.CLASS_MENTOR],
      departmentId,
      mentorOf: { batch: BATCH, section: SECTION },
    });
    const mentorSession = await login(mentor);

    const struggling = await createStudentInSection(tenant, {
      localPart: 'struggling',
      rollNo: 'R010',
      departmentId,
    });

    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(student.id, 9, 10),
    });
    await seedAttendance(tenant, {
      klass,
      markedByUserId: faculty.id,
      periods: attendancePattern(struggling.id, 4, 10, 2),
    });

    const response = await api()
      .get('/api/v1/attendance/scope-summary')
      .set('authorization', `Bearer ${mentorSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.students).toHaveLength(2);
    // Lowest percentage first — the point of the view.
    expect(response.body.data.students[0].percentage).toBe(40);
    expect(response.body.data.students[0].belowThreshold).toBe(true);
    expect(response.body.data.students[1].belowThreshold).toBe(false);
  });

  it('is not available to a student', async () => {
    const response = await api()
      .get('/api/v1/attendance/scope-summary')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(403);
  });
});
