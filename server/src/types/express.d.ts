/**
 * Express request augmentation.
 *
 * `principal` and `tenantId` are set ONLY by the authenticate/resolveTenant middleware, from a
 * verified access token — never from anything the client sends. They are optional in the type
 * so that forgetting the middleware is a compile-time visible mistake rather than a runtime
 * assumption.
 */
import type { Principal } from '@campusconnect/security';

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      tenantId?: string;
    }
  }
}

export {};
