/**
 * Orphaned-upload cleanup worker.
 *
 * Files that were uploaded but never attached to anything (an abandoned composer, a message
 * that failed to send, a SCAN_FAILED hold) are removed once they are older than
 * `FILE_ORPHAN_TTL_HOURS`. Same shape as the delivery worker: an unref'd interval, started once
 * per process, and safe to run on every instance at the same time because each file is claimed
 * by a single conditional update in `runOrphanCleanup` — only the winner removes the bytes.
 */
import { config } from '../config/env.js';
import { runOrphanCleanup } from '../services/file.service.js';
import { logger } from '../utils/logger.js';

let timer: NodeJS.Timeout | null = null;
let running: Promise<number> | null = null;

function tick(): void {
  // Never overlap with ourselves on a slow run.
  if (running) return;
  running = runOrphanCleanup()
    .catch((err: unknown) => {
      logger.error({ err }, 'Orphan file cleanup failed');
      return 0;
    })
    .finally(() => {
      running = null;
    });
}

export function startFileCleanupWorker(): void {
  if (timer) return;
  tick();
  timer = setInterval(tick, config.FILE_CLEANUP_INTERVAL_MS);
  timer.unref();
}

export function stopFileCleanupWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
