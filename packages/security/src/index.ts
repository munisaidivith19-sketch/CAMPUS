/**
 * @campusconnect/security — shared security helper CONTRACTS.
 *
 * Phase 1 defined the shapes and pure helpers that both server and (where relevant) clients
 * rely on; Phase 2 adds the pure authorization decision function in `policy.ts`.
 * Cryptographic operations (hashing, tokens, WebAuthn) are performed ONLY on the server with
 * established libraries — never re-implemented here. This package intentionally contains no
 * secrets and no crypto primitives.
 */
import type { Role, Permission } from '@campusconnect/types';

/** The authenticated principal shape resolved by auth middleware. */
export interface Principal {
  userId: string;
  institutionId: string;
  roles: Role[];
  permissions: Permission[];
  /** The session that issued the access token, so "my devices" can mark the current one. */
  sessionId?: string;
}

/** A resource under authorization evaluation. */
export interface ResourceRef {
  institutionId: string;
  ownerUserId?: string;
  type: string;
  id?: string;
}

/** The result of an authorization decision. Default is deny (fail closed). */
export type PolicyDecision = { allow: true } | { allow: false; reason: string };

/** Strip MongoDB operator/`$`-prefixed and dotted keys from untrusted objects (NoSQL-injection defense). */
export function stripDangerousKeys<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? stripDangerousKeys(value as Record<string, unknown>)
        : value;
  }
  return out as Partial<T>;
}

/** Constant-time-ish string compare wrapper marker (server uses crypto.timingSafeEqual). */
export const CONSTANT_TIME_COMPARE_NOTE =
  'Use crypto.timingSafeEqual on the server for token/secret comparison — never ===.';

export * from './policy.js';
