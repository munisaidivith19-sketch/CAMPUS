# API Architecture

REST, versioned under `/api/v1`, plus a Socket.IO realtime channel (ADR-0003). This document
freezes API **conventions** and the **planned domain map**. Endpoints are implemented phase by
phase; everything below is marked with the phase that delivers it. In Phase 1 **no endpoints are
implemented** — this is the contract.

## Conventions

- **Base path:** `/api/v1`. Breaking changes ship under `/api/v2`; `v1` is maintained where practical.
- **Auth:** `Authorization: Bearer <access token>` for protected routes (Phase 2).
- **Tenant:** derived server-side from the authenticated principal — **never** from a client header/body.
- **Content type:** `application/json` except file upload (`multipart/form-data`).
- **Idempotency:** unsafe retriable operations accept an `Idempotency-Key` header where relevant.

### Response envelope

```jsonc
// success
{ "success": true, "data": <object|array>, "requestId": "req_..." }
// list
{ "success": true, "data": [...], "pagination": { "page": 1, "limit": 20, "total": 137, "hasNext": true }, "requestId": "req_..." }
// error
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [...] }, "requestId": "req_..." }
```

### Stable error codes

`AUTH_REQUIRED` · `AUTH_INVALID` · `MFA_REQUIRED` · `AUTHORIZATION_DENIED` · `TENANT_MISMATCH` ·
`VALIDATION_FAILED` · `NOT_FOUND` · `CONFLICT` · `RATE_LIMITED` · `PAYLOAD_TOO_LARGE` ·
`UNSUPPORTED_MEDIA_TYPE` · `MALWARE_DETECTED` · `INTERNAL`. Defined in `@campusconnect/config`.

### Pagination, filtering, sorting

List endpoints accept `?page`, `?limit` (capped, default 20, max 100), `?sort`, and an
**allowlisted** set of filter params per endpoint. Arbitrary query operators are rejected
(NoSQL-injection defense). Cursor pagination is used for high-volume feeds (chat, notifications).

### Rate limiting

Global per-IP limit at the proxy; finer per-user/per-route limits in the app (Redis-backed, with
in-memory fallback in dev). Auth-sensitive routes (login, forgot-password, OTP verify) have strict
limits and generic responses to prevent enumeration.

### Validation

Every route validates `params`, `query`, and `body` with a Zod schema from
`@campusconnect/validation` before the controller runs. Validation failures return
`VALIDATION_FAILED` with field-level `details`.

## Domain endpoint map (planned)

> Legend: **[P2]** Phase 2, **[P3]** Phase 3, **[P4]** Phase 4, **[P5]** Phase 5.
> Phase 3+ entries are **NOT IMPLEMENTED**.

### System
- `GET /health` — liveness/readiness (**implemented**, Phase 1; no auth).
- `GET /api/v1/meta` — API version + feature flags (**implemented**, Phase 2; no auth).

### Auth & identity — **IMPLEMENTED (Phase 2)**

