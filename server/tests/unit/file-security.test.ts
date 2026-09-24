/**
 * File sharing, the pure parts: name sanitization, the access policy, download-token signing,
 * content inspection and storage-path containment. Everything here runs without a database.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileScanStatus, FileVisibility, Permission, Role } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import { attachmentDisposition, sanitizeFileName } from '../../src/utils/fileName.js';
import { fileAccess, type FileFacts } from '../../src/policies/fileAccess.js';
import { signDownloadToken, verifyDownloadToken } from '../../src/utils/fileSigning.js';
import {
  inspectFile,
  KNOWN_FILE_TYPES,
  resolveAllowedType,
} from '../../src/services/fileInspection.js';
import { LocalDiskStorage } from '../../src/infra/storage/LocalDiskStorage.js';
import { StorageSizeExceededError } from '../../src/infra/storage/StorageProvider.js';
import { parseReply } from '../../src/infra/clamav.js';
import {
  csvBytes,
  docxBomb,
  docxBytes,
  exeBytes,
  gifBytes,
  htmlBytes,
  jpegBytes,
  makeZip,
  pdfBytes,
  pngBytes,
  pngWithScript,
  svgBytes,
  textBytes,
  zipBomb,
  zipBytes,
} from '../helpers/fileFixtures.js';

const TENANT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OWNER = '111111111111111111111111';
const STRANGER = '222222222222222222222222';

function principal(
  userId: string,
  institutionId = TENANT,
  permissions: Permission[] = [Permission.FILE_READ, Permission.FILE_UPLOAD],
): Principal {
  return { userId, institutionId, roles: [Role.STUDENT], permissions };
}

function facts(overrides: Partial<FileFacts> = {}): FileFacts {
  return {
    institutionId: TENANT,
    ownerUserId: OWNER,
    visibility: FileVisibility.PRIVATE,
    scanStatus: FileScanStatus.CLEAN,
    deleted: false,
    ...overrides,
  };
}

describe('file name sanitization', () => {
  it('drops path parts, both separators', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf').name).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\Users\\x\\report.pdf').name).toBe('report.pdf');
  });

  it('removes bidi overrides so a name cannot disguise its extension', () => {
    const result = sanitizeFileName('invoice\u202Efdp.exe');
    expect(result.name).toBe('invoicefdp.exe');
    expect(result.extension).toBe('exe');
  });

  it('removes control and zero-width characters and leading dots', () => {
    expect(sanitizeFileName('.\u0000hid\u200Bden\u0007.txt').name).toBe('hidden.txt');
    expect(sanitizeFileName('...htaccess').name).toBe('htaccess');
  });

  it('caps the length but keeps the extension', () => {
    const result = sanitizeFileName(`${'a'.repeat(400)}.pdf`);
    expect(result.name.length).toBeLessThanOrEqual(180);
    expect(result.name.endsWith('.pdf')).toBe(true);
  });

  it('never returns an empty name', () => {
    expect(sanitizeFileName('').name).toBe('file');
    expect(sanitizeFileName('\u202E').name).toBe('file');
  });

  it('builds a Content-Disposition that is always an attachment and header-safe', () => {
    const value = attachmentDisposition('résumé "final".pdf');
    expect(value.startsWith('attachment;')).toBe(true);
    expect(value).not.toMatch(/[\r\n]/);
    expect(value).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9");
  });
});

describe('file access policy', () => {
  const owner = principal(OWNER);
  const stranger = principal(STRANGER);

  it('lets the owner see their private file and nobody else', () => {
    expect(fileAccess.canView(owner, facts(), false)).toBe(true);
    expect(fileAccess.canView(stranger, facts(), true)).toBe(false);
  });

  it('lets others see a linked file exactly when they can read the linked resource', () => {
    const linked = facts({ visibility: FileVisibility.LINKED });
    expect(fileAccess.canView(stranger, linked, true)).toBe(true);
    expect(fileAccess.canView(stranger, linked, false)).toBe(false);
  });

  it('never crosses tenants, even for the owner id', () => {
    expect(fileAccess.canView(principal(OWNER, OTHER_TENANT), facts(), true)).toBe(false);
  });

  it('hides deleted files from everyone, owner included', () => {
    expect(fileAccess.canView(owner, facts({ deleted: true }), true)).toBe(false);
  });

  it('requires file:read to see anything', () => {
    expect(fileAccess.canView(principal(OWNER, TENANT, []), facts(), true)).toBe(false);
  });

  it('only lets clean bytes out, and unscanned only where allowed', () => {
    expect(fileAccess.isDownloadableStatus(FileScanStatus.CLEAN, false)).toBe(true);
    expect(fileAccess.isDownloadableStatus(FileScanStatus.SKIPPED, true)).toBe(true);
    expect(fileAccess.isDownloadableStatus(FileScanStatus.SKIPPED, false)).toBe(false);
    for (const status of [
      FileScanStatus.SCAN_FAILED,
      FileScanStatus.INFECTED,
      FileScanStatus.PENDING,
    ]) {
      expect(fileAccess.isDownloadableStatus(status, true)).toBe(false);
    }
  });

  it('links only your own, private, shareable file', () => {
    expect(fileAccess.canLink(owner, facts(), false)).toBe(true);
    expect(fileAccess.canLink(stranger, facts(), false)).toBe(false);
    expect(fileAccess.canLink(owner, facts({ visibility: FileVisibility.LINKED }), false)).toBe(
      false,
    );
    expect(fileAccess.canLink(owner, facts({ scanStatus: FileScanStatus.SCAN_FAILED }), true)).toBe(
      false,
    );
    expect(fileAccess.canLink(owner, facts({ deleted: true }), true)).toBe(false);
  });

  it('deletes directly only your own unattached files', () => {
    expect(fileAccess.canDeleteDirectly(owner, facts())).toBe(true);
    expect(fileAccess.canDeleteDirectly(owner, facts({ visibility: FileVisibility.LINKED }))).toBe(
      false,
    );
    expect(fileAccess.canDeleteDirectly(stranger, facts())).toBe(false);
  });
});

describe('signed download tokens', () => {
  const claims = {
    fileId: 'f'.repeat(24),
    userId: OWNER,
    institutionId: TENANT,
    expiresAt: 2_000_000_000,
  };

  it('round-trips an authentic token', () => {
    expect(verifyDownloadToken(signDownloadToken(claims), 1_900_000_000)).toEqual(claims);
  });

  it('refuses an expired token', () => {
    expect(verifyDownloadToken(signDownloadToken(claims), 2_000_000_001)).toBeNull();
  });

  it('refuses a tampered payload (a different user) under the original signature', () => {
    const [, signature] = signDownloadToken(claims).split('.');
    const forged = Buffer.from(
      JSON.stringify({ f: claims.fileId, u: STRANGER, i: TENANT, e: claims.expiresAt }),
    ).toString('base64url');
    expect(verifyDownloadToken(`${forged}.${signature}`, 1_900_000_000)).toBeNull();
  });

  it('refuses a tampered signature and malformed tokens', () => {
    const token = signDownloadToken(claims);
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyDownloadToken(flipped, 1_900_000_000)).toBeNull();
    expect(verifyDownloadToken('not-a-token', 1_900_000_000)).toBeNull();
    expect(verifyDownloadToken(`${token}.extra`, 1_900_000_000)).toBeNull();
  });
});

describe('the clamd reply parser', () => {
  it('reads clean, infected and error replies — and treats anything unclear as unavailable', () => {
    expect(parseReply('stream: OK\0')).toEqual({ status: 'CLEAN' });
    expect(parseReply('stream: Eicar-Signature FOUND\0')).toEqual({
      status: 'INFECTED',
      signature: 'Eicar-Signature',
    });
    expect(() => parseReply('INSTREAM size limit exceeded. ERROR')).toThrow();
    expect(() => parseReply('')).toThrow();
  });
});

describe('content inspection', () => {
  let dir: string;
  const limits = { maxEntries: 50, maxRatio: 100, maxTotalBytes: 5 * 1024 * 1024 };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cc-inspect-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  let counter = 0;
  async function inspect(bytes: Buffer, ext: string): Promise<string> {
    const spec = KNOWN_FILE_TYPES[ext];
    if (!spec) throw new Error(`no spec for ${ext}`);
    counter += 1;
    const filePath = path.join(dir, `f${counter}`);
    await writeFile(filePath, bytes);
    const result = await inspectFile(filePath, bytes.length, spec, limits);
    return result.ok ? 'OK' : result.reason;
  }

  it('accepts genuine files of every allowed type', async () => {
    expect(await inspect(pdfBytes(), 'pdf')).toBe('OK');
    expect(await inspect(pngBytes(), 'png')).toBe('OK');
    expect(await inspect(jpegBytes(), 'jpg')).toBe('OK');
    expect(await inspect(gifBytes(), 'gif')).toBe('OK');
    expect(await inspect(textBytes(), 'txt')).toBe('OK');
    expect(await inspect(csvBytes(), 'csv')).toBe('OK');
    expect(await inspect(zipBytes(), 'zip')).toBe('OK');
    expect(await inspect(docxBytes(), 'docx')).toBe('OK');
  });

  it('refuses bytes that are not what the name claims', async () => {
    expect(await inspect(pngBytes(), 'pdf')).toBe('MAGIC_MISMATCH');
    expect(await inspect(htmlBytes(), 'png')).toBe('MAGIC_MISMATCH');
    expect(await inspect(svgBytes(), 'png')).toBe('MAGIC_MISMATCH');
    expect(await inspect(exeBytes(), 'png')).toBe('MAGIC_MISMATCH');
    expect(await inspect(zipBytes(), 'docx')).toBe('MAGIC_MISMATCH');
    expect(await inspect(pdfBytes(), 'txt')).toBe('MAGIC_MISMATCH');
  });

  it('refuses markup in text and binary files, and text that is not text', async () => {
    expect(await inspect(htmlBytes(), 'txt')).toBe('EMBEDDED_MARKUP');
    expect(await inspect(Buffer.from('a,b\n<svg onload=x>\n'), 'csv')).toBe('EMBEDDED_MARKUP');
    expect(await inspect(Buffer.from([0x61, 0x00, 0x62]), 'txt')).toBe('NOT_TEXT');
    expect(await inspect(Buffer.from([0xc3, 0x28]), 'txt')).toBe('NOT_TEXT');
    expect(await inspect(pngWithScript(), 'png')).toBe('EMBEDDED_MARKUP');
  });

  it('refuses a polyglot: a PDF with a ZIP riding on its end', async () => {
    expect(await inspect(Buffer.concat([pdfBytes(), zipBytes()]), 'pdf')).toBe('POLYGLOT');
  });

  it('refuses ZIP bombs by ratio and by total size without extracting them', async () => {
    expect(await inspect(zipBomb(2), 'zip')).toBe('ARCHIVE_RATIO');
    // The directory claims 10 MiB; nothing is inflated to find out it lies.
    const lying = makeZip([
      { name: 'big.bin', data: Buffer.from('x'), deflate: true, claimedSize: 10 * 1024 * 1024 },
    ]);
    expect(await inspect(lying, 'zip')).toBe('ARCHIVE_TOO_LARGE');
  });

  it('refuses a DOCX that is really a bomb', async () => {
    // 8 MiB of zeros in a few KiB: refused on ratio or on total size, whichever trips first.
    expect(await inspect(docxBomb(), 'docx')).toMatch(/^ARCHIVE_(RATIO|TOO_LARGE)$/);
  });

  it('refuses too many entries, nested archives and escaping paths', async () => {
    const many = makeZip(
      Array.from({ length: 60 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') })),
    );
    expect(await inspect(many, 'zip')).toBe('ARCHIVE_TOO_MANY_ENTRIES');
    expect(await inspect(makeZip([{ name: 'inner.zip', data: zipBytes() }]), 'zip')).toBe(
      'ARCHIVE_NESTED',
    );
    expect(
      await inspect(makeZip([{ name: '../evil.txt', data: Buffer.from('x') }]), 'zip'),
    ).toMatch(/ARCHIVE_UNSAFE_PATH|ARCHIVE_INVALID/);
    expect(
      await inspect(makeZip([{ name: '/etc/evil.txt', data: Buffer.from('x') }]), 'zip'),
    ).toMatch(/ARCHIVE_UNSAFE_PATH|ARCHIVE_INVALID/);
  });

  it('refuses empty files', async () => {
    expect(await inspect(Buffer.alloc(0), 'txt')).toBe('EMPTY');
  });

  it('resolves only allowlisted extensions', () => {
    expect(resolveAllowedType('PDF', ['pdf'])?.mime).toBe('application/pdf');
    expect(resolveAllowedType('jpeg', ['jpeg'])?.ext).toBe('jpg');
    expect(resolveAllowedType('svg', ['svg'])).toBeNull();
    expect(resolveAllowedType('pdf', ['png'])).toBeNull();
  });
});

describe('local disk storage', () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cc-storage-'));
    storage = new LocalDiskStorage(root);
    await storage.init();
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores bytes under a random tenant-prefixed key and hashes them while streaming', async () => {
    const stored = await storage.put(Readable.from([Buffer.from('hello'), Buffer.from(' world')]), {
      institutionId: TENANT,
      maxBytes: 1024,
    });
    expect(stored.storageKey).toMatch(new RegExp(`^${TENANT}/[a-f0-9]{2}/[a-f0-9]{64}$`));
    expect(stored.size).toBe(11);
    expect(stored.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(await storage.exists(stored.storageKey)).toBe(true);
  });

  it('aborts at the size limit while streaming and leaves nothing behind', async () => {
    const before = await readdir(path.join(root, '.tmp'));
    await expect(
      storage.put(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), {
        institutionId: TENANT,
        maxBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(StorageSizeExceededError);
    expect(await readdir(path.join(root, '.tmp'))).toEqual(before);
  });

  it('cleans its temp file when the source stream fails mid-way', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.alloc(100));
        this.destroy(new Error('client went away'));
      },
    });
    await expect(
      storage.put(failing, { institutionId: TENANT, maxBytes: 10_000 }),
    ).rejects.toThrow();
    expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
  });

  it('refuses any key that could escape the root', () => {
    expect(() => storage.localPath('../../etc/passwd')).toThrow();
    expect(() => storage.localPath(`${TENANT}/../../x`)).toThrow();
    expect(() => storage.getStream('/abs/path')).toThrow();
  });

  it('refuses a non-tenant prefix', async () => {
    await expect(
      storage.put(Readable.from([Buffer.from('x')]), { institutionId: '../x', maxBytes: 10 }),
    ).rejects.toThrow();
  });
});
