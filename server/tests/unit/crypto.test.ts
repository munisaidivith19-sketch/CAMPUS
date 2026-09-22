/** Crypto helpers: token generation, hashing, constant-time compare, secret encryption. */
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  deviceFingerprint,
  encryptSecret,
  generateNumericCode,
  generateOpaqueToken,
  safeEqual,
  sha256,
} from '../../src/utils/crypto.js';

describe('opaque tokens', () => {
  it('are URL-safe so they survive an email link intact', () => {
    for (let i = 0; i < 25; i += 1) {
      expect(generateOpaqueToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('are unique across many draws', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(500);
  });
});

describe('sha256', () => {
  it('is stable and does not echo the input', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toContain('abc');
    expect(sha256('abc')).toHaveLength(64);
  });

  it('changes completely for a one-character difference', () => {
    expect(sha256('token-a')).not.toBe(sha256('token-b'));
  });
});

describe('safeEqual', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(safeEqual(sha256('x'), sha256('x'))).toBe(true);
    expect(safeEqual(sha256('x'), sha256('y'))).toBe(false);
  });

  it('returns false for mismatched lengths instead of throwing', () => {
    expect(safeEqual('short', 'considerably-longer')).toBe(false);
  });
});

describe('numeric OTP codes', () => {
  it('are always exactly six digits, including leading zeros', () => {
    for (let i = 0; i < 300; i += 1) {
      expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
    }
  });
});

describe('secret encryption at rest (AES-256-GCM)', () => {
  it('round-trips a TOTP seed', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('never stores the plaintext in the ciphertext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(encryptSecret(secret)).not.toContain(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same-secret')).not.toBe(encryptSecret('same-secret'));
  });

  it('refuses to decrypt tampered ciphertext (auth tag)', () => {
    const payload = encryptSecret('JBSWY3DPEHPK3PXP');
    const [iv, data, tag] = payload.split('.');
    const flipped = `${iv}.${data?.slice(0, -2)}AA.${tag}`;
    expect(() => decryptSecret(flipped)).toThrow();
  });

  it('rejects a malformed payload rather than silently returning junk', () => {
    expect(() => decryptSecret('nonsense')).toThrow();
  });
});

describe('device fingerprint', () => {
  it('is stable for the same client and different for another', () => {
    const a = deviceFingerprint('Mozilla/5.0 Chrome', '203.0.113.5');
    expect(a).toBe(deviceFingerprint('Mozilla/5.0 Chrome', '203.0.113.5'));
    expect(a).not.toBe(deviceFingerprint('Mozilla/5.0 Firefox', '203.0.113.5'));
    expect(a).not.toBe(deviceFingerprint('Mozilla/5.0 Chrome', '198.51.100.9'));
  });

  it('is not reversible to the user agent', () => {
    expect(deviceFingerprint('Mozilla/5.0 Chrome', '203.0.113.5')).not.toContain('Chrome');
  });
});
