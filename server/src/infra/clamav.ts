/**
 * A minimal clamd INSTREAM client.
 *
 * The protocol is clamd's own and deliberately simple: send `zINSTREAM\0`, then the bytes as
 * length-prefixed chunks, then a zero-length chunk; clamd answers `stream: OK` or
 * `stream: <signature> FOUND`. There is no cryptography here, only framing, so a small client
 * is less risk than another dependency.
 *
 * Every failure to get a clear verdict — refused connection, timeout, an error reply, a reply we
 * do not recognise — is reported as `ScannerUnavailableError`. The caller treats that as
 * SCAN_FAILED, which is never downloadable: "we could not check it" is not "it is clean".
 */
import net from 'node:net';
import type { Readable } from 'node:stream';

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

export type ScanVerdict = { status: 'CLEAN' } | { status: 'INFECTED'; signature: string };

export interface ClamAvOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

/** clamd's default StreamMaxLength is 25 MiB; chunks well under it keep memory flat. */
const CHUNK_BYTES = 64 * 1024;

function frame(chunk: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([header, chunk]);
}

export function parseReply(reply: string): ScanVerdict {
  const text = reply.replace(/\0/g, '').trim();
  if (/^stream: OK$/i.test(text)) return { status: 'CLEAN' };
  const found = /^stream: (.+) FOUND$/i.exec(text);
  if (found?.[1]) return { status: 'INFECTED', signature: found[1].slice(0, 200) };
  throw new ScannerUnavailableError(`Unexpected scanner reply: ${text.slice(0, 120)}`);
}

export async function scanStream(source: Readable, options: ClamAvOptions): Promise<ScanVerdict> {
  return new Promise<ScanVerdict>((resolve, reject) => {
    const socket = net.createConnection({ host: options.host, port: options.port });
    let reply = '';
    let settled = false;

    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      source.destroy();
      reject(new ScannerUnavailableError(message));
    };

    socket.setTimeout(options.timeoutMs, () => fail('Scanner timed out'));
    socket.on('error', (err) => fail(`Scanner connection failed: ${err.message}`));
    const settleWithReply = (): void => {
      if (settled) return;
      try {
        const verdict = parseReply(reply);
        settled = true;
        socket.destroy();
        resolve(verdict);
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Scanner reply unreadable');
      }
    };

    socket.on('data', (data) => {
      reply += data.toString('utf8');
      // clamd terminates its reply with NUL in `z` mode; that is the verdict, complete.
      if (reply.includes('\0')) settleWithReply();
    });
    socket.on('close', settleWithReply);

    socket.on('connect', () => {
      void (async () => {
        try {
          socket.write('zINSTREAM\0');
          for await (const chunk of source) {
            const buffer = chunk as Buffer;
            for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
              const ok = socket.write(frame(buffer.subarray(offset, offset + CHUNK_BYTES)));
              if (!ok) await new Promise<void>((drained) => socket.once('drain', drained));
              if (settled) return;
            }
          }
          // The zero-length chunk ends the stream. The socket is NOT half-closed: clamd (and
          // Docker's port proxy in front of it) treats an early FIN as an aborted scan and
          // closes without a verdict, which we would then report as "scanner unavailable".
          socket.write(Buffer.alloc(4));
        } catch (err) {
          fail(`Could not stream to scanner: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    });
  });
}
