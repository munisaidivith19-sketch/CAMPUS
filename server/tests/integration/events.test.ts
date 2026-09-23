/**
 * Events: creation authority, registration, capacity, and QR check-in.
 *
 * The check-in tests are the important ones — they prove the reused Phase 2 QRToken keeps its
 * properties here: opaque, single-use, purpose-bound.
 */
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
  createClub,
  createDepartment,
  createFaculty,
  createStudentInSection,
} from '../helpers/academicFixtures.js';

let tenant: TestTenant;
let departmentId: string;
let clubAdmin: TestUser;
let clubAdminSession: LoggedIn;
let clubId: string;
let student: TestUser;
let studentSession: LoggedIn;

const inDays = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  clubAdmin = await createFaculty(tenant, {
    localPart: 'clubhead',
    roles: [Role.CLUB_ADMIN],
    departmentId,
  });
  clubAdminSession = await login(clubAdmin);
  clubId = await createClub(tenant, { name: 'Coding Club', adminUserIds: [clubAdmin.id] });

  student = await createStudentInSection(tenant, {
    localPart: 'attendee',
    rollNo: 'E001',
    departmentId,
    interests: ['technology'],
  });
  studentSession = await login(student);
});

async function createEvent(capacity: number | null = null): Promise<string> {
  const response = await api()
    .post('/api/v1/events')
    .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
    .send({
      title: 'Hackathon',
      description: 'A 24-hour build sprint.',
      category: 'Technology',
      venue: 'Lab 1',
      startsAt: inDays(7),
      endsAt: inDays(8),
      ...(capacity === null ? {} : { capacity }),
      organizer: { type: 'CLUB', clubId },
    });

  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('creating events', () => {
  it('lets a club admin create an event for their own club', async () => {
    const eventId = await createEvent();

    const detail = await api()
      .get(`/api/v1/events/${eventId}`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(detail.body.data.organizer.name).toBe('Coding Club');
    expect(detail.body.data.status).toBe('PUBLISHED');
  });

  it('stops a club admin creating an event for a club they do not run', async () => {
    const otherClub = await createClub(tenant, { name: 'Robotics' });

    const response = await api()
      .post('/api/v1/events')
      .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
      .send({
        title: 'Not mine',
        description: 'Should be refused.',
        category: 'Technology',
        venue: 'Hall',
        startsAt: inDays(2),
        endsAt: inDays(3),
        organizer: { type: 'CLUB', clubId: otherClub },
      });

    expect(response.status).toBe(403);
  });

  it('denies a student creating events', async () => {
    const response = await api()
      .post('/api/v1/events')
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({
        title: 'Student event',
        description: 'Should be refused.',
        category: 'Technology',
        venue: 'Hall',
        startsAt: inDays(2),
        endsAt: inDays(3),
        organizer: { type: 'CLUB', clubId },
      });

    expect(response.status).toBe(403);
  });

  it('rejects an event that ends before it starts', async () => {
    const response = await api()
      .post('/api/v1/events')
      .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
      .send({
        title: 'Time travel',
        description: 'Invalid schedule.',
        category: 'Technology',
        venue: 'Hall',
        startsAt: inDays(5),
        endsAt: inDays(2),
        organizer: { type: 'CLUB', clubId },
      });

    expect(response.status).toBe(422);
  });
});

describe('registration', () => {
  it('registers a student and reflects it on the event', async () => {
    const eventId = await createEvent();

    const registered = await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(registered.status).toBe(201);
    expect(registered.body.data.status).toBe('REGISTERED');

    const detail = await api()
      .get(`/api/v1/events/${eventId}`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(detail.body.data.registeredCount).toBe(1);
    expect(detail.body.data.registration.status).toBe('REGISTERED');
  });

  it('refuses a duplicate registration', async () => {
    const eventId = await createEvent();

    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const duplicate = await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(duplicate.status).toBe(409);
  });

  it('enforces capacity', async () => {
    const eventId = await createEvent(1);

    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const second = await createStudentInSection(tenant, {
      localPart: 'latecomer',
      rollNo: 'E002',
      departmentId,
    });
    const secondSession = await login(second);

    const response = await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${secondSession.accessToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/full/i);
  });

  it('reports seats remaining', async () => {
    const eventId = await createEvent(10);
    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const detail = await api()
      .get(`/api/v1/events/${eventId}`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(detail.body.data.seatsRemaining).toBe(9);
  });

  it('lists the caller’s own registrations', async () => {
    const eventId = await createEvent();
    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const response = await api()
      .get('/api/v1/events/registrations')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].eventTitle).toBe('Hackathon');
  });
});

describe('QR check-in', () => {
  async function registerAndIssueQr(eventId: string): Promise<string> {
    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const qr = await api()
      .post(`/api/v1/events/${eventId}/qr`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(qr.status).toBe(200);
    return qr.body.data.token as string;
  }

  it('issues an opaque code carrying no personal data', async () => {
    const eventId = await createEvent();
    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const qr = await api()
      .post(`/api/v1/events/${eventId}/qr`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const token = qr.body.data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(student.id);
    expect(token).not.toContain('E001');
    expect(qr.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('checks an attendee in and resolves who they are server-side', async () => {
    const eventId = await createEvent();
    const token = await registerAndIssueQr(eventId);

    const response = await api()
      .post(`/api/v1/events/${eventId}/check-in`)
      .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
      .send({ token });

    expect(response.status).toBe(200);
    expect(response.body.data.attendee.userId).toBe(student.id);
    expect(response.body.data.attendee.rollNo).toBe('E001');
    expect(response.body.data.checkedInAt).toBeTruthy();
  });

  it('rejects a replayed code', async () => {
    const eventId = await createEvent();
    const token = await registerAndIssueQr(eventId);

    await api()
      .post(`/api/v1/events/${eventId}/check-in`)
      .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
      .send({ token });

    const replay = await api()
      .post(`/api/v1/events/${eventId}/check-in`)
      .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
      .send({ token });

    // The single-use claim fails on the second scan.
    expect(replay.status).toBe(404);
  });

  it('refuses a student-ID code presented at an event scanner', async () => {
    const eventId = await createEvent();
    await api()
      .post(`/api/v1/events/${eventId}/register`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    // Issue a STUDENT_ID-purpose code instead of an event one.
    const { issueQrToken } = await import('../../src/services/qr.service.js');
    const { QRPurpose } = await import('@campusconnect/types');
    const wrongPurpose = await issueQrToken(
      tenant.institutionId,
      student.id,
      student.id,
      QRPurpose.STUDENT_ID,
      { ip: '::1', userAgent: 'test' },
    );

    const response = await api()
      .post(`/api/v1/events/${eventId}/check-in`)
      .set('authorization', `Bearer ${clubAdminSession.accessToken}`)
      .send({ token: wrongPurpose.token });

    expect(response.status).toBe(404);
  });

  it('will not issue a code for an event the caller did not register for', async () => {
    const eventId = await createEvent();

    const response = await api()
      .post(`/api/v1/events/${eventId}/qr`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('denies a student the check-in scanner', async () => {
    const eventId = await createEvent();
    const token = await registerAndIssueQr(eventId);

    const response = await api()
      .post(`/api/v1/events/${eventId}/check-in`)
      .set('authorization', `Bearer ${studentSession.accessToken}`)
      .send({ token });

    expect(response.status).toBe(403);
  });
});

describe('discovery', () => {
  it('suggests events by rule with reasons', async () => {
    await createEvent();

    const response = await api()
      .get('/api/v1/events?suggested=true')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].matchReasons).toContain('Matches your interest in technology');
  });
});
