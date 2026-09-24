/**
 * Signed, short-lived download URLs.
 *
 * The token is `<payload>.<signature>`: a base64url JSON payload naming the file, the user it
 * was minted for, their tenant and an expiry, and an HMAC-SHA256 over exactly those bytes with a
 * backend-only key. It proves the server issued it for that user and that file, recently. It is
 * NOT the whole authorization: the content endpoint re-checks the user's access to the file
 * before streaming, so revoking someone's access also revokes their unexpired links.
 *
 * `FILE_SIGNING_SECRET` is required in production. In development a missing secret falls back
 * to a random per-process key, which works on one instance and is warned about, because a URL
 * minted by one instance then fails on another.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let fallbackSecret: string | null = null;

function signingKey(): string {
  if (config.FILE_SIGNING_SECRET) return config.FILE_SIGNING_SECRET;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    if (!config.isTest) {
      logger.warn(
        'FILE_SIGNING_SECRET is not set — using a per-process key; download links will not work across instances',
      );
    }
  }
  return fallbackSecret;
}

export interface DownloadClaims {
  fileId: string;
  userId: string;
  institutionId: string;
  /** Unix seconds. */
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function signDownloadToken(claims: DownloadClaims): string {
  const payload = Buffer.from(
    JSON.stringify({
      f: claims.fileId,
      u: claims.userId,
      i: claims.institutionId,
      e: claims.expiresAt,
    }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns the claims only for an authentic, unexpired token; null for anything else. */
export function verifyDownloadToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): DownloadClaims | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const { f, u, i, e } = parsed;
    if (
      typeof f !== 'string' ||
      typeof u !== 'string' ||
      typeof i !== 'string' ||
      typeof e !== 'number'
    ) {
      return null;
    }
    if (e < nowSeconds) return null;
    return { fileId: f, userId: u, institutionId: i, expiresAt: e };
  } catch {
    return null;
  }
}
