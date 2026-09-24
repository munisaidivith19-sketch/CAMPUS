/**
 * File authorization: who may open a file, and what a signed URL can and cannot do.
 *
 * The rule under test: **a file has no access list of its own.** It is its owner's until it is
 * attached, and then belongs to exactly those who can read the thing it is attached to — so
 * leaving a chat, being removed from it, or not being addressed by an announcement all mean the
 * file does not exist for you. Every refusal is NOT_FOUND, never FORBIDDEN.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnnouncementScope, ChatType, Role, UserStatus } from '@campusconnect/types';
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
} from '../../server/tests/helpers/testHarness.js';
import {
  createDepartment,
  createStudentInSection,
} from '../../server/tests/helpers/academicFixtures.js';
import { MIME, pdfBytes, uploadOk } from '../../server/tests/helpers/fileFixtures.js';
import { signDownloadToken } from '../../server/src/utils/fileSigning.js';
import { UserModel } from '../../server/src/models/User.model.js';
import { resetChatNotificationDebounce } from '../../server/src/services/chat.service.js';

let ours: TestTenant;
let theirs: TestTenant;
let alice: LoggedIn;
let bob: LoggedIn;
let carol: LoggedIn;
let outsider: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  resetChatNotificationDebounce();
  ours = await createTenant();
  theirs = await createTenant();
  const departmentId = await createDepartment(ours);
  alice = await login(
    await createStudentInSection(ours, { localPart: 'alice', rollNo: 'S001', departmentId }),
  );
  bob = await login(
    await createStudentInSection(ours, { localPart: 'bob', rollNo: 'S002', departmentId }),
  );
  carol = await login(
    await createStudentInSection(ours, { localPart: 'carol', rollNo: 'S003', departmentId }),
  );
  outsider = await login(
    await createUser(theirs, { roles: [Role.STUDENT], localPart: 'outsider' }),
  );
});

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];

let counter = 0;
const clientId = (): string => `sec-file-${(counter += 1)}-${Date.now()}`;

async function sendWithFile(from: LoggedIn, chatId: string, fileId: string): Promise<string> {
  const response = await api()
    .post(`/api/v1/chats/${chatId}/messages`)
    .set(...auth(from))
    .send({ body: 'attached', clientMessageId: clientId(), attachmentFileIds: [fileId] });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function openDirect(from: LoggedIn, to: LoggedIn): Promise<string> {
  const response = await api()
    .post('/api/v1/chats')
    .set(...auth(from))
    .send({ type: ChatType.DIRECT, userId: to.user.id });
  return response.body.data.id as string;
}

async function openGroup(owner: LoggedIn, members: LoggedIn[]): Promise<string> {
  const response = await api()
    .post('/api/v1/chats')
    .set(...auth(owner))
    .send({ type: ChatType.GROUP, name: 'Study group', memberIds: members.map((m) => m.user.id) });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/** The status a session gets for a file's metadata/URL endpoint. */
async function metaStatus(session: LoggedIn, fileId: string): Promise<number> {
  return (
    await api()
      .get(`/api/v1/files/${fileId}`)
      .set(...auth(session))
  ).status;
}

async function contentStatus(url: string): Promise<number> {
  return (await api().get(url)).status;
}

describe('private (unattached) files', () => {
  it('belong to their owner alone', async () => {
    const fileId = await uploadOk(alice);
    expect(await metaStatus(alice, fileId)).toBe(200);
    expect(await metaStatus(bob, fileId)).toBe(404);
    expect(
      (
        await api()
          .get(`/api/v1/files/${fileId}/meta`)
          .set(...auth(bob))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .delete(`/api/v1/files/${fileId}`)
          .set(...auth(bob))
      ).status,
    ).toBe(404);
  });

  it('do not exist for another tenant — not even their metadata', async () => {
    const fileId = await uploadOk(alice);
    expect(await metaStatus(outsider, fileId)).toBe(404);
    expect(
      (
        await api()
          .get(`/api/v1/files/${fileId}/meta`)
          .set(...auth(outsider))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .delete(`/api/v1/files/${fileId}`)
          .set(...auth(outsider))
      ).status,
    ).toBe(404);
  });

  it('answer a malformed or unknown id with the same NOT_FOUND shape', async () => {
    expect(
      (
        await api()
          .get('/api/v1/files/not-an-id')
          .set(...auth(alice))
      ).status,
    ).toBe(422);
    expect(await metaStatus(alice, 'aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(404);
  });
});

describe('files attached to chat messages', () => {
  it('open for members of the chat and nobody else', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    await sendWithFile(alice, chatId, fileId);

    expect(await metaStatus(alice, fileId)).toBe(200);
    expect(await metaStatus(bob, fileId)).toBe(200);
    expect(await metaStatus(carol, fileId)).toBe(404); // same tenant, not in the chat
    expect(await metaStatus(outsider, fileId)).toBe(404); // other tenant
  });

  it('close the moment a member is removed — including URLs minted before the removal', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openGroup(alice, [bob, carol]);
    await sendWithFile(alice, chatId, fileId);

    const minted = await api()
      .get(`/api/v1/files/${fileId}`)
      .set(...auth(carol));
    expect(minted.status).toBe(200);
    expect(await contentStatus(minted.body.data.url as string)).toBe(200);

    const removed = await api()
      .delete(`/api/v1/chats/${chatId}/members/${carol.user.id}`)
      .set(...auth(alice));
    expect(removed.status).toBe(200);

    expect(await metaStatus(carol, fileId)).toBe(404);
    expect(await contentStatus(minted.body.data.url as string)).toBe(404);
    expect(await metaStatus(bob, fileId)).toBe(200);
  });

  it('close for a member who leaves', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openGroup(alice, [bob]);
    await sendWithFile(alice, chatId, fileId);
    expect(
      (
        await api()
          .post(`/api/v1/chats/${chatId}/leave`)
          .set(...auth(bob))
      ).status,
    ).toBe(200);
    expect(await metaStatus(bob, fileId)).toBe(404);
  });

  it('cannot be attached by someone who does not own them, nor into a chat you are not in', async () => {
    const bobsFile = await uploadOk(bob);
    const aliceBob = await openDirect(alice, bob);
    const denied = await api()
      .post(`/api/v1/chats/${aliceBob}/messages`)
      .set(...auth(alice))
      .send({ body: 'x', clientMessageId: clientId(), attachmentFileIds: [bobsFile] });
    expect(denied.status).toBe(404);

    const bobCarol = await openDirect(bob, carol);
    const ownFile = await uploadOk(alice);
    const intruding = await api()
      .post(`/api/v1/chats/${bobCarol}/messages`)
      .set(...auth(alice))
      .send({ body: 'x', clientMessageId: clientId(), attachmentFileIds: [ownFile] });
    expect(intruding.status).toBe(404);
    // The failed attempts left the files unattached.
    expect(
      (
        await api()
          .get(`/api/v1/files/${ownFile}/meta`)
          .set(...auth(alice))
      ).body.data.linkedResource,
    ).toBeNull();
  });

  it('never put a URL or storage key in the message, over REST', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    await sendWithFile(alice, chatId, fileId);
    const history = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(bob));
    const serialized = JSON.stringify(history.body);
    expect(serialized).not.toMatch(/token=|storageKey|\/content/);
  });

  it('reject operator injection in the attachment list', async () => {
    const chatId = await openDirect(alice, bob);
    const response = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'x', clientMessageId: clientId(), attachmentFileIds: [{ $ne: null }] });
    expect(response.status).toBe(422);
  });
});

