/**
 * NoSQL-injection defense at the edge.
 *
 * Strips MongoDB operator keys (`$gt`, `$ne`, `$where`, …) and dotted paths from every incoming
 * body, query and params object, before any handler can pass them along. Zod validation is the
 * primary control — an object where a string is expected fails validation anyway — but this
 * runs first and unconditionally, so a route that ever forgets its schema still cannot hand a
 * query operator to the database.
 *
 * Keys are deleted in place rather than reassigning `req.query`, which is a getter in Express 4.
 */
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

function scrub(value: unknown, removed: string[], depth = 0): void {
  // Bounded depth: a deeply nested payload should not become a CPU sink.
  if (depth > 8 || value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) scrub(item, removed, depth + 1);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete record[key];
      removed.push(key);
      continue;
    }
    scrub(record[key], removed, depth + 1);
  }
}

export function sanitizeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const removed: string[] = [];

  scrub(req.body, removed);
  scrub(req.query, removed);
  scrub(req.params, removed);

  if (removed.length > 0) {
    // Worth knowing about: legitimate clients never send these.
    logger.warn({ removed, path: req.path }, 'Stripped MongoDB operator keys from request');
  }

  next();
}
