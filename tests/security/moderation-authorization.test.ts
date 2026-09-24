/**
 * Moderation across tenants and against hostile input. A report in one institution does not
 * exist for another institution's moderators, in the queue or when deciding.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@campusconnect/types';
import {
  api,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createTenant,
  disconnectTestDatabase,
  type LoggedIn,
  type TestTenant,
} from '../../server/tests/helpers/testHarness.js';

let ours: TestTenant;
let theirs: TestTenant;
let author: LoggedIn;
let reporter: LoggedIn;
let ourPrincipal: LoggedIn;
let theirPrincipal: LoggedIn;
let discussionId: string;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  ours = await createTenant();
  theirs = await createTenant();
  author = await createAndLogin(ours, { roles: [Role.STUDENT], localPart: 'author' });
  reporter = await createAndLogin(ours, { roles: [Role.STUDENT], localPart: 'reporter' });
  ourPrincipal = await createAndLogin(ours, { roles: [Role.PRINCIPAL], localPart: 'p1' });
  theirPrincipal = await createAndLogin(theirs, { roles: [Role.PRINCIPAL], localPart: 'p2' });

  const created = await api()
    .post('/api/v1/discussions')
    .set('authorization', `Bearer ${author.accessToken}`)
    .send({ title: 'Reported thread', body: 'Something reported', category: 'General' });
  discussionId = created.body.data.id as string;
  await api()
    .post('/api/v1/reports')
    .set('authorization', `Bearer ${reporter.accessToken}`)
    .send({ targetType: 'DISCUSSION', targetId: discussionId, reason: 'Inappropriate content.' });
});

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];

describe('moderation tenant isolation', () => {
  it('keeps another institution’s reports out of the queue', async () => {
    const theirQueue = await api()
      .get('/api/v1/moderation/reports')
      .set(...auth(theirPrincipal));
    expect(theirQueue.body.data).toEqual([]);
    const ourQueue = await api()
      .get('/api/v1/moderation/reports')
      .set(...auth(ourPrincipal));
    expect(ourQueue.body.data).toHaveLength(1);
  });

  it('answers a cross-tenant decision with NOT_FOUND and changes nothing', async () => {
    const response = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(theirPrincipal))
      .send({
        targetType: 'DISCUSSION',
        targetId: discussionId,
        action: 'REMOVE',
        note: 'Cross-tenant attempt.',
      });
    expect(response.status).toBe(404);
    const detail = await api()
      .get(`/api/v1/discussions/${discussionId}`)
      .set(...auth(author));
    expect(detail.status).toBe(200);
  });

  it('keeps another institution’s decisions out of the history', async () => {
    await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(ourPrincipal))
      .send({ targetType: 'DISCUSSION', targetId: discussionId, action: 'DISMISS' });
    const theirs = await api()
      .get('/api/v1/moderation/history')
      .set(...auth(theirPrincipal));
    expect(theirs.body.data).toEqual([]);
  });
});

describe('moderation input', () => {
  it('rejects operator injection and unknown target types', async () => {
    const injected = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(ourPrincipal))
      .send({ targetType: 'DISCUSSION', targetId: { $ne: null }, action: 'DISMISS' });
    expect(injected.status).toBe(422);

    const unknownType = await api()
      .post('/api/v1/moderation/reports/decide')
      .set(...auth(ourPrincipal))
      .send({ targetType: 'USER', targetId: discussionId, action: 'DISMISS' });
    expect(unknownType.status).toBe(422);

    const badStatus = await api()
      .get('/api/v1/moderation/reports?status[$ne]=x')
      .set(...auth(ourPrincipal));
    // The operator key is stripped, leaving an empty object that fails validation: refused,
    // never widened to "every status".
    expect(badStatus.status).toBe(422);
  });
});