describe('files attached to announcements', () => {
  it('open only for those the announcement is addressed to', async () => {
    const principal = await createAndLogin(ours, { roles: [Role.PRINCIPAL] });
    const fileId = await uploadOk(principal, pdfBytes('for section B'), 'b.pdf', MIME.pdf);
    const created = await api()
      .post('/api/v1/announcements')
      .set(...auth(principal))
      .send({
        title: 'Section B only',
        body: 'x',
        target: { scope: AnnouncementScope.SECTION, batch: '2024-2028', section: 'B' },
        attachmentFileIds: [fileId],
      });
    expect(created.status).toBe(201);

    expect(await metaStatus(principal, fileId)).toBe(200);
    expect(await metaStatus(alice, fileId)).toBe(404); // section A
    expect(await metaStatus(outsider, fileId)).toBe(404);
  });
});

describe('signed download URLs', () => {
  async function linkedFile(): Promise<{ fileId: string; url: string }> {
    const fileId = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    await sendWithFile(alice, chatId, fileId);
    const meta = await api()
      .get(`/api/v1/files/${fileId}`)
      .set(...auth(bob));
    return { fileId, url: meta.body.data.url as string };
  }

  it('serve the bytes with headers that keep a browser from rendering them', async () => {
    const { url } = await linkedFile();
    const response = await api().get(url);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="notes\.pdf"; filename\*=UTF-8''notes\.pdf$/,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-security-policy']).toBe('sandbox');
  });

  it('expire', async () => {
    const { fileId } = await linkedFile();
    const token = signDownloadToken({
      fileId,
      userId: bob.user.id,
      institutionId: ours.institutionId,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    });
    expect(await contentStatus(`/api/v1/files/${fileId}/content?token=${token}`)).toBe(404);
  });

  it('cannot be tampered with', async () => {
    const { url } = await linkedFile();
    const flipped = url.slice(0, -1) + (url.endsWith('A') ? 'B' : 'A');
    expect(await contentStatus(flipped)).toBe(404);
  });

  it('are bound to one file', async () => {
    const { url } = await linkedFile();
    const other = await uploadOk(alice);
    const token = new URL(url, 'http://x').searchParams.get('token');
    expect(await contentStatus(`/api/v1/files/${other}/content?token=${token}`)).toBe(404);
  });

  it('re-check the user they were minted for: a validly signed URL for someone without access is refused', async () => {
    const { fileId } = await linkedFile();
    const forCarol = signDownloadToken({
      fileId,
      userId: carol.user.id,
      institutionId: ours.institutionId,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    expect(await contentStatus(`/api/v1/files/${fileId}/content?token=${forCarol}`)).toBe(404);

    const crossTenant = signDownloadToken({
      fileId,
      userId: outsider.user.id,
      institutionId: theirs.institutionId,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    expect(await contentStatus(`/api/v1/files/${fileId}/content?token=${crossTenant}`)).toBe(404);
  });

  it('stop working when the account they were minted for is suspended', async () => {
    const { url } = await linkedFile();
    await UserModel.updateOne({ _id: bob.user.id }, { $set: { status: UserStatus.SUSPENDED } });
    expect(await contentStatus(url)).toBe(404);
  });

  it('refuse a missing or malformed token before doing any work', async () => {
    const { fileId } = await linkedFile();
    expect(await contentStatus(`/api/v1/files/${fileId}/content`)).toBe(422);
    expect(await contentStatus(`/api/v1/files/${fileId}/content?token=%24ne`)).toBe(422);
  });
});
