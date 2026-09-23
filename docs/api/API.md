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
| POST | `/me/push-tokens` · DELETE `/me/push-tokens` | Bearer | Registers/removes a device push token for the caller only. |
| POST | `/me/mfa/enroll` · `/me/mfa/confirm` · `/me/mfa/disable` | Bearer | TOTP enrollment; disabling re-confirms the password. |
| GET | `/admin/users` | `user:read` | Tenant-scoped directory, paginated. |
| PUT | `/admin/users/:id/roles` | `role:assign` | Role assignment; audited with before/after roles. |
| GET | `/admin/roles` | `role:read` | The 14 seeded roles and their grants. |
| GET | `/admin/audit-logs` | `audit:read` | Append-only audit trail, paginated. |
| POST | `/admin/student-ids` | `studentid:issue` | Issues/re-issues a card; revokes the previous one. |
| POST | `/qr/verify` | `qr:verify` | Resolves a scanned code; cross-tenant scans return `NOT_FOUND`. |

### Academics — **IMPLEMENTED (Phase 3 Part A)**

Holding a permission here is not the same as holding the data. `attendance:read:scope` is held
by faculty, mentors, HODs and the principal alike; the service narrows every query to the
caller's academic scope, so each sees a different slice:

| Role | Scope |
| ---- | ----- |
| Student | their own records only |
| Faculty | the classes they teach |
| Class mentor | their section (every subject) + classes they teach |
| HOD | their department + classes they teach |
| Principal / system admin | the whole institution |

A role held without a backing assignment (a mentor with no section) resolves to an **empty**
scope, not a wide one.

| Method | Path | Permission | Notes |
| ------ | ---- | ---------- | ----- |
| GET | `/subjects` | `subject:read` | Institution-wide reference data. |
| GET | `/classes` | `class:read` | Narrowed to the caller's scope. |
| PUT | `/classes/:id/faculty` | `class:manage` | Assign teaching faculty. |
| GET | `/timetable` | `timetable:read` | `?scope=SECTION\|FACULTY`. |
| POST | `/attendance` | `attendance:mark` | Whole roster per class/date/period. Re-marking updates and is audited — never silent. |
| GET | `/attendance/roster/:id` | `attendance:mark` | The roster to mark against, with anything already recorded. |
| GET | `/attendance` | `attendance:read:self` or `:scope` | Row list, scope-narrowed. |
| GET | `/attendance/summary` | `attendance:read:self` or `:scope` | Per-subject + overall, with the below-75% flag. |
| GET | `/attendance/trend` | `attendance:read:self` or `:scope` | `?granularity=DAILY\|WEEKLY\|MONTHLY\|SEMESTER`. |
| GET | `/attendance/scope-summary` | `attendance:read:scope` | Per-student cohort view; never available to a student. |
| POST | `/attendance/corrections` | `attendance:correction:request` | On your own record only; one open request per record. |
| GET | `/attendance/corrections` | `attendance:correction:review` | The review queue, scope-narrowed. |
| GET | `/attendance/corrections/mine` | `attendance:correction:request` | Your own requests. |
| PATCH | `/attendance/corrections/:id` | `attendance:correction:review` | Approve/reject. Approval is **transactional** with the record update. |

**Attendance math contract:** `percentage = SUM(present) / SUM(total conducted) × 100`, derived
once from raw counts. Responses carry `present` and `total` alongside the percentage; a client
combining subjects must re-derive from the counts, because averaging per-subject percentages is
wrong whenever subjects have unequal numbers of conducted periods.

### Community — **IMPLEMENTED (Phase 3 Part A)**

| Method | Path | Permission | Notes |
| ------ | ---- | ---------- | ----- |
| GET | `/announcements` | `announcement:read` | Only those addressed to the caller; audience evaluated at read time. |
| POST | `/announcements` | `announcement:create` | Authority is checked per target: only a principal publishes college-wide, an HOD only to their own department, a mentor only to their own section, a club admin only to their club. |
| GET | `/announcements/:id` | `announcement:read` | Marks it read. Not addressed to you → `NOT_FOUND`. |
| POST | `/announcements/:id/read` | `announcement:read` | |
| GET | `/clubs` | `club:read` | `?suggested=true` returns **rule-based** matches with the reasons they matched. |
| GET | `/clubs/:id` · `/clubs/:id/members` | `club:read` | Pending requests visible to club admins only. |
| POST | `/clubs/:id/join` | `club:join` | |
| PATCH | `/clubs/memberships/:id` | `club:manage` | This club's admins only. |
| GET | `/events` | `event:read` | `?suggested=true`, `?upcomingOnly=true`. |
| POST | `/events` | `event:create` | Club events require being that club's admin. |
| POST | `/events/:id/register` | `event:register` | Capacity enforced by atomic conditional update. |
| POST | `/events/:id/qr` | `event:register` | Mints an opaque, single-use, purpose-bound check-in code. |
| POST | `/events/:id/check-in` | `event:checkin` | Resolves identity server-side; a replayed or wrong-purpose code is refused. |
| GET | `/events/registrations` | `event:read` | The caller's own registrations. |
| GET/POST | `/discussions` | `discussion:read` / `:create` | |
| GET/POST | `/discussions/:id/comments` | `discussion:read` / `comment:create` | |
| POST | `/comments/:id/reactions` | `comment:create` | Idempotent per user. |
| POST | `/reports` | `report:create` | Anyone may report. |
| GET | `/moderation/queue` | `moderation:review` | Reported content, most-reported first. |
| POST | `/moderation/discussions/:id` · `/moderation/comments/:id` | `moderation:review` | `REMOVE` (soft, audited) or `DISMISS`. |
| GET | `/notifications` | `notification:read:self` | In-app row is the source of truth; each row carries its email/push `deliveries` outcomes. |
| PATCH | `/notifications/:id/read` · POST `/notifications/read-all` | `notification:read:self` | |
| GET | `/search` | `search:query` | Announcements, discussions, events, clubs — tenant-scoped and authorization-filtered, so it cannot surface content the caller could not otherwise read. |

**Recommendations are rule-based, not AI.** Club and event suggestions are a set intersection
over declared interests, the categories a student already joined, and department peers; each
result carries the reasons it matched. AI-assisted suggestions are Phase 5 and would be labelled
separately.

### Community — Part B (NOT IMPLEMENTED)
- Chat over Socket.IO (below) + `GET /chats`, `GET /chats/:id/messages`
- `POST /files` (upload), `GET /files/:id` (authorized/signed download)
- Push and email notification delivery channels; the moderation-queue UI.

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
