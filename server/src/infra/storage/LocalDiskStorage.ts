/**
 * Local-disk storage provider — the default, ₹0 driver.
 *
 * Layout: `<root>/<institutionId>/<2-char shard>/<64 hex chars>`. The root is configured as an
 * absolute path outside anything the web server serves, and is git-ignored.
 *
 * Writes go to `<root>/.tmp/` first and are renamed into place only once every byte has arrived
 * inside the size budget, so a reader can never observe a half-written file and an aborted upload
 * leaves nothing behind but a temp file that is removed on the error path. Files are written
 * `0o600` — readable by the server process, executable by nobody.
 *
 * Every key is validated against a strict pattern AND its resolved path is checked to stay
 * inside the root, so even a key that somehow reached here from outside could not escape it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  StorageSizeExceededError,
  type PutOptions,
  type StorageProvider,
  type StoredObject,
} from './StorageProvider.js';

const KEY_PATTERN = /^[a-f\d]{24}\/[a-f\d]{2}\/[a-f\d]{64}$/;
const TENANT_PATTERN = /^[a-f\d]{24}$/;
const FILE_MODE = 0o600;

/** Counts and hashes bytes as they pass, and aborts once the budget is exceeded. */
class MeteredHash extends Transform {
  readonly hash = createHash('sha256');
  size = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.maxBytes) {
      callback(new StorageSizeExceededError());
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }
}

export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;
  private readonly tmpDir: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new Error('STORAGE_LOCAL_ROOT must be an absolute path');
    this.root = path.resolve(root);
    this.tmpDir = path.join(this.root, '.tmp');
  }

  /** Create the root and temp directories. Called once at boot. */
  async init(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
  }

  /** Resolve a key to a path, refusing anything that would land outside the root. */
  private resolveKey(storageKey: string): string {
    if (!KEY_PATTERN.test(storageKey)) throw new Error('Invalid storage key');
    const resolved = path.resolve(this.root, storageKey);
    if (!resolved.startsWith(this.root + path.sep)) throw new Error('Storage key escapes the root');
    return resolved;
  }

  localPath(storageKey: string): string {
    return this.resolveKey(storageKey);
  }

  async put(stream: Readable, options: PutOptions): Promise<StoredObject> {
    if (!TENANT_PATTERN.test(options.institutionId)) throw new Error('Invalid tenant id for storage');

    const name = randomBytes(32).toString('hex');
    const storageKey = `${options.institutionId}/${name.slice(0, 2)}/${name}`;
    const finalPath = this.resolveKey(storageKey);
    const tmpPath = path.join(this.tmpDir, `${name}.part`);

    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    const meter = new MeteredHash(options.maxBytes);

    try {
      await pipeline(stream, meter, createWriteStream(tmpPath, { mode: FILE_MODE, flags: 'wx' }));
      await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
      // Atomic within one filesystem: the file appears complete or not at all.
      await rename(tmpPath, finalPath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      // Make sure the source stops producing if the failure came from our side.
      if (!stream.destroyed) stream.destroy();
      throw err;
    }

    return { storageKey, size: meter.size, sha256: meter.hash.digest('hex') };
  }

  getStream(storageKey: string): Readable {
    return createReadStream(this.resolveKey(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(storageKey));
      return true;
    } catch {
      return false;
    }
  }
}
