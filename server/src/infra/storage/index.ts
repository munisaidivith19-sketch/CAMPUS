/**
 * The configured storage provider, created once.
 *
 * `STORAGE_DRIVER` is validated at boot (config/env.ts refuses anything but `local`), so this
 * never has to guess. Tests may swap the provider with `setStorageProvider` to observe or fault
 * the byte layer without touching the pipeline above it.
 */
import { config } from '../../config/env.js';
import { LocalDiskStorage } from './LocalDiskStorage.js';
import type { StorageProvider } from './StorageProvider.js';

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  provider ??= new LocalDiskStorage(config.STORAGE_LOCAL_ROOT);
  return provider;
}

/** Create the storage root at boot so the first upload does not pay for it. */
export async function initStorage(): Promise<void> {
  const storage = getStorage();
  if (storage instanceof LocalDiskStorage) await storage.init();
}

export function setStorageProvider(next: StorageProvider | null): void {
  provider = next;
}

export type { StorageProvider, StoredObject } from './StorageProvider.js';
export { StorageSizeExceededError } from './StorageProvider.js';
