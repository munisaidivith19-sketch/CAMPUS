/** Password hashing (ADR-0004). */
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../../src/services/password.service.js';

describe('password service', () => {
  it('hashes with Argon2id, not a faster family', async () => {
    const hash = await hashPassword('CorrectHorse#2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('never stores the plaintext anywhere in the hash', async () => {
    const plaintext = 'CorrectHorse#2026';
    const hash = await hashPassword(plaintext);
    expect(hash).not.toContain(plaintext);
  });

  it('produces a different hash for the same password (per-hash salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('SamePassword#1'), hashPassword('SamePassword#1')]);
    expect(a).not.toEqual(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('CorrectHorse#2026');
    await expect(verifyPassword(hash, 'CorrectHorse#2026')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'correcthorse#2026')).resolves.toBe(false);
    await expect(verifyPassword(hash, '')).resolves.toBe(false);
  });

  it('returns false instead of throwing on a corrupt hash, so it cannot become an oracle', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('flags hashes produced with weaker parameters for upgrade', async () => {
    const current = await hashPassword('CorrectHorse#2026');
    expect(needsRehash(current)).toBe(false);
    // A hash from a deliberately weaker configuration should be marked for rehash.
    const weak = '$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQxMjM0NTY$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9v';
    expect(needsRehash(weak)).toBe(true);
  });
});
