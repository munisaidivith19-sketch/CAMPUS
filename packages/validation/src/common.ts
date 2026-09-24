/** Common reusable primitives shared by every domain schema. */
import { z } from 'zod';
import { PAGINATION } from '@campusconnect/config';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** Pagination query, with caps enforced here (never trust the client). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  sort: z.string().max(64).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Institution-email schema factory. The allowed domain is provided by the server from
 * config (COLLEGE_EMAIL_DOMAIN) — the backend enforces it; the frontend only mirrors it.
 */
export const institutionEmailSchema = (domain: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .refine((e) => e.endsWith(`@${domain.toLowerCase()}`), {
      message: `Email must be on the @${domain} domain`,
    });

/**
 * A list of uploaded-file ids to attach to something. Distinct and capped; whether each id is
 * really the caller's own, clean, unlinked file is decided by the server, never by this schema.
 */
export const attachmentIdsSchema = (max: number) =>
  z
    .array(objectIdSchema)
    .max(max, `At most ${max} attachments`)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: 'Duplicate attachment',
    })
    .default([]);
