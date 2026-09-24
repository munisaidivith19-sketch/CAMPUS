/**
 * Multipart intake for `POST /files`.
 *
 * Exactly one file part named `file` is accepted, and it is handed on as a STREAM — never
 * buffered — to the upload pipeline in file.service. Size is enforced in two places:
 *
 *  - here, from `Content-Length`, so an obviously oversized request is refused before a byte is
 *    read into storage;
 *  - by busboy's `fileSize` limit and by the storage writer while streaming, so a request that
 *    lies about (or omits) its length is still cut off at the limit.
 *
 * Whatever happens, the rest of the request body is drained before the response is sent, so a
 * client that is mid-upload gets a clean error instead of a reset connection.
 */
import type { Request } from 'express';
import busboy from 'busboy';
import type { Readable } from 'node:stream';
import { config } from '../config/env.js';
import { Errors } from '../utils/errors.js';

/** Room for multipart boundaries and headers on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export interface ReceivedFile {
  stream: Readable;
  fileName: string;
  declaredMime: string;
}

function drain(req: Request): void {
  req.unpipe();
  req.resume();
}

/**
 * Parse the request and call `handle` with the single file part. Resolves with whatever
 * `handle` resolves with; rejects with a stable AppError for every malformed request.
 */
export function receiveSingleFile<T>(
  req: Request,
  handle: (file: ReceivedFile) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const contentType = req.header('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      drain(req);
      reject(Errors.unsupportedMediaType('Upload a file as multipart/form-data.'));
      return;
    }

    const declaredLength = Number(req.header('content-length') ?? NaN);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > config.MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      drain(req);
      reject(Errors.payloadTooLarge());
      return;
    }

    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        // Filenames are UTF-8 in every current browser; busboy's default (latin1) mangles them.
        defParamCharset: 'utf8',
        limits: {
          files: 1,
          // One byte over the limit: busboy truncates silently at its limit, so letting one extra
          // byte through is what makes the storage writer see — and refuse — the overflow.
          fileSize: config.MAX_UPLOAD_BYTES + 1,
          fields: 5,
          fieldSize: 1024,
          parts: 6,
          headerPairs: 50,
        },
      });
    } catch {
      drain(req);
      reject(Errors.validation([{ path: 'file', message: 'Malformed multipart request' }]));
      return;
    }

    let seenFile = false;
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'file' || seenFile) {
        stream.resume();
        return;
      }
      seenFile = true;
      handle({ stream, fileName: info.filename ?? '', declaredMime: info.mimeType ?? '' }).then(
        (value) => settle(() => resolve(value)),
        (err: unknown) => {
          drain(req);
          settle(() => reject(err));
        },
      );
    });

    parser.on('filesLimit', () => {
      drain(req);
      settle(() =>
        reject(Errors.validation([{ path: 'file', message: 'Send one file per request' }])),
      );
    });

    parser.on('error', () => {
      drain(req);
      settle(() =>
        reject(Errors.validation([{ path: 'file', message: 'Malformed multipart request' }])),
      );
    });

    parser.on('close', () => {
      if (!seenFile) {
        settle(() => reject(Errors.validation([{ path: 'file', message: 'No file was sent' }])));
      }
    });

    req.pipe(parser);
  });
}
