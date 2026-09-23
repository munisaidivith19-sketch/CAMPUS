/** Discussions, comments, reporting and backend moderation (the queue UI is Part B). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
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
import { createDepartment, createFaculty, createStudentInSection } from '../helpers/academicFixtures.js';

let tenant: TestTenant;
let departmentId: string;
let author: TestUser;
let authorSession: LoggedIn;
let moderatorSession: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  tenant = await createTenant();
  departmentId = await createDepartment(tenant);

  author = await createStudentInSection(tenant, { localPart: 'poster', rollNo: 'D001', departmentId });
  authorSession = await login(author);

  const moderator = await createFaculty(tenant, {
    localPart: 'moderator',
    roles: [Role.HOD],
    departmentId,
  });
  moderatorSession = await login(moderator);
});

async function postDiscussion(title = 'Study group for algorithms?'): Promise<string> {
  const response = await api()
    .post('/api/v1/discussions')
    .set('authorization', `Bearer ${authorSession.accessToken}`)
    .send({
      title,
      body: 'Anyone interested in meeting weekly to work through problems?',
      category: 'Academics',
      tags: ['algorithms'],
    });

  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('discussions and comments', () => {
  it('creates and lists a thread', async () => {
    await postDiscussion();

    const list = await api()
      .get('/api/v1/discussions')
      .set('authorization', `Bearer ${authorSession.accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].author.userId).toBe(author.id);
    expect(list.body.data[0].tags).toContain('algorithms');
  });

  it('filters by category and tag', async () => {
    await postDiscussion('Algorithms thread');
    await api()
      .post('/api/v1/discussions')
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ title: 'Canteen menu', body: 'Thoughts on the new menu?', category: 'Campus', tags: ['food'] });

    const byCategory = await api()
      .get('/api/v1/discussions?category=Campus')
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(byCategory.body.data).toHaveLength(1);

    const byTag = await api()
      .get('/api/v1/discussions?tag=algorithms')
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(byTag.body.data).toHaveLength(1);
  });

  it('adds comments and keeps the count in step', async () => {
    const discussionId = await postDiscussion();

    const comment = await api()
      .post(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ body: 'I would join that.' });

    expect(comment.status).toBe(201);

    const detail = await api()
      .get(`/api/v1/discussions/${discussionId}`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(detail.body.data.commentCount).toBe(1);

    const comments = await api()
      .get(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(comments.body.data).toHaveLength(1);
  });

  it('supports threaded replies but only within the same thread', async () => {
    const discussionId = await postDiscussion();
    const otherId = await postDiscussion('Another thread');

    const parent = await api()
      .post(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ body: 'Top level.' });

    const reply = await api()
      .post(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ body: 'A reply.', parentCommentId: parent.body.data.id });
    expect(reply.status).toBe(201);
    expect(reply.body.data.parentCommentId).toBe(parent.body.data.id);

    // A parent from a different thread is not a valid parent.
    const crossThread = await api()
      .post(`/api/v1/discussions/${otherId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ body: 'Wrong thread.', parentCommentId: parent.body.data.id });
    expect(crossThread.status).toBe(404);
  });

  it('toggles a reaction idempotently per user', async () => {
    const discussionId = await postDiscussion();
    const comment = await api()
      .post(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ body: 'React to me.' });

    const on = await api()
      .post(`/api/v1/comments/${comment.body.data.id}/reactions`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(on.body.data.reactionCount).toBe(1);
    expect(on.body.data.reactedByMe).toBe(true);

    const off = await api()
      .post(`/api/v1/comments/${comment.body.data.id}/reactions`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(off.body.data.reactionCount).toBe(0);
    expect(off.body.data.reactedByMe).toBe(false);
  });
});

describe('reporting and moderation', () => {
  it('runs report → moderator removes → content disappears from listings', async () => {
    const discussionId = await postDiscussion('Something inappropriate');

    const reported = await api()
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ targetType: 'DISCUSSION', targetId: discussionId, reason: 'This breaks the code of conduct.' });
    expect(reported.status).toBe(201);

    const queue = await api()
      .get('/api/v1/moderation/queue')
      .set('authorization', `Bearer ${moderatorSession.accessToken}`);
    expect(queue.body.data.discussions).toHaveLength(1);
    expect(queue.body.data.discussions[0].reportedCount).toBe(1);

    const removed = await api()
      .post(`/api/v1/moderation/discussions/${discussionId}`)
      .set('authorization', `Bearer ${moderatorSession.accessToken}`)
      .send({ action: 'REMOVE', note: 'Violates the code of conduct.' });
    expect(removed.body.data.status).toBe('REMOVED');

    const list = await api()
      .get('/api/v1/discussions')
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(list.body.data).toHaveLength(0);

    const detail = await api()
      .get(`/api/v1/discussions/${discussionId}`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(detail.status).toBe(404);
  });

  it('audits the removal with the actor and the reason', async () => {
    const discussionId = await postDiscussion('To be removed');
    await api()
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ targetType: 'DISCUSSION', targetId: discussionId, reason: 'Spam content here.' });

    await api()
      .post(`/api/v1/moderation/discussions/${discussionId}`)
      .set('authorization', `Bearer ${moderatorSession.accessToken}`)
      .send({ action: 'REMOVE', note: 'Spam.' });

    const admin = await createAndLogin(tenant, { roles: [Role.SYSTEM_ADMIN], localPart: 'audit' });
    const audit = await api()
      .get('/api/v1/admin/audit-logs?limit=50')
      .set('authorization', `Bearer ${admin.accessToken}`);

    const actions = (audit.body.data as Array<{ action: string; reason: string | null }>);
    expect(actions.some((row) => row.action === 'CONTENT_REPORTED')).toBe(true);
    const removal = actions.find((row) => row.action === 'CONTENT_REMOVED');
    expect(removal?.reason).toContain('REMOVED');
  });

  it('dismisses a report without touching the content', async () => {
    const discussionId = await postDiscussion('Wrongly reported');
    await api()
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ targetType: 'DISCUSSION', targetId: discussionId, reason: 'I disagree with this post.' });

    const dismissed = await api()
      .post(`/api/v1/moderation/discussions/${discussionId}`)
      .set('authorization', `Bearer ${moderatorSession.accessToken}`)
      .send({ action: 'DISMISS' });
    expect(dismissed.body.data.status).toBe('DISMISSED');

    // Still visible, and out of the queue.
    const list = await api()
      .get('/api/v1/discussions')
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(list.body.data).toHaveLength(1);

    const queue = await api()
      .get('/api/v1/moderation/queue')
      .set('authorization', `Bearer ${moderatorSession.accessToken}`);
    expect(queue.body.data.discussions).toHaveLength(0);
  });

  it('removes a comment and decrements the thread count', async () => {
    const discussionId = await postDiscussion();
    const comment = await api()
      .post(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ body: 'Offensive comment.' });

    await api()
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ targetType: 'COMMENT', targetId: comment.body.data.id, reason: 'Abusive language used.' });

    await api()
      .post(`/api/v1/moderation/comments/${comment.body.data.id}`)
      .set('authorization', `Bearer ${moderatorSession.accessToken}`)
      .send({ action: 'REMOVE', note: 'Abusive.' });

    const comments = await api()
      .get(`/api/v1/discussions/${discussionId}/comments`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(comments.body.data).toHaveLength(0);

    const detail = await api()
      .get(`/api/v1/discussions/${discussionId}`)
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(detail.body.data.commentCount).toBe(0);
  });

  it('denies a student the moderation queue and the remove action', async () => {
    const discussionId = await postDiscussion();

    const queue = await api()
      .get('/api/v1/moderation/queue')
      .set('authorization', `Bearer ${authorSession.accessToken}`);
    expect(queue.status).toBe(403);

    const remove = await api()
      .post(`/api/v1/moderation/discussions/${discussionId}`)
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ action: 'REMOVE' });
    expect(remove.status).toBe(403);
  });

  it('requires a substantive reason when reporting', async () => {
    const discussionId = await postDiscussion();

    const response = await api()
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${authorSession.accessToken}`)
      .send({ targetType: 'DISCUSSION', targetId: discussionId, reason: 'bad' });

    expect(response.status).toBe(422);
  });
});
