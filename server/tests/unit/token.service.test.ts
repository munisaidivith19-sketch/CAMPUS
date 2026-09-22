/** Token minting/verification (ADR-0006), including cross-type substitution defence. */
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { Role } from '@campusconnect/types';
import { config } from '../../src/config/env.js';
import {
  ChallengePurpose,
  generateRefreshToken,
  hashRefreshToken,
  parseDuration,
  signAccessToken,
  signChallengeToken,
  verifyAccessToken,
  verifyChallengeToken,
} from '../../src/services/token.service.js';

const claims = {
  sub: '507f1f77bcf86cd799439011',
  iid: '507f1f77bcf86cd799439012',
  sid: '507f1f77bcf86cd799439013',
  roles: [Role.STUDENT],
};

describe('parseDuration', () => {
  it('converts the config TTL formats to seconds', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('30d')).toBe(2_592_000);
  });

  it('rejects anything it cannot parse rather than guessing', () => {
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('15')).toThrow();
  });
});

describe('access tokens', () => {
  it('round-trips the claims it was given', () => {
    const verified = verifyAccessToken(signAccessToken(claims));
    expect(verified).toMatchObject({ sub: claims.sub, iid: claims.iid, sid: claims.sid });
    expect(verified?.roles).toEqual([Role.STUDENT]);
  });

  it('rejects a garbage token', () => {
    expect(verifyAccessToken('not.a.token')).toBeNull();
    expect(verifyAccessToken('')).toBeNull();
  });

  it('rejects a token signed with the wrong key', () => {
    const forged = jwt.sign({ ...claims, typ: 'access' }, 'a-different-secret-entirely-000000000');
    expect(verifyAccessToken(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ ...claims, typ: 'access' }, config.JWT_ACCESS_SECRET, { expiresIn: -10 });
    expect(verifyAccessToken(expired)).toBeNull();
  });

  it('refuses a challenge token presented as an access token', () => {
    const challenge = signChallengeToken({
      sub: claims.sub,
      iid: claims.iid,
      purpose: ChallengePurpose.MFA,
      fp: 'fingerprint',
    });
    expect(verifyAccessToken(challenge)).toBeNull();
  });

  it('refuses a token whose type claim was tampered with', () => {
    const wrongType = jwt.sign({ ...claims, typ: 'challenge' }, config.JWT_ACCESS_SECRET);
    expect(verifyAccessToken(wrongType)).toBeNull();
  });
});

describe('challenge tokens', () => {
  const base = { sub: claims.sub, iid: claims.iid, fp: 'device-fingerprint' };

  it('verifies only for the purpose it was issued for', () => {
    const token = signChallengeToken({ ...base, purpose: ChallengePurpose.MFA });
    expect(verifyChallengeToken(token, ChallengePurpose.MFA)).toMatchObject({ sub: claims.sub });
    // An MFA challenge must not be redeemable at the device-verification endpoint.
    expect(verifyChallengeToken(token, ChallengePurpose.DEVICE)).toBeNull();
  });

  it('refuses an access token presented as a challenge', () => {
    expect(verifyChallengeToken(signAccessToken(claims), ChallengePurpose.MFA)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are opaque and high-entropy, not JWTs', () => {
    const { token } = generateRefreshToken();
    expect(token.split('.').length).toBe(1);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('are unique per call', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateRefreshToken().token));
    expect(tokens.size).toBe(50);
  });

  it('hash deterministically so lookup by hash works, and the hash is not the token', () => {
    const { token, hash } = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
  });
});
