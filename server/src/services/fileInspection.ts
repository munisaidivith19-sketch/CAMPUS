/**
 * Content inspection for uploads: what a file REALLY is, independent of what the client said.
 *
 * Runs on the stored bytes, after the size limit has already held, and before anything is
 * recorded as usable. Every check fails closed — "could not tell" is a rejection, never a pass.
 *
 *  1. The extension and the declared MIME must both belong to one allowlisted type.
 *  2. The magic bytes, read by an established library (`file-type`), must identify that same
 *     type. Text types have no magic, so they must instead decode as UTF-8 with no NUL bytes.
 *  3. Polyglots are refused: markup (`<script`, `<html`, `<svg`, …) anywhere in an image, PDF or
 *     text file, and a ZIP end-of-central-directory record trailing a non-ZIP file.
 *  4. ZIPs and Office containers (DOCX/XLSX/PPTX) are inspected through their central directory
 *     only — nothing is ever extracted — against entry-count, total-size and compression-ratio
 *     limits, and refused if an entry path is absolute or climbs out with `..`, or if an entry is
 *     itself an archive.
 */
import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import yauzl from 'yauzl';
import { fileTypeFromFile } from 'file-type';

export interface FileTypeSpec {
  /** Canonical extension. */
  ext: string;
  /** The MIME the file is stored and served as. */
  mime: string;
  /** MIME values a browser may legitimately declare for it (Windows sends odd ones for CSV/ZIP). */
  declared: readonly string[];
  /** What `file-type` must report; null for text formats, which have no magic number. */
  magic: string | null;
  /** ZIP-based container: run the archive checks. */
  zip?: boolean;
}

const OOXML = 'application/vnd.openxmlformats-officedocument';

/** Every type the server knows how to verify. The configured allowlist picks from these. */
export const KNOWN_FILE_TYPES: Readonly<Record<string, FileTypeSpec>> = {
  pdf: { ext: 'pdf', mime: 'application/pdf', declared: ['application/pdf'], magic: 'pdf' },
  png: { ext: 'png', mime: 'image/png', declared: ['image/png'], magic: 'png' },
  jpg: {
    ext: 'jpg',
    mime: 'image/jpeg',
    declared: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
    magic: 'jpg',
  },
  webp: { ext: 'webp', mime: 'image/webp', declared: ['image/webp'], magic: 'webp' },
  gif: { ext: 'gif', mime: 'image/gif', declared: ['image/gif'], magic: 'gif' },
  docx: {
    ext: 'docx',
    mime: `${OOXML}.wordprocessingml.document`,
    declared: [`${OOXML}.wordprocessingml.document`],
    magic: 'docx',
    zip: true,
  },
  xlsx: {
    ext: 'xlsx',
    mime: `${OOXML}.spreadsheetml.sheet`,
    declared: [`${OOXML}.spreadsheetml.sheet`],
    magic: 'xlsx',
    zip: true,
  },
  pptx: {
    ext: 'pptx',
    mime: `${OOXML}.presentationml.presentation`,
    declared: [`${OOXML}.presentationml.presentation`],
    magic: 'pptx',
    zip: true,
  },
  txt: { ext: 'txt', mime: 'text/plain', declared: ['text/plain'], magic: null },
  csv: {
    ext: 'csv',
    mime: 'text/csv',
    declared: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
    magic: null,
  },
  zip: {
    ext: 'zip',
    mime: 'application/zip',
    declared: ['application/zip', 'application/x-zip-compressed', 'application/x-zip'],
    magic: 'zip',
    zip: true,
  },
};

/** `jpeg` is an alias for `jpg`; everything else maps to itself. */
const EXTENSION_ALIASES: Readonly<Record<string, string>> = { jpeg: 'jpg' };

/** The spec for a declared extension, if it is both known and allowlisted. */
export function resolveAllowedType(
  extension: string,
  allowlist: readonly string[],
): FileTypeSpec | null {
  const lower = extension.toLowerCase();
  if (!allowlist.includes(lower)) return null;
  const canonical = EXTENSION_ALIASES[lower] ?? lower;
  return KNOWN_FILE_TYPES[canonical] ?? null;
}

export interface ArchiveLimits {
  maxEntries: number;
  maxRatio: number;
  maxTotalBytes: number;
}

/** Why a file was refused. Coarse on purpose: the caller learns what, not how to tune around it. */
export type InspectionFailure =
  | 'MAGIC_MISMATCH'
  | 'NOT_TEXT'
  | 'EMBEDDED_MARKUP'
  | 'POLYGLOT'
  | 'ARCHIVE_TOO_MANY_ENTRIES'
  | 'ARCHIVE_TOO_LARGE'
  | 'ARCHIVE_RATIO'
  | 'ARCHIVE_NESTED'
  | 'ARCHIVE_UNSAFE_PATH'
  | 'ARCHIVE_INVALID'
  | 'EMPTY';

export type InspectionResult = { ok: true } | { ok: false; reason: InspectionFailure };

/**
 * Markup that turns a "harmless" file into something a browser might render or run. Matched
 * case-insensitively across the whole file.
 */
const MARKUP_MARKERS = [
  '<script',
  '<html',
  '<!doctype html',
  '<svg',
  '<iframe',
  '<body',
  '<?php',
  '<object',
  '<embed',
];
const MARKER_OVERLAP = Math.max(...MARKUP_MARKERS.map((marker) => marker.length));

/** Archive formats an archive may not contain. */
const NESTED_ARCHIVE_EXTENSIONS = new Set([
  'zip',
  'jar',
  'war',
  'ear',
  'apk',
  'rar',
  '7z',
  'gz',
  'tgz',
  'tar',
  'bz2',
  'xz',
  'cab',
  'iso',
  'lz',
  'lzma',
  'zst',
]);

