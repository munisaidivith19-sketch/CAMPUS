/**
 * Token minting and verification (ADR-0006).
 *
 * Three distinct token kinds, deliberately different in nature:
 *  - **Access token** — a short-lived signed JWT. Stateless on purpose: verifying it costs no
 *    database round trip. The accepted trade-off (recorded in ADR-0006) is that revoking a
 *    session stops *renewal* immediately but an already-issued access token stays valid until
 *    it expires, at most JWT_ACCESS_TTL.
 *  - **Refresh token** — NOT a JWT. An opaque 32-byte random value whose SHA-256 hash is the
 *    only thing stored. It has no meaning without the matching `Session` row, which is what
 *    makes revocation and rotation real.
 *  - **Challenge token** — a short-lived JWT that carries a half-finished login across the MFA
 *    or new-device step. Signed with the refresh secret so it can never be confused with (or
 *    substituted for) an access token, and bound to the device fingerprint it was issued to.
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@campusconnect/types';
import { config } from '../config/env.js';
import { generateOpaqueToken, sha256 } from '../utils/crypto.js';

export const TokenType = {
  ACCESS: 'access',
  CHALLENGE: 'challenge',
} as const;

export const ChallengePurpose = {
  MFA: 'MFA',
  DEVICE: 'DEVICE',
} as const;
export type ChallengePurpose = (typeof ChallengePurpose)[keyof typeof ChallengePurpose];

export interface AccessTokenClaims {
  sub: string;
  iid: string;
  sid: string;
  roles: Role[];
  typ: typeof TokenType.ACCESS;
}

export interface ChallengeTokenClaims {
  sub: string;
  iid: string;
  purpose: ChallengePurpose;
  fp: string;
  typ: typeof TokenType.CHALLENGE;
}

/** Parse the `15m` / `30d` style TTLs from config into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit];
  return amount * multiplier;
}

export function accessTokenTtlSeconds(): number {
  return parseDuration(config.JWT_ACCESS_TTL);
}

export function refreshTokenTtlSeconds(): number {
  return parseDuration(config.JWT_REFRESH_TTL);
}

export function refreshTokenExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + refreshTokenTtlSeconds() * 1000);
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'typ'>): string {
  const payload: AccessTokenClaims = { ...claims, typ: TokenType.ACCESS };
  const options: SignOptions = { expiresIn: accessTokenTtlSeconds() };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, options);
}

/** Returns null for anything not a valid, unexpired access token — callers must fail closed. */
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const claims = decoded as Partial<AccessTokenClaims>;
    // A token of any other type must never be accepted here.
    if (claims.typ !== TokenType.ACCESS) return null;
    if (!claims.sub || !claims.iid || !claims.sid || !Array.isArray(claims.roles)) return null;
    return {
      sub: claims.sub,
      iid: claims.iid,
      sid: claims.sid,
      roles: claims.roles,
      typ: TokenType.ACCESS,
    };
  } catch {
    return null;
  }
}

/** Mint an opaque refresh token; only its hash is ever persisted. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = generateOpaqueToken(32);
  return { token, hash: sha256(token) };
}

export function hashRefreshToken(token: string): string {
  return sha256(token);
}

const CHALLENGE_TTL_SECONDS = 600;

export function signChallengeToken(claims: Omit<ChallengeTokenClaims, 'typ'>): string {
  const payload: ChallengeTokenClaims = { ...claims, typ: TokenType.CHALLENGE };
  const options: SignOptions = { expiresIn: CHALLENGE_TTL_SECONDS };
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, options);
}

export function verifyChallengeToken(
  token: string,
  expectedPurpose: ChallengePurpose,
): ChallengeTokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const claims = decoded as Partial<ChallengeTokenClaims>;
    if (claims.typ !== TokenType.CHALLENGE) return null;
    if (claims.purpose !== expectedPurpose) return null;
    if (!claims.sub || !claims.iid || !claims.fp) return null;
    return {
      sub: claims.sub,
      iid: claims.iid,
      purpose: claims.purpose,
      fp: claims.fp,
      typ: TokenType.CHALLENGE,
    };
  } catch {
    return null;
  }
}