All paths below are relative to `/api/v1`. "Public" means no access token is required; those
routes carry strict per-route rate limits and generic responses.

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| POST | `/auth/register` | Public | Institution domain enforced server-side; **generic 202** whether or not the address exists (no enumeration). Grants `STUDENT`. |
| POST | `/auth/verify-email` | Public | Spends the emailed token once; activates the account. |
| POST | `/auth/login` | Public | Returns `AUTHENTICATED`, `MFA_REQUIRED`, or `DEVICE_VERIFICATION_REQUIRED`. |
| POST | `/auth/mfa/verify` | Challenge | Completes an MFA-gated login with a TOTP code. |
| POST | `/auth/device/verify` | Challenge | Completes a new-device login with the emailed OTP. |
| POST | `/auth/refresh` | Refresh token | Rotates the refresh token; replaying a retired one revokes the session chain. |
| POST | `/auth/logout` | Bearer | Revokes the calling session. |
| POST | `/auth/logout-all` | Bearer | Revokes every session for the caller. |
| POST | `/auth/forgot-password` | Public | Always **202**, registered or not. |
| POST | `/auth/reset-password` | Public | Single-use token; revokes all sessions and emails a notification. |
| GET | `/me` | Bearer | The caller's account, including resolved permissions. |
| PATCH | `/me` | Bearer | Updates `fullName` / `phone` only. |
| GET | `/me/sessions` | Bearer | "My Devices"; the current session is flagged. |
| DELETE | `/me/sessions/:id` | Bearer | Revokes one owned session (another user's id → `NOT_FOUND`). |
| POST | `/me/sessions/revoke-others` | Bearer | Revokes every session except the caller's. |
| GET | `/me/login-history` | Bearer | Paginated; successes and failures with a coarse reason. |
| GET | `/me/security` | Bearer | Security-dashboard foundation: sessions + recent logins + failure count. |
| GET | `/me/profile` | Bearer | Student or faculty profile, chosen by role. |
| PATCH | `/me/profile/student` · `/me/profile/faculty` | Bearer | Self-editable profile fields only. |
| GET | `/me/student-id` | Bearer | The caller's active digital ID card. |
| POST | `/me/student-id/qr` | Bearer | Mints a short-lived, single-use, **opaque** QR token (no PII). |
| POST | `/me/mfa/enroll` · `/me/mfa/confirm` · `/me/mfa/disable` | Bearer | TOTP enrollment; disabling re-confirms the password. |
| GET | `/admin/users` | `user:read` | Tenant-scoped directory, paginated. |
| PUT | `/admin/users/:id/roles` | `role:assign` | Role assignment; audited with before/after roles. |
| GET | `/admin/roles` | `role:read` | The 14 seeded roles and their grants. |
| GET | `/admin/audit-logs` | `audit:read` | Append-only audit trail, paginated. |
| POST | `/admin/student-ids` | `studentid:issue` | Issues/re-issues a card; revokes the previous one. |
| POST | `/qr/verify` | `qr:verify` | Resolves a scanned code; cross-tenant scans return `NOT_FOUND`. |

### Academics [P3]
- `GET /subjects`, `GET /classes`, `GET /timetable`
- `GET /attendance` (scoped to caller's authority), `POST /attendance` (faculty), `POST /attendance/corrections`, `PATCH /attendance/corrections/:id`

### Community [P3]
- `GET/POST /announcements`, `GET /clubs`, `POST /clubs/:id/join`, `GET/POST /events`, `POST /events/:id/register`, `POST /events/:id/check-in`
- `GET/POST /discussions`, `POST /discussions/:id/comments`, `POST /reports`
- `GET /notifications`, `PATCH /notifications/:id/read`
- Chat over Socket.IO (below) + `GET /chats`, `GET /chats/:id/messages`
- `POST /files` (upload), `GET /files/:id` (authorized/signed download)

### Campus operations & career [P4]
- **Reusable workflow:** `POST /requests` (type=gate|hostel_leave|…), `GET /requests`,
  `POST /requests/:id/decide` — one engine backing gate pass, hostel leave/outing, event/academic permissions.
- `GET /gate/status`, `POST /gate/scan` (security), hostel/mess/medical/complaints/feedback/lost-found/achievements endpoints.
- Career: `GET/PUT /career/profile`, `GET /career/skill-gap`, `GET /jobs`, `GET /internships`, `POST /applications`.

### Platform & AI [P5]
- Institution admin/branding/subscription, analytics endpoints (role-scoped), recruiter portal,
  `POST /ai/assistant` and `POST /ai/career` (inherit caller authorization; never bypass it).

## Realtime (Socket.IO) [P3+]

- Auth handshake uses the access token; tenant + identity resolved as in HTTP.
- Rooms are tenant-scoped: `t:<institutionId>:chat:<chatId>`, `t:<institutionId>:user:<userId>` (notifications).
- Joining a room requires the same policy check as the equivalent REST endpoint.
- Events: `message:new`, `message:read`, `typing`, `presence`, `notification:new`.

## Authorization on every protected route

Route → authenticate → resolve tenant → authorize (role → permission → resource ownership →
ABAC condition) → validate → controller. Full model in `docs/security/SECURITY.md`. The API
**fails closed**: absent/ambiguous authorization means deny.