/** Stream a file, calling `onChunk` with each chunk plus a short overlap from the previous one. */
async function scanChunks(
  filePath: string,
  onChunk: (window: Buffer) => boolean,
): Promise<boolean> {
  let tail = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    const buffer = chunk as Buffer;
    const window = Buffer.concat([tail, buffer]);
    if (onChunk(window)) return true;
    tail = window.subarray(Math.max(0, window.length - MARKER_OVERLAP));
  }
  return false;
}

async function containsMarkup(filePath: string): Promise<boolean> {
  return scanChunks(filePath, (window) => {
    const text = window.toString('latin1').toLowerCase();
    return MARKUP_MARKERS.some((marker) => text.includes(marker));
  });
}

/** Text formats: valid UTF-8 throughout, and no NUL bytes (a strong sign of binary content). */
async function isPlainText(filePath: string): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of createReadStream(filePath)) {
      const buffer = chunk as Buffer;
      if (buffer.includes(0)) return false;
      decoder.decode(buffer, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

/** A ZIP end-of-central-directory record near the end of a file that should not be a ZIP. */
async function hasTrailingZip(filePath: string, size: number): Promise<boolean> {
  // EOCD is 22 bytes plus an optional comment of up to 65 535 bytes.
  const span = Math.min(size, 22 + 65_535);
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(span);
    await handle.read(buffer, 0, span, size - span);
    return buffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  } finally {
    await handle.close();
  }
}

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      {
        lazyEntries: true,
        autoClose: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (err, zip) => (err || !zip ? reject(err ?? new Error('zip open failed')) : resolve(zip)),
    );
  });
}

function isUnsafeEntryPath(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[\\/]/).some((part) => part === '..');
}

/**
 * Walk the central directory and apply the archive limits. Only the directory is read; no entry
 * is ever decompressed, so a bomb costs us a directory's worth of bytes, not its payload.
 */
export async function inspectArchive(
  filePath: string,
  fileSize: number,
  limits: ArchiveLimits,
): Promise<InspectionResult> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(filePath);
  } catch {
    return { ok: false, reason: 'ARCHIVE_INVALID' };
  }

  if (zip.entryCount > limits.maxEntries) {
    zip.close();
    return { ok: false, reason: 'ARCHIVE_TOO_MANY_ENTRIES' };
  }

  return new Promise<InspectionResult>((resolve) => {
    let entries = 0;
    let totalUncompressed = 0;
    let settled = false;

    const finish = (result: InspectionResult): void => {
      if (settled) return;
      settled = true;
      zip.close();
      resolve(result);
    };

    zip.on('entry', (entry: yauzl.Entry) => {
      entries += 1;
      if (entries > limits.maxEntries)
        return finish({ ok: false, reason: 'ARCHIVE_TOO_MANY_ENTRIES' });
      if (isUnsafeEntryPath(entry.fileName))
        return finish({ ok: false, reason: 'ARCHIVE_UNSAFE_PATH' });

      const isDirectory = entry.fileName.endsWith('/');
      const extension = entry.fileName.split('.').pop()?.toLowerCase() ?? '';
      if (
        !isDirectory &&
        entry.fileName.includes('.') &&
        NESTED_ARCHIVE_EXTENSIONS.has(extension)
      ) {
        return finish({ ok: false, reason: 'ARCHIVE_NESTED' });
      }

      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > limits.maxTotalBytes)
        return finish({ ok: false, reason: 'ARCHIVE_TOO_LARGE' });

      if (entry.uncompressedSize > 0) {
        // Nothing compresses to zero bytes; a zero compressed size with content is a lie.
        if (entry.compressedSize === 0) return finish({ ok: false, reason: 'ARCHIVE_RATIO' });
        if (entry.uncompressedSize / entry.compressedSize > limits.maxRatio) {
          return finish({ ok: false, reason: 'ARCHIVE_RATIO' });
        }
      }

      zip.readEntry();
      return undefined;
    });

    zip.on('end', () => {
      if (fileSize > 0 && totalUncompressed / fileSize > limits.maxRatio) {
        return finish({ ok: false, reason: 'ARCHIVE_RATIO' });
      }
      return finish({ ok: true });
    });

    // yauzl reports absolute paths, `..` segments and malformed records as errors: all refusals.
    zip.on('error', () => finish({ ok: false, reason: 'ARCHIVE_INVALID' }));

    zip.readEntry();
  });
}

/** Run every content check for one stored file against its declared type. */
export async function inspectFile(
  filePath: string,
  size: number,
  spec: FileTypeSpec,
  limits: ArchiveLimits,
): Promise<InspectionResult> {
  if (size === 0) return { ok: false, reason: 'EMPTY' };

  const detected = await fileTypeFromFile(filePath).catch(() => undefined);

  if (spec.magic === null) {
    // Text: there must be NO recognisable binary signature, and the content must be text.
    if (detected) return { ok: false, reason: 'MAGIC_MISMATCH' };
    if (!(await isPlainText(filePath))) return { ok: false, reason: 'NOT_TEXT' };
    if (await containsMarkup(filePath)) return { ok: false, reason: 'EMBEDDED_MARKUP' };
    return { ok: true };
  }

  if (!detected || detected.ext !== spec.magic) return { ok: false, reason: 'MAGIC_MISMATCH' };

  if (spec.zip) {
    return inspectArchive(filePath, size, limits);
  }

  // Non-archive binary formats: no markup hidden inside, and no ZIP riding on the end.
  if (await containsMarkup(filePath)) return { ok: false, reason: 'EMBEDDED_MARKUP' };
  if (await hasTrailingZip(filePath, size)) return { ok: false, reason: 'POLYGLOT' };
  return { ok: true };
}
