/** Announcements, clubs, notifications and the search facade. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnnouncementScope, ClubMembershipStatus, Role } from '@campusconnect/types';
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
  createClub,
  createDepartment,
  createFaculty,
  createStudentInSection,
  setDepartmentHod,
} from '../helpers/academicFixtures.js';

let tenant: TestTenant;
let departmentId: string;
let student: TestUser;
let studentSession: LoggedIn;
let principalSession: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  student = await createStudentInSection(tenant, {
    localPart: 'pupil',
    rollNo: 'C001',
    departmentId,
    interests: ['coding'],
  });
  studentSession = await login(student);

  const principal = await createFaculty(tenant, {
    localPart: 'principal',
    roles: [Role.PRINCIPAL],
    departmentId,
  });
  principalSession = await login(principal);
});

describe('announcement targeting', () => {
  it('delivers a college-wide notice to everyone', async () => {
    const created = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Campus closed on Friday',
        body: 'The campus will be closed for maintenance.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    expect(created.status).toBe(201);

    const feed = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(feed.body.data).toHaveLength(1);
    expect(feed.body.data[0].title).toBe('Campus closed on Friday');
    expect(feed.body.data[0].read).toBe(false);
  });

  it('delivers a section notice only to that section', async () => {
    const outsider = await createStudentInSection(tenant, {
      localPart: 'othersection',
      rollNo: 'C099',
      departmentId,
      section: 'B',
    });
    const outsiderSession = await login(outsider);

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Section A lab records due',
        body: 'Submit before Friday.',
        target: { scope: AnnouncementScope.SECTION, batch: BATCH, section: SECTION },
      });

    const targeted = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const notTargeted = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${outsiderSession.accessToken}`);

    expect(targeted.body.data).toHaveLength(1);
    // The student in section B must not see it at all.
    expect(notTargeted.body.data).toHaveLength(0);
  });

  it('delivers a department notice only within that department', async () => {
    const otherDepartment = await createDepartment(tenant, 'ECE', 'Electronics');
    const outsider = await createStudentInSection(tenant, {
      localPart: 'ecestudent',
      rollNo: 'E001',
      departmentId: otherDepartment,
    });
    const outsiderSession = await login(outsider);

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'CSE seminar',
        body: 'Guest lecture this Thursday.',
        target: { scope: AnnouncementScope.DEPARTMENT, departmentId },
      });

    const inside = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const outside = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${outsiderSession.accessToken}`);

    expect(inside.body.data).toHaveLength(1);
    expect(outside.body.data).toHaveLength(0);
  });

  it('rejects a target whose required reference is missing', async () => {
    const response = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Incomplete target',
        body: 'This should not publish.',
        // SECTION without batch/section would otherwise broadcast wider than intended.
        target: { scope: AnnouncementScope.SECTION },
      });

    expect(response.status).toBe(422);
  });

  it('does not deliver a scheduled announcement before its time', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Scheduled for tomorrow',
        body: 'Not yet visible.',
        target: { scope: AnnouncementScope.COLLEGE },
        publishAt: tomorrow.toISOString(),
      });

    const feed = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(feed.body.data).toHaveLength(0);
  });

  it('hides an expired announcement', async () => {
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const alsoPast = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Old notice',
        body: 'Expired.',
        target: { scope: AnnouncementScope.COLLEGE },
        publishAt: past.toISOString(),
        expireAt: alsoPast.toISOString(),
      });

    const feed = await api()
      .get('/api/v1/announcements')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(feed.body.data).toHaveLength(0);
  });

  it('marks an announcement read when it is opened', async () => {
    const created = await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Read me',
        body: 'Body text.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    const detail = await api()
      .get(`/api/v1/announcements/${created.body.data.id}`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(detail.body.data.read).toBe(true);

    const unread = await api()
      .get('/api/v1/announcements?unreadOnly=true')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(unread.body.data).toHaveLength(0);
  });

  it('notifies the targeted audience', async () => {
    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Exam timetable published',
        body: 'Check the notice board.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    const notifications = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(notifications.body.data[0].title).toBe('Exam timetable published');
    expect(notifications.body.data[0].type).toBe('ANNOUNCEMENT');
  });
});

describe('clubs', () => {
  it('lists clubs with the caller’s membership state', async () => {
    await createClub(tenant, { name: 'Coding Club', interests: ['coding'] });

    const response = await api()
      .get('/api/v1/clubs')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].name).toBe('Coding Club');
    expect(response.body.data[0].membership).toBeNull();
  });

  it('runs request → approve and updates the member count', async () => {
    const admin = await createFaculty(tenant, {
      localPart: 'clubadmin',
      roles: [Role.CLUB_ADMIN],
      departmentId,
    });
    const adminSession = await login(admin);
    const clubId = await createClub(tenant, {
      name: 'Robotics',
      interests: ['robotics'],
      adminUserIds: [admin.id],
    });

    const requested = await api()
      .post(`/api/v1/clubs/${clubId}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(requested.status).toBe(201);
    expect(requested.body.data.status).toBe(ClubMembershipStatus.REQUESTED);

    const decided = await api()
      .patch(`/api/v1/clubs/memberships/${requested.body.data.id}`)
      .set('authorization', `Bearer ${adminSession.accessToken}`)
      .send({ decision: ClubMembershipStatus.APPROVED });

    expect(decided.status).toBe(200);
    expect(decided.body.data.status).toBe(ClubMembershipStatus.APPROVED);

    const club = await api()
      .get(`/api/v1/clubs/${clubId}`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(club.body.data.memberCount).toBe(1);
    expect(club.body.data.membership.status).toBe(ClubMembershipStatus.APPROVED);
  });

  it('rejects a duplicate join request', async () => {
    const clubId = await createClub(tenant, { name: 'Chess' });

    await api()
      .post(`/api/v1/clubs/${clubId}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const duplicate = await api()
      .post(`/api/v1/clubs/${clubId}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(duplicate.status).toBe(409);
  });

  it('does not let a non-admin decide a membership', async () => {
    const admin = await createFaculty(tenant, { localPart: 'realadmin', roles: [Role.CLUB_ADMIN] });
    const clubId = await createClub(tenant, { name: 'Drama', adminUserIds: [admin.id] });

    const requested = await api()
      .post(`/api/v1/clubs/${clubId}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    // Another club admin who does not run THIS club.
    const impostor = await createFaculty(tenant, { localPart: 'impostor', roles: [Role.CLUB_ADMIN] });
    const impostorSession = await login(impostor);

    const response = await api()
      .patch(`/api/v1/clubs/memberships/${requested.body.data.id}`)
      .set('authorization', `Bearer ${impostorSession.accessToken}`)
      .send({ decision: ClubMembershipStatus.APPROVED });

    expect(response.status).toBe(403);
  });

  it('suggests clubs by rule, with reasons, and never one already joined', async () => {
    const joined = await createClub(tenant, { name: 'Already In', interests: ['coding'] });
    await createClub(tenant, { name: 'Code Craft', interests: ['coding'] });
    // A different category AND different interests, so no rule can match it.
    await createClub(tenant, { name: 'Gardening', category: 'Outdoors', interests: ['plants'] });

    await api()
      .post(`/api/v1/clubs/${joined}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const response = await api()
      .get('/api/v1/clubs?suggested=true')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const names = (response.body.data as Array<{ name: string; matchReasons: string[] }>).map((c) => c.name);
    expect(names).toContain('Code Craft');
    expect(names).not.toContain('Already In');
    expect(names).not.toContain('Gardening');
    expect(response.body.data[0].matchReasons[0]).toContain('coding');
  });

  it('suggests on a shared category even without a shared interest', async () => {
    // Joining a Technology club makes other Technology clubs a rule-based match.
    const joined = await createClub(tenant, { name: 'Tech Base', category: 'Technology', interests: [] });
    await createClub(tenant, { name: 'Tech Peer', category: 'Technology', interests: [] });
    await createClub(tenant, { name: 'Pottery', category: 'Crafts', interests: [] });

    await api()
      .post(`/api/v1/clubs/${joined}/join`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const response = await api()
      .get('/api/v1/clubs?suggested=true')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const names = (response.body.data as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('Tech Peer');
    expect(names).not.toContain('Pottery');
  });
});

describe('notifications', () => {
  it('marks one read and then all', async () => {
    for (const title of ['One', 'Two']) {
      await api()
        .post('/api/v1/announcements')
        .set('authorization', `Bearer ${principalSession.accessToken}`)
        .send({ title, body: 'Body.', target: { scope: AnnouncementScope.COLLEGE } });
    }

    const list = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(list.body.data).toHaveLength(2);

    const first = list.body.data[0].id as string;
    const marked = await api()
      .patch(`/api/v1/notifications/${first}/read`)
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(marked.status).toBe(200);

    const unread = await api()
      .get('/api/v1/notifications?unreadOnly=true')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(unread.body.data).toHaveLength(1);

    await api()
      .post('/api/v1/notifications/read-all')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    const none = await api()
      .get('/api/v1/notifications?unreadOnly=true')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    expect(none.body.data).toHaveLength(0);
  });

  it('will not mark another user’s notification read', async () => {
    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({ title: 'For everyone', body: 'Body.', target: { scope: AnnouncementScope.COLLEGE } });

    const victimList = await api()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const victimNotificationId = victimList.body.data[0].id as string;

    const attacker = await createStudentInSection(tenant, {
      localPart: 'attacker',
      rollNo: 'C500',
      departmentId,
    });
    const attackerSession = await login(attacker);

    const response = await api()
      .patch(`/api/v1/notifications/${victimNotificationId}/read`)
      .set('authorization', `Bearer ${attackerSession.accessToken}`);

    expect(response.status).toBe(404);
  });
});

describe('search', () => {
  it('finds announcements the caller is addressed in, and clubs', async () => {
    await createClub(tenant, { name: 'Quantum Society', interests: ['physics'] });
    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Quantum computing workshop',
        body: 'A hands-on session on quantum algorithms.',
        target: { scope: AnnouncementScope.COLLEGE },
      });

    const response = await api()
      .get('/api/v1/search?q=quantum')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(200);
    const kinds = (response.body.data as Array<{ kind: string }>).map((r) => r.kind);
    expect(kinds).toContain('ANNOUNCEMENT');
    expect(kinds).toContain('CLUB');
  });

  it('does not surface an announcement the caller was not addressed in', async () => {
    const outsider = await createStudentInSection(tenant, {
      localPart: 'sectionb',
      rollNo: 'C600',
      departmentId,
      section: 'B',
    });
    const outsiderSession = await login(outsider);

    await api()
      .post('/api/v1/announcements')
      .set('authorization', `Bearer ${principalSession.accessToken}`)
      .send({
        title: 'Sectional briefing about telescopes',
        body: 'Telescopes for section A only.',
        target: { scope: AnnouncementScope.SECTION, batch: BATCH, section: SECTION },
      });

    const addressed = await api()
      .get('/api/v1/search?q=telescopes')
      .set('authorization', `Bearer ${studentSession.accessToken}`);
    const notAddressed = await api()
      .get('/api/v1/search?q=telescopes')
      .set('authorization', `Bearer ${outsiderSession.accessToken}`);

    expect(addressed.body.data.length).toBeGreaterThan(0);
    // Search must not become a side channel to content you cannot read.
    expect(notAddressed.body.data).toHaveLength(0);
  });

  it('requires a usable search term', async () => {
    const response = await api()
      .get('/api/v1/search?q=a')
      .set('authorization', `Bearer ${studentSession.accessToken}`);

    expect(response.status).toBe(422);
  });
});
