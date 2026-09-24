/**
 * The storage abstraction for file BYTES.
 *
 * MongoDB holds every file's metadata (`File` model); the bytes themselves live behind this
 * interface so the backing store can change — local disk today, an object store later — without
 * touching the upload pipeline or the access rules. Nothing outside `infra/storage/` knows where
 * bytes physically live.
 *
 * Storage keys are generated here, never derived from a client-supplied filename, so a name like
 * `../../etc/passwd` has no path to follow.
 */
import type { Readable } from 'node:stream';

export interface StoredObject {
  storageKey: string;
  size: number;
  /** Hex SHA-256 of the bytes, computed while they streamed in. */
  sha256: string;
}

export interface PutOptions {
  /** The tenant the bytes belong to; becomes the key prefix. */
  institutionId: string;
  /** Hard cap enforced WHILE streaming: the write aborts the moment it is exceeded. */
  maxBytes: number;
}

/** Thrown by `put` when the stream exceeds `maxBytes`. Nothing is left on disk. */
export class StorageSizeExceededError extends Error {
  constructor() {
    super('Upload exceeded the maximum allowed size');
    this.name = 'StorageSizeExceededError';
  }
}

export interface StorageProvider {
  /** Stream bytes in, hashing and size-checking as they arrive. Never buffers the whole file. */
  put(stream: Readable, options: PutOptions): Promise<StoredObject>;
  getStream(storageKey: string): Readable;
  /** Idempotent: deleting a key that is already gone is not an error. */
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  /**
   * A local path for readers that need random access (magic-byte sniffing, ZIP central
   * directory inspection). Providers without one would stage to a temp file instead.
   */
  localPath(storageKey: string): string;
}
