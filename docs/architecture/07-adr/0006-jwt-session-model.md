# ADR 0006: Access/refresh JWT session model

- **Status:** Accepted
- **Date:** 2026-09-22 (proposed) · 2026-09-23 (accepted at the start of Phase 2)

## Context

Auth must support web + mobile, session listing/revocation ("My Devices"), login history,
new-device verification, and MFA — while keeping tokens hard to steal and easy to revoke.

## Decision

Short-lived **access JWT** (~15m, in memory) + long-lived **refresh token** (~30d) that maps to a
server-side **`Session` record** so it can be individually revoked. Web stores the refresh token
in an httpOnly, Secure, SameSite cookie; mobile stores it in Expo SecureStore. Each refresh
rotates the token (reuse detection). MFA and new-device checks gate refresh-token issuance.

## Consequences

- **Positive:** stateless fast-path (access token) with real revocation (session store); works
  across web/mobile; supports device management and suspicious-login handling.
- **Negative / accepted:** requires a `Session` collection and refresh-rotation bookkeeping;
  cookie vs. header handling differs per platform (encapsulated in the client `lib/` layer).

## Alternatives considered

- **Opaque server sessions only:** simplest revocation but a DB hit on every request. **Long-lived
  access tokens, no refresh:** poor revocation, higher theft impact. Both rejected.

## Implementation notes (Phase 2)

Accepted and implemented as specified, with these details settled during the build:

- **Access token** — a JWT carrying `sub`, `iid` (tenant), `sid` (session) and `roles`, typed
  with a `typ: "access"` claim so a challenge or refresh token can never be substituted for it.
  Permissions are *not* in the token; they are resolved per request from the RBAC data, so a
  role's grants can change without waiting for tokens to expire.
- **Refresh token** — opaque 32-byte random, never a JWT. Only its SHA-256 hash is stored, on
  the `Session` document. Web receives it as an httpOnly/SameSite=Lax cookie scoped to
  `/api/v1/auth`; native clients send `X-Client: mobile` and receive it in the body for
  Expo SecureStore.
- **Reuse detection** — each session retains the hashes it has rotated away. Presenting a
  retired token revokes the entire session and writes a `REFRESH_REUSE_DETECTED` audit entry.
- **Accepted window** — because access-token verification is stateless, revoking a session stops
  *renewal* immediately but an already-issued access token remains valid until it expires (at
  most `JWT_ACCESS_TTL`, default 15m). This is the cost of the stateless fast path and is
  accepted deliberately; a suspended user also cannot refresh, so the window is bounded.
- **MFA / new-device gates** — enforced before a session is created, carried between steps by a
  short-lived challenge JWT bound to the requesting device's fingerprint.
