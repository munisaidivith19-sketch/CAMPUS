/**
 * File sharing end to end: the upload pipeline, attachments on chat messages and
 * announcements, scanning, quota, rate limiting and orphan cleanup.
 *
 * Who-may-read-what (tenant isolation, IDOR, ex-members, signed-URL abuse, response headers) is
 * in tests/security/file-authorization.test.ts; this file is about the pipeline doing its job.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnnouncementScope, ChatType, FileScanStatus, Role } from '@campusconnect/types';
import {
  api,
  app,
  clearDatabase,
  connectTestDatabase,
  createAndLogin,
  createTenant,
  disconnectTestDatabase,
  login,
  type LoggedIn,
  type TestTenant,
} from '../helpers/testHarness.js';
import { createDepartment, createStudentInSection } from '../helpers/academicFixtures.js';
import {
  FAKE_MALWARE_MARKER,
  MIME,
  csvBytes,
  deadPort,
  docxBomb,
  docxBytes,
  exeBytes,
  htmlBytes,
  pdfBytes,
  pngBytes,
  pngWithScript,
  startFakeClamd,
  svgBytes,
  textBytes,
  uploadOk,
  uploadRequest,
  zipBomb,
  zipBytes,
} from '../helpers/fileFixtures.js';
import { FileModel } from '../../src/models/File.model.js';
import { AuditLogModel } from '../../src/models/AuditLog.model.js';
import {
  getStorage,
  setStorageProvider,
  type StorageProvider,
} from '../../src/infra/storage/index.js';
import { runOrphanCleanup, setScannerForTesting } from '../../src/services/file.service.js';
import { resetChatNotificationDebounce } from '../../src/services/chat.service.js';

let tenant: TestTenant;
let alice: LoggedIn;
let bob: LoggedIn;

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

beforeEach(async () => {
  await clearDatabase();
  resetChatNotificationDebounce();
  tenant = await createTenant();
  const departmentId = await createDepartment(tenant);
  alice = await login(
    await createStudentInSection(tenant, { localPart: 'alice', rollNo: 'F001', departmentId }),
  );
  bob = await login(
    await createStudentInSection(tenant, { localPart: 'bob', rollNo: 'F002', departmentId }),
  );
});

afterEach(() => {
  setScannerForTesting(null);
  setStorageProvider(null);
});

const auth = (session: LoggedIn): [string, string] => [
  'authorization',
  `Bearer ${session.accessToken}`,
];

let counter = 0;
const clientId = (): string => `file-msg-${(counter += 1)}-${Date.now()}`;

async function openDirect(from: LoggedIn, to: LoggedIn): Promise<string> {
  const response = await api()
    .post('/api/v1/chats')
    .set(...auth(from))
    .send({ type: ChatType.DIRECT, userId: to.user.id });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function download(
  session: LoggedIn,
  fileId: string,
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  const meta = await api()
    .get(`/api/v1/files/${fileId}`)
    .set(...auth(session));
  if (meta.status !== 200) return { status: meta.status, body: Buffer.alloc(0), headers: {} };
  const content = await api()
    .get(meta.body.data.url as string)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  return { status: content.status, body: content.body as Buffer, headers: content.headers };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('upload pipeline', () => {
  it('stores an allowed file and reports what the server verified', async () => {
    const bytes = pdfBytes();
    const response = await uploadRequest(alice, bytes, 'Lecture notes.pdf', MIME.pdf);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: 'Lecture notes.pdf',
      mime: 'application/pdf',
      size: bytes.length,
      checksum: sha256(bytes),
      scanStatus: FileScanStatus.SKIPPED,
      visibility: 'PRIVATE',
      linkedResource: null,
      downloadable: true,
      isOwner: true,
    });
    // No storage internals ever reach a client.
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|[a-f0-9]{24}\/[a-f0-9]{2}\//);
  });

  it('accepts every allowlisted type', async () => {
    const cases: Array<[Buffer, string, string]> = [
      [pngBytes(), 'a.png', MIME.png],
      [textBytes(), 'a.txt', MIME.txt],
      [csvBytes(), 'a.csv', 'application/vnd.ms-excel'],
      [zipBytes(), 'a.zip', 'application/x-zip-compressed'],
      [docxBytes(), 'a.docx', MIME.docx],
    ];
    for (const [bytes, name, type] of cases) {
      const response = await uploadRequest(alice, bytes, name, type);
      expect(response.status, name).toBe(201);
    }
  });

  it('refuses a declared type outside the allowlist, before storing anything', async () => {
    const response = await uploadRequest(alice, htmlBytes(), 'page.html', 'text/html');
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const mismatchedDeclaration = await uploadRequest(alice, pdfBytes(), 'notes.pdf', 'text/html');
    expect(mismatchedDeclaration.status).toBe(415);
    expect(await FileModel.countDocuments({})).toBe(0);
  });

  it('refuses files whose bytes are not what they claim, and keeps no bytes', async () => {
    const hostile: Array<[Buffer, string, string]> = [
      [pngBytes(), 'fake.pdf', MIME.pdf],
      [htmlBytes(), 'fake.png', MIME.png],
      [svgBytes(), 'logo.png', MIME.png],
      [exeBytes(), 'setup.png', MIME.png],
      [pngWithScript(), 'poly.png', MIME.png],
      [Buffer.concat([pdfBytes(), zipBytes()]), 'poly.pdf', MIME.pdf],
    ];
    for (const [bytes, name, type] of hostile) {
      const response = await uploadRequest(alice, bytes, name, type);
      expect(response.status, name).toBe(415);
      expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    expect(await FileModel.countDocuments({})).toBe(0);
  });

  it('refuses ZIP bombs, including one dressed as a DOCX, without extracting them', async () => {
    const zip = await uploadRequest(alice, zipBomb(8), 'archive.zip', MIME.zip);
    expect(zip.status).toBe(415);
    const docx = await uploadRequest(alice, docxBomb(), 'report.docx', MIME.docx);
    expect(docx.status).toBe(415);
    expect(await FileModel.countDocuments({})).toBe(0);
  });

  it('sanitizes the display name', async () => {
    const response = await uploadRequest(alice, pdfBytes(), '../../x/evil\u202efdp.pdf', MIME.pdf);
    // The bidi override is gone and the path is gone; what remains ends in the real extension.
    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe('evilfdp.pdf');
  });

  it('refuses an oversized upload by its declared length', async () => {
    const response = await uploadRequest(
      alice,
      Buffer.alloc(1024 * 1024 + 200 * 1024, 0x41),
      'big.txt',
      MIME.txt,
    );
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('refuses an oversized upload that hides its length, while streaming', async () => {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const boundary = 'ccboundary123';
      const status = await new Promise<{ code: number; body: string }>((resolve, reject) => {
        const request = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/api/v1/files',
            headers: {
              authorization: `Bearer ${alice.accessToken}`,
              'content-type': `multipart/form-data; boundary=${boundary}`,
              'transfer-encoding': 'chunked',
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => resolve({ code: res.statusCode ?? 0, body }));
          },
        );
        request.on('error', reject);
        request.write(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.txt"\r\nContent-Type: text/plain\r\n\r\n`,
        );
        const chunk = Buffer.alloc(64 * 1024, 0x42);
        for (let i = 0; i < 20; i += 1) request.write(chunk); // 1.25 MiB > the 1 MiB test limit
        request.end(`\r\n--${boundary}--\r\n`);
      });
      expect(status.code).toBe(413);
      expect(JSON.parse(status.body).error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await FileModel.countDocuments({})).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects requests that are not a single multipart file', async () => {
    const json = await api()
      .post('/api/v1/files')
      .set(...auth(alice))
      .send({ file: 'x' });
    expect(json.status).toBe(415);

    const empty = await api()
      .post('/api/v1/files')
      .set(...auth(alice))
      .field('note', 'no file here');
    expect(empty.status).toBe(422);
  });

  it('requires authentication', async () => {
    const response = await api()
      .post('/api/v1/files')
      .attach('file', pdfBytes(), { filename: 'a.pdf', contentType: MIME.pdf });
    expect(response.status).toBe(401);
  });

  it('enforces the per-user quota across live files', async () => {
    const big = Buffer.alloc(950 * 1024, 0x61); // text "aaaa…"
    await uploadOk(alice, big, 'one.txt', MIME.txt);
    await uploadOk(alice, big, 'two.txt', MIME.txt);
    await uploadOk(alice, big, 'three.txt', MIME.txt);

    const over = await uploadRequest(alice, Buffer.alloc(400 * 1024, 0x61), 'four.txt', MIME.txt);
    expect(over.status).toBe(413);
    expect(over.body.error.code).toBe('QUOTA_EXCEEDED');

    // Another user's allowance is untouched.
    expect((await uploadRequest(bob, big, 'bob.txt', MIME.txt)).status).toBe(201);
  });

  it('rate-limits uploads per user', async () => {
    for (let i = 0; i < 25; i += 1) {
      const response = await uploadRequest(alice, textBytes(`n${i}`), `n${i}.txt`, MIME.txt);
      expect(response.status).toBe(201);
    }
    const limited = await uploadRequest(alice, textBytes('one more'), 'x.txt', MIME.txt);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    // Counted per user, not per network: Bob behind the same address is unaffected.
    expect((await uploadRequest(bob, textBytes('bob'), 'b.txt', MIME.txt)).status).toBe(201);
  });
});

describe('malware scanning', () => {
  it('marks clean files CLEAN when a scanner is running', async () => {
    const clamd = await startFakeClamd();
    try {
      setScannerForTesting({
        enabled: true,
        host: '127.0.0.1',
        port: clamd.port,
        timeoutMs: 5_000,
      });
      const response = await uploadRequest(alice, pdfBytes(), 'clean.pdf', MIME.pdf);
      expect(response.status).toBe(201);
      expect(response.body.data.scanStatus).toBe(FileScanStatus.CLEAN);
      expect(clamd.scans).toBe(1);
    } finally {
      await clamd.close();
    }
  });

  it('refuses infected files, destroys their bytes, keeps the row as INFECTED and audits it', async () => {
    const clamd = await startFakeClamd();
    try {
      setScannerForTesting({
        enabled: true,
        host: '127.0.0.1',
        port: clamd.port,
        timeoutMs: 5_000,
      });
      const response = await uploadRequest(
        alice,
        textBytes(`notes\n${FAKE_MALWARE_MARKER}\n`),
        'notes.txt',
        MIME.txt,
      );
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('MALWARE_DETECTED');

      const row = await FileModel.findOne({}).lean();
      expect(row?.scanStatus).toBe(FileScanStatus.INFECTED);
      expect(row?.deletedAt).toBeTruthy();
      expect(await getStorage().exists(row?.storageKey ?? '')).toBe(false);

      const audit = await AuditLogModel.findOne({ action: 'FILE_MALWARE_DETECTED' }).lean();
      expect(audit?.resourceId).toBe(String(row?._id));
      expect(JSON.stringify(audit)).not.toContain(FAKE_MALWARE_MARKER);
    } finally {
      await clamd.close();
    }
  });

  it('holds a file as SCAN_FAILED when the scanner is unreachable — never downloadable or shareable', async () => {
    setScannerForTesting({
      enabled: true,
      host: '127.0.0.1',
      port: await deadPort(),
      timeoutMs: 2_000,
    });
    const response = await uploadRequest(alice, pdfBytes(), 'held.pdf', MIME.pdf);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SCAN_FAILED');

    const row = await FileModel.findOne({}).lean();
    expect(row?.scanStatus).toBe(FileScanStatus.SCAN_FAILED);
    const fileId = String(row?._id);

    const meta = await api()
      .get(`/api/v1/files/${fileId}`)
      .set(...auth(alice));
    expect(meta.status).toBe(409);

    const chatId = await openDirect(alice, bob);
    const attach = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'see file', clientMessageId: clientId(), attachmentFileIds: [fileId] });
    expect(attach.status).toBe(404);
  });
});

describe('chat attachments', () => {
  it('delivers a file in a DM: the recipient downloads the same bytes', async () => {
    const bytes = pdfBytes('shared in a DM');
    const fileId = await uploadOk(alice, bytes);
    const chatId = await openDirect(alice, bob);

    const sent = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: '', clientMessageId: clientId(), attachmentFileIds: [fileId] });
    expect(sent.status).toBe(201);
    expect(sent.body.data.attachments).toEqual([
      {
        id: fileId,
        name: 'notes.pdf',
        mime: 'application/pdf',
        size: bytes.length,
        scanStatus: 'SKIPPED',
      },
    ]);

    const history = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(bob));
    expect(history.body.data.items[0].attachments[0].id).toBe(fileId);

    const got = await download(bob, fileId);
    expect(got.status).toBe(200);
    expect(sha256(got.body)).toBe(sha256(bytes));
  });

  it('keeps attachment order and caps the count at five', async () => {
    const ids = [];
    for (let i = 0; i < 6; i += 1)
      ids.push(await uploadOk(alice, textBytes(`file ${i}`), `f${i}.txt`, MIME.txt));
    const chatId = await openDirect(alice, bob);

    const tooMany = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'x', clientMessageId: clientId(), attachmentFileIds: ids });
    expect(tooMany.status).toBe(422);

    const order = [ids[3], ids[0], ids[4]] as string[];
    const sent = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'three', clientMessageId: clientId(), attachmentFileIds: order });
    expect(sent.body.data.attachments.map((a: { id: string }) => a.id)).toEqual(order);
  });

  it('refuses to attach a file that is not the sender’s own, and leaves the message unsent', async () => {
    const bobsFile = await uploadOk(bob);
    const chatId = await openDirect(alice, bob);
    const response = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'stolen', clientMessageId: clientId(), attachmentFileIds: [bobsFile] });
    expect(response.status).toBe(404);
    const history = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice));
    expect(history.body.data.items).toHaveLength(0);
  });

  it('refuses to attach one file twice, and a retry of the same send returns the original', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    const id = clientId();

    const first = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'a', clientMessageId: id, attachmentFileIds: [fileId] });
    expect(first.status).toBe(201);
    const retry = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'a', clientMessageId: id, attachmentFileIds: [fileId] });
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);

    const reuse = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'b', clientMessageId: clientId(), attachmentFileIds: [fileId] });
    expect(reuse.status).toBe(404);
  });

  it('still requires a body or an attachment', async () => {
    const chatId = await openDirect(alice, bob);
    const response = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: '   ', clientMessageId: clientId() });
    expect(response.status).toBe(422);
  });

  it('deletes the files — bytes and all — when their message is deleted', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    const sent = await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'oops', clientMessageId: clientId(), attachmentFileIds: [fileId] });
    const storageKey = (await FileModel.findById(fileId).lean())?.storageKey ?? '';
    expect(await getStorage().exists(storageKey)).toBe(true);

    const removed = await api()
      .delete(`/api/v1/chats/${chatId}/messages/${sent.body.data.id}`)
      .set(...auth(alice));
    expect(removed.status).toBe(200);

    expect(await getStorage().exists(storageKey)).toBe(false);
    expect((await FileModel.findById(fileId).lean())?.deletedAt).toBeTruthy();
    expect(
      (
        await api()
          .get(`/api/v1/files/${fileId}`)
          .set(...auth(bob))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .get(`/api/v1/files/${fileId}`)
          .set(...auth(alice))
      ).status,
    ).toBe(404);
    const history = await api()
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(bob));
    expect(history.body.data.items[0].attachments).toEqual([]);
  });
});

describe('announcement attachments', () => {
  it('lets everyone addressed download the attachment, in order', async () => {
    const principal = await createAndLogin(tenant, { roles: [Role.PRINCIPAL] });
    const a = await uploadOk(principal, pdfBytes('circular'), 'circular.pdf');
    const b = await uploadOk(principal, pngBytes(), 'map.png', MIME.png);

    const created = await api()
      .post('/api/v1/announcements')
      .set(...auth(principal))
      .send({
        title: 'Exam circular',
        body: 'See attached.',
        target: { scope: AnnouncementScope.COLLEGE },
        attachmentFileIds: [b, a],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.attachments.map((x: { id: string }) => x.id)).toEqual([b, a]);

    const listed = await api()
      .get('/api/v1/announcements')
      .set(...auth(alice));
    expect(listed.body.data[0].attachments).toHaveLength(2);
    expect((await download(alice, a)).status).toBe(200);
  });

  it('caps announcement attachments at ten', async () => {
    const principal = await createAndLogin(tenant, { roles: [Role.PRINCIPAL] });
    const ids = Array.from(
      { length: 11 },
      (_, i) => `${'0'.repeat(22)}${String(i).padStart(2, '0')}`,
    );
    const response = await api()
      .post('/api/v1/announcements')
      .set(...auth(principal))
      .send({
        title: 'Too many',
        body: 'x',
        target: { scope: AnnouncementScope.COLLEGE },
        attachmentFileIds: ids,
      });
    expect(response.status).toBe(422);
  });
});

describe('deleting your own files', () => {
  it('deletes an unattached file and its bytes', async () => {
    const fileId = await uploadOk(alice);
    const storageKey = (await FileModel.findById(fileId).lean())?.storageKey ?? '';
    const response = await api()
      .delete(`/api/v1/files/${fileId}`)
      .set(...auth(alice));
    expect(response.status).toBe(200);
    expect(await getStorage().exists(storageKey)).toBe(false);
    expect(
      (
        await api()
          .get(`/api/v1/files/${fileId}/meta`)
          .set(...auth(alice))
      ).status,
    ).toBe(404);
  });

  it('will not delete a file that is attached to something', async () => {
    const fileId = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'x', clientMessageId: clientId(), attachmentFileIds: [fileId] });
    const response = await api()
      .delete(`/api/v1/files/${fileId}`)
      .set(...auth(alice));
    expect(response.status).toBe(409);
  });

  it('will not delete someone else’s file, and says only NOT_FOUND', async () => {
    const fileId = await uploadOk(alice);
    const response = await api()
      .delete(`/api/v1/files/${fileId}`)
      .set(...auth(bob));
    expect(response.status).toBe(404);
  });
});

describe('orphan cleanup', () => {
  async function age(fileIds: string[], hours: number): Promise<void> {
    const { Types } = await import('mongoose');
    // Through the driver: createdAt is immutable at the Mongoose layer, which is right for the app.
    await FileModel.collection.updateMany(
      { _id: { $in: fileIds.map((id) => new Types.ObjectId(id)) } },
      { $set: { createdAt: new Date(Date.now() - hours * 3_600_000) } },
    );
  }

  it('removes only unattached files past the TTL, exactly once even with two workers racing', async () => {
    const orphans = [await uploadOk(alice), await uploadOk(alice), await uploadOk(bob)];
    const fresh = await uploadOk(alice);
    const attached = await uploadOk(alice);
    const chatId = await openDirect(alice, bob);
    await api()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(...auth(alice))
      .send({ body: 'x', clientMessageId: clientId(), attachmentFileIds: [attached] });
    await age([...orphans, attached], 48);

    const real = getStorage();
    const deletes: string[] = [];
    const counting: StorageProvider = {
      put: (stream, options) => real.put(stream, options),
      getStream: (key) => real.getStream(key),
      exists: (key) => real.exists(key),
      localPath: (key) => real.localPath(key),
      delete: async (key) => {
        deletes.push(key);
        await real.delete(key);
      },
    };
    setStorageProvider(counting);

    const [first, second] = await Promise.all([runOrphanCleanup(), runOrphanCleanup()]);
    expect(first + second).toBe(3);
    expect(deletes).toHaveLength(3);
    expect(new Set(deletes).size).toBe(3);

    for (const id of orphans)
      expect((await FileModel.findById(id).lean())?.deletedReason).toBe('ORPHAN');
    expect((await FileModel.findById(fresh).lean())?.deletedAt).toBeNull();
    expect((await FileModel.findById(attached).lean())?.deletedAt).toBeNull();
  });
});
