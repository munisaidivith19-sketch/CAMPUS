/**
 * Password hashing (ADR-0004: Argon2id).
 *
 * Cost parameters come from config so they can be raised as hardware improves without a code
 * change. Verification failures never distinguish "no such user" from "wrong password" to the
 * caller — that decision lives in the auth service, but `verifyPassword` deliberately returns a
 * plain boolean and swallows malformed-hash errors so it cannot become an oracle.
 */
import argon2 from 'argon2';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: config.ARGON2_MEMORY_COST,
  timeCost: config.ARGON2_TIME_COST,
  parallelism: config.ARGON2_PARALLELISM,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, argonOptions);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch (err) {
    // A corrupt/unparseable hash is a verification failure, never an exception to the caller.
    logger.error({ err }, 'Password verification error');
    return false;
  }
}

/**
 * Cost-parameter drift check: a hash produced with weaker settings than the current config
 * should be upgraded the next time we legitimately hold the plaintext (i.e. at login).
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, argonOptions);
  } catch {
    return false;
  }
}
