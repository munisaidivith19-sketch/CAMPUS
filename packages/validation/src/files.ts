/**
 * File schemas. The upload itself is multipart and is checked by the server's pipeline (size,
 * declared type, magic bytes, archive limits, malware scan) rather than by Zod; these cover the
 * JSON-shaped edges around it.
 */
import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const fileIdParamSchema = z.object({ id: objectIdSchema });

/**
 * The signed download token. Opaque to clients; shape-checked here so a malformed or oversized
 * value is refused before any HMAC work is done.
 */
export const fileContentQuerySchema = z.object({
  token: z
    .string()
    .min(20)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Invalid token'),
});
export type FileContentQuery = z.infer<typeof fileContentQuerySchema>;
