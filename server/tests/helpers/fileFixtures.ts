/**
 * Fixtures for the file-sharing suites: tiny but genuine files of each allowed type, the hostile
 * files the pipeline must refuse, a minimal ZIP writer, and a fake clamd.
 *
 * Nothing here is real malware. The fake scanner flags a harmless marker string instead of the
 * EICAR test signature, because EICAR bytes written to disk on a developer's machine get
 * quarantined by the local antivirus mid-test. The live ClamAV suite (gated on TEST_CLAMAV_HOST)
 * builds EICAR in memory at run time instead.
 */
import net from 'node:net';
import { deflateRawSync } from 'node:zlib';
import supertest from 'supertest';
import { app, type LoggedIn } from './testHarness.js';

// --- Genuine files -------------------------------------------------------------

export function pdfBytes(text = 'CampusConnect test document'): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${text}\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
    'latin1',
  );
}

export function pngBytes(): Buffer {
  // Signature + IHDR (1x1, 8-bit RGBA) + IEND. Enough for any sniffer to call it a PNG.
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e000504027fd6a3a40000000049454e44ae426082',
    'hex',
  );
}

export function jpegBytes(): Buffer {
  return Buffer.concat([
    Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
    Buffer.alloc(64, 0x11),
    Buffer.from('ffd9', 'hex'),
  ]);
}

export function gifBytes(): Buffer {
  return Buffer.from('474946383961010001000000002c00000000010001000002024401003b', 'hex');
}

export const textBytes = (text = 'Plain notes for the test.\nSecond line.\n'): Buffer =>
  Buffer.from(text, 'utf8');
export const csvBytes = (): Buffer => Buffer.from('roll,name\nA001,Asha\nA002,Bala\n', 'utf8');

// --- Hostile files -------------------------------------------------------------

export const htmlBytes = (): Buffer =>
  Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>');
export const svgBytes = (): Buffer =>
  Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
/** A DOS/PE header is enough for a sniffer to call it an executable. */
export const exeBytes = (): Buffer => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);

/** A real PNG with script markup riding inside it. */
export const pngWithScript = (): Buffer =>
  Buffer.concat([pngBytes(), Buffer.from('<script>alert(document.cookie)</script>')]);

/** The marker the fake clamd treats as malware. */
export const FAKE_MALWARE_MARKER = 'CC-TEST-MALWARE-SIGNATURE-7f3a';

// --- ZIP -----------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
  deflate?: boolean;
  /** Lie about the uncompressed size in the directory (for bomb-shaped fixtures). */
  claimedSize?: number;
}

/** A minimal, spec-shaped ZIP writer (no zip64, no encryption). */
export function makeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const payload = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const method = entry.deflate ? 8 : 0;
    const crc = crc32(entry.data);
    const uncompressed = entry.claimedSize ?? entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

export const zipBytes = (): Buffer =>
  makeZip([
    { name: 'notes.txt', data: Buffer.from('hello from inside a zip') },
    { name: 'data/rows.csv', data: Buffer.from('a,b\n1,2\n'), deflate: true },
  ]);

/** Highly compressible payload: megabytes of zeros deflate to a few kilobytes. */
export const zipBomb = (megabytes = 8): Buffer =>
  makeZip([{ name: 'zeros.bin', data: Buffer.alloc(megabytes * 1024 * 1024), deflate: true }]);

const CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

export function docxBytes(extra: readonly ZipEntry[] = []): Buffer {
  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_DOCX) },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>',
      ),
      deflate: true,
    },
    ...extra,
  ]);
}

/** A DOCX that is really a bomb: a legitimate-looking container hiding a huge-ratio entry. */
export const docxBomb = (): Buffer =>
  docxBytes([
    { name: 'word/media/filler.bin', data: Buffer.alloc(8 * 1024 * 1024), deflate: true },
  ]);

// --- Uploading -----------------------------------------------------------------

export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export function uploadRequest(
  session: LoggedIn,
  bytes: Buffer,
  fileName: string,
  contentType: string,
): supertest.Test {
  return supertest(app)
    .post('/api/v1/files')
    .set('authorization', `Bearer ${session.accessToken}`)
    .attach('file', bytes, { filename: fileName, contentType });
}

/** Upload and return the file id, asserting success. */
export async function uploadOk(
  session: LoggedIn,
  bytes: Buffer = pdfBytes(),
  fileName = 'notes.pdf',
  contentType: string = MIME.pdf,
): Promise<string> {
  const response = await uploadRequest(session, bytes, fileName, contentType);
  if (response.status !== 201) {
    throw new Error(`upload failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data.id as string;
}

// --- Fake clamd ----------------------------------------------------------------

export interface FakeClamd {
  port: number;
  scans: number;
  close: () => Promise<void>;
}

/**
 * Speaks enough INSTREAM to answer: reads the length-prefixed chunks until the zero-length
 * terminator, then replies OK — or FOUND if the stream contained the marker.
 */
export async function startFakeClamd(): Promise<FakeClamd> {
  const state = { scans: 0 };
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let payload = Buffer.alloc(0);
    let commandRead = false;

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!commandRead) {
        const nul = buffer.indexOf(0);
        if (nul === -1) return;
        buffer = buffer.subarray(nul + 1);
        commandRead = true;
      }
      for (;;) {
        if (buffer.length < 4) return;
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          state.scans += 1;
          const infected = payload.includes(Buffer.from(FAKE_MALWARE_MARKER));
          socket.end(infected ? 'stream: CC-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buffer.length < 4 + length) return;
        payload = Buffer.concat([payload, buffer.subarray(4, 4 + length)]);
        buffer = buffer.subarray(4 + length);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    get scans() {
      return state.scans;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A port nothing listens on, for "scanner unreachable". */
export async function deadPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
