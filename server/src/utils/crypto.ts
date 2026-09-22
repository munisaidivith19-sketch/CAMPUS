/**
 * Cryptographic helpers — thin wrappers over Node's `crypto` only.
 *
 * Nothing here invents an algorithm (SECURITY.md §10). The choices:
 *  - **Random tokens** (refresh, reset, verify, QR): 32 bytes from a CSPRNG, base64url encoded.
 *  - **Token storage**: SHA-256. Correct for *high-entropy* secrets — there is nothing to brute
 *    force, so a slow KDF would only add latency. Passwords use Argon2id instead (ADR-0004).
 *  - **Comparison**: `timingSafeEqual`, never `===`, so comparison time can't leak the value.
 *  - **Secrets at rest** (TOTP seeds): AES-256-GCM with a key derived from JWT_ACCESS_SECRET via
 *    HKDF-SHA256 and a distinct `info` label, so that key is never reused for signing.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config/env.js';

/** A URL-safe, high-entropy token suitable for email links and QR payloads. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest — used to store high-entropy tokens, never passwords. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time compare of two hex digests of the same length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** A cryptographically random 6-digit numeric code (email OTP). Uniform, not modulo-biased. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/**
 * A stable, non-reversible device fingerprint. Deliberately coarse (user agent + client IP):
 * it is a *signal* for new-device verification, never an authorization input on its own.
 */
export function deviceFingerprint(userAgent: string, ip: string): string {
  return sha256(`${userAgent}|${ip}`);
}

const ENCRYPTION_KEY_INFO = 'campusconnect:mfa-secret:v1';

function encryptionKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(config.JWT_ACCESS_SECRET, 'utf8'), Buffer.alloc(0), ENCRYPTION_KEY_INFO, 32),
  );
}

/** AES-256-GCM encrypt. Output: `iv.ciphertext.authTag`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64url'), ciphertext.toString('base64url'), authTag.toString('base64url')].join('.');
}

/** AES-256-GCM decrypt. Throws if the ciphertext was tampered with (auth tag check). */
export function decryptSecret(payload: string): string {
  const [ivPart, dataPart, tagPart] = payload.split('.');
  if (!ivPart || !dataPart || !tagPart) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}
