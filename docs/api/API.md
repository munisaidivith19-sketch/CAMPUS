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

| Method | Path                                                     | Auth              | Notes                                                                                                                          |
| ------ | -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/register`                                         | Public            | Institution domain enforced server-side; **generic 202** whether or not the address exists (no enumeration). Grants `STUDENT`. |
| POST   | `/auth/verify-email`                                     | Public            | Spends the emailed token once; activates the account.                                                                          |
| POST   | `/auth/login`                                            | Public            | Returns `AUTHENTICATED`, `MFA_REQUIRED`, or `DEVICE_VERIFICATION_REQUIRED`.                                                    |
| POST   | `/auth/mfa/verify`                                       | Challenge         | Completes an MFA-gated login with a TOTP code.                                                                                 |
| POST   | `/auth/device/verify`                                    | Challenge         | Completes a new-device login with the emailed OTP.                                                                             |
| POST   | `/auth/refresh`                                          | Refresh token     | Rotates the refresh token; replaying a retired one revokes the session chain.                                                  |
| POST   | `/auth/logout`                                           | Bearer            | Revokes the calling session.                                                                                                   |
| POST   | `/auth/logout-all`                                       | Bearer            | Revokes every session for the caller.                                                                                          |
| POST   | `/auth/forgot-password`                                  | Public            | Always **202**, registered or not.                                                                                             |
| POST   | `/auth/reset-password`                                   | Public            | Single-use token; revokes all sessions and emails a notification.                                                              |
| GET    | `/me`                                                    | Bearer            | The caller's account, including resolved permissions.                                                                          |
| PATCH  | `/me`                                                    | Bearer            | Updates `fullName` / `phone` only.                                                                                             |
| GET    | `/me/sessions`                                           | Bearer            | "My Devices"; the current session is flagged.                                                                                  |
| DELETE | `/me/sessions/:id`                                       | Bearer            | Revokes one owned session (another user's id → `NOT_FOUND`).                                                                   |
| POST   | `/me/sessions/revoke-others`                             | Bearer            | Revokes every session except the caller's.                                                                                     |
| GET    | `/me/login-history`                                      | Bearer            | Paginated; successes and failures with a coarse reason.                                                                        |
| GET    | `/me/security`                                           | Bearer            | Security-dashboard foundation: sessions + recent logins + failure count.                                                       |
| GET    | `/me/profile`                                            | Bearer            | Student or faculty profile, chosen by role.                                                                                    |
| PATCH  | `/me/profile/student` · `/me/profile/faculty`            | Bearer            | Self-editable profile fields only.                                                                                             |
| GET    | `/me/student-id`                                         | Bearer            | The caller's active digital ID card.                                                                                           |
| POST   | `/me/student-id/qr`                                      | Bearer            | Mints a short-lived, single-use, **opaque** QR token (no PII).                                                                 |
| POST   | `/me/push-tokens` · DELETE `/me/push-tokens`             | Bearer            | Registers/removes a device push token for the caller only.                                                                     |
| POST   | `/me/mfa/enroll` · `/me/mfa/confirm` · `/me/mfa/disable` | Bearer            | TOTP enrollment; disabling re-confirms the password.                                                                           |
| GET    | `/admin/users`                                           | `user:read`       | Tenant-scoped directory, paginated.                                                                                            |
| PUT    | `/admin/users/:id/roles`                                 | `role:assign`     | Role assignment; audited with before/after roles.                                                                              |
| GET    | `/admin/roles`                                           | `role:read`       | The 14 seeded roles and their grants.                                                                                          |
| GET    | `/admin/audit-logs`                                      | `audit:read`      | Append-only audit trail, paginated.                                                                                            |
| POST   | `/admin/student-ids`                                     | `studentid:issue` | Issues/re-issues a card; revokes the previous one.                                                                             |
| POST   | `/qr/verify`                                             | `qr:verify`       | Resolves a scanned code; cross-tenant scans return `NOT_FOUND`.                                                                |

### Academics — **IMPLEMENTED (Phase 3 Part A)**

Holding a permission here is not the same as holding the data. `attendance:read:scope` is held
by faculty, mentors, HODs and the principal alike; the service narrows every query to the
caller's academic scope, so each sees a different slice:

| Role                     | Scope                                              |
| ------------------------ | -------------------------------------------------- |
| Student                  | their own records only                             |
| Faculty                  | the classes they teach                             |
| Class mentor             | their section (every subject) + classes they teach |
| HOD                      | their department + classes they teach              |
| Principal / system admin | the whole institution                              |

A role held without a backing assignment (a mentor with no section) resolves to an **empty**
scope, not a wide one.

| Method | Path                           | Permission                         | Notes                                                                                 |
| ------ | ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/subjects`                    | `subject:read`                     | Institution-wide reference data.                                                      |
| GET    | `/classes`                     | `class:read`                       | Narrowed to the caller's scope.                                                       |
| PUT    | `/classes/:id/faculty`         | `class:manage`                     | Assign teaching faculty.                                                              |
| GET    | `/timetable`                   | `timetable:read`                   | `?scope=SECTION\|FACULTY`.                                                            |
| POST   | `/attendance`                  | `attendance:mark`                  | Whole roster per class/date/period. Re-marking updates and is audited — never silent. |
| GET    | `/attendance/roster/:id`       | `attendance:mark`                  | The roster to mark against, with anything already recorded.                           |
| GET    | `/attendance`                  | `attendance:read:self` or `:scope` | Row list, scope-narrowed.                                                             |
| GET    | `/attendance/summary`          | `attendance:read:self` or `:scope` | Per-subject + overall, with the below-75% flag.                                       |
| GET    | `/attendance/trend`            | `attendance:read:self` or `:scope` | `?granularity=DAILY\|WEEKLY\|MONTHLY\|SEMESTER`.                                      |
| GET    | `/attendance/scope-summary`    | `attendance:read:scope`            | Per-student cohort view; never available to a student.                                |
| POST   | `/attendance/corrections`      | `attendance:correction:request`    | On your own record only; one open request per record.                                 |
| GET    | `/attendance/corrections`      | `attendance:correction:review`     | The review queue, scope-narrowed.                                                     |
| GET    | `/attendance/corrections/mine` | `attendance:correction:request`    | Your own requests.                                                                    |
| PATCH  | `/attendance/corrections/:id`  | `attendance:correction:review`     | Approve/reject. Approval is **transactional** with the record update.                 |

**Attendance math contract:** `percentage = SUM(present) / SUM(total conducted) × 100`, derived
once from raw counts. Responses carry `present` and `total` alongside the percentage; a client
combining subjects must re-derive from the counts, because averaging per-subject percentages is
wrong whenever subjects have unequal numbers of conducted periods.

### Community — **IMPLEMENTED (Phase 3 Part A)**

| Method   | Path                                                       | Permission                           | Notes                                                                                                                                                                               |
| -------- | ---------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/announcements`                                           | `announcement:read`                  | Only those addressed to the caller; audience evaluated at read time.                                                                                                                |
| POST     | `/announcements`                                           | `announcement:create`                | Authority is checked per target: only a principal publishes college-wide, an HOD only to their own department, a mentor only to their own section, a club admin only to their club. |
| GET      | `/announcements/:id`                                       | `announcement:read`                  | Marks it read. Not addressed to you → `NOT_FOUND`.                                                                                                                                  |
| POST     | `/announcements/:id/read`                                  | `announcement:read`                  |                                                                                                                                                                                     |
| GET      | `/clubs`                                                   | `club:read`                          | `?suggested=true` returns **rule-based** matches with the reasons they matched.                                                                                                     |
| GET      | `/clubs/:id` · `/clubs/:id/members`                        | `club:read`                          | Pending requests visible to club admins only.                                                                                                                                       |
| POST     | `/clubs/:id/join`                                          | `club:join`                          |                                                                                                                                                                                     |
| PATCH    | `/clubs/memberships/:id`                                   | `club:manage`                        | This club's admins only.                                                                                                                                                            |
| GET      | `/events`                                                  | `event:read`                         | `?suggested=true`, `?upcomingOnly=true`.                                                                                                                                            |
| POST     | `/events`                                                  | `event:create`                       | Club events require being that club's admin.                                                                                                                                        |
| POST     | `/events/:id/register`                                     | `event:register`                     | Capacity enforced by atomic conditional update.                                                                                                                                     |
| POST     | `/events/:id/qr`                                           | `event:register`                     | Mints an opaque, single-use, purpose-bound check-in code.                                                                                                                           |
| POST     | `/events/:id/check-in`                                     | `event:checkin`                      | Resolves identity server-side; a replayed or wrong-purpose code is refused.                                                                                                         |
| GET      | `/events/registrations`                                    | `event:read`                         | The caller's own registrations.                                                                                                                                                     |
| GET/POST | `/discussions`                                             | `discussion:read` / `:create`        |                                                                                                                                                                                     |
| GET/POST | `/discussions/:id/comments`                                | `discussion:read` / `comment:create` |                                                                                                                                                                                     |
| POST     | `/comments/:id/reactions`                                  | `comment:create`                     | Idempotent per user.                                                                                                                                                                |
| POST     | `/reports`                                                 | `report:create`                      | Anyone may report.                                                                                                                                                                  |
| GET      | `/moderation/queue`                                        | `moderation:review`                  | Reported content, most-reported first.                                                                                                                                              |
| POST     | `/moderation/discussions/:id` · `/moderation/comments/:id` | `moderation:review`                  | `REMOVE` (soft, audited) or `DISMISS`.                                                                                                                                              |
| GET      | `/notifications`                                           | `notification:read:self`             | In-app row is the source of truth; each row carries its email/push `deliveries` outcomes.                                                                                           |
| PATCH    | `/notifications/:id/read` · POST `/notifications/read-all` | `notification:read:self`             |                                                                                                                                                                                     |
| GET      | `/search`                                                  | `search:query`                       | Announcements, discussions, events, clubs — tenant-scoped and authorization-filtered, so it cannot surface content the caller could not otherwise read.                             |

**Recommendations are rule-based, not AI.** Club and event suggestions are a set intersection
over declared interests, the categories a student already joined, and department peers; each
result carries the reasons it matched. AI-assisted suggestions are Phase 5 and would be labelled
separately.

### Chat (Phase 3 Part C-2)

**Chat is NOT end-to-end encrypted.** Bodies are stored server-side so they can be moderated;
"secure" here means TLS, strict authorization, tenant isolation and no bodies in logs, push,
email or audit entries. See docs/security/SECURITY.md.

Membership is the grant. `chat:read` means you may use chat at all — the active `ChatMembership`
row decides _which_ conversation, so a caller holding every permission still sees only their own.
Every refusal is `NOT_FOUND`, never `FORBIDDEN`, so a chat id cannot be probed for existence.

| Method | Path                                                       | Permission                             | Notes                                                                                                                                                                                                                                           |
| ------ | ---------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/chats`                                                   | `chat:read`                            | The caller's chats, most recent first, with a per-chat unread count. Materialises the CLASS/CLUB chats they are entitled to.                                                                                                                    |
| POST   | `/chats`                                                   | `chat:create`                          | `{type:DIRECT,userId}` or `{type:GROUP,name,memberIds}`. CLASS/CLUB are derived and not creatable here. A repeat DIRECT create returns the existing chat (unique index, race-safe).                                                             |
| GET    | `/chats/users?q=`                                          | `chat:create`                          | The new-chat picker: a capped name search (2–60 chars, ≤20 results), never a directory listing.                                                                                                                                                 |
| GET    | `/chats/:id`                                               | `chat:read`                            | Chat + members, members only for members.                                                                                                                                                                                                       |
| POST   | `/chats/:id/members` · DELETE `/chats/:id/members/:userId` | `chat:manage`                          | GROUP only, OWNER/ADMIN only. The owner cannot be removed.                                                                                                                                                                                      |
| POST   | `/chats/:id/leave`                                         | `chat:read`                            | GROUP only.                                                                                                                                                                                                                                     |
| GET    | `/chats/:id/messages?before=&limit=`                       | `chat:read`                            | Cursor pagination by message id (limit ≤ 50), newest first.                                                                                                                                                                                     |
| POST   | `/chats/:id/messages`                                      | `chat:message:send`                    | HTTP fallback for sending. `clientMessageId` required and idempotent. Rate-limited per user. Optional `attachmentFileIds` (≤ 5, see Files).                                                                                                     |
| PATCH  | `/chats/:id/messages/:messageId`                           | `chat:message:send`                    | Sender only, within 15 minutes, not deleted.                                                                                                                                                                                                    |
| DELETE | `/chats/:id/messages/:messageId`                           | `chat:message:send` or `chat:moderate` | Sender soft-deletes their own; a moderator removes one inside their scope (club admin → their club, mentor/HOD/principal → their class chats) and the removal is audited. A deleted message returns `{deleted:true}` with no body, to everyone. |
| POST   | `/chats/:id/read`                                          | `chat:read`                            | `{lastReadMessageId}`; moves forward only.                                                                                                                                                                                                      |
| PATCH  | `/chats/:id/mute`                                          | `chat:read`                            | Per-member.                                                                                                                                                                                                                                     |

Chat messages are reportable through the existing `POST /reports` with
`targetType: CHAT_MESSAGE`, and only from inside the chat.

### Files — **IMPLEMENTED (Phase 3 Part C-3)**

A file has **no access list of its own**. It is `PRIVATE` (its owner's alone) until it is
attached to something, and then it is readable by exactly those who can read that thing — a chat
message's members, an announcement's audience — evaluated at read time by that resource's own
rules. Leaving a chat, or being removed from it, takes its attachments with it immediately. Every
refusal is `NOT_FOUND`.

| Method | Path                         | Permission    | Notes                                                                                                                                                                                                                                    |
| ------ | ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/files`                     | `file:upload` | `multipart/form-data`, one part named `file`. Per-user rate limit (`UPLOAD_RATE_PER_HOUR`) and quota (`USER_UPLOAD_QUOTA_BYTES`). Returns `201` with a `FileDTO` (`PRIVATE`).                                                            |
| GET    | `/files/:id`                 | `file:read`   | Re-authorizes, then returns `{ file, url, expiresAt }`: a signed URL valid for `FILE_DOWNLOAD_TOKEN_TTL_S` (300 s). A file that has not passed scanning → `409 CONFLICT`.                                                                |
| GET    | `/files/:id/meta`            | `file:read`   | Metadata only, no URL.                                                                                                                                                                                                                   |
| GET    | `/files/:id/content?token=…` | Signed token  | **No bearer token** (it is a browser download). The HMAC token binds file + user + tenant + expiry; the server still re-checks that user's access now, so an unexpired URL stops working the moment access is lost. Any failure → `404`. |
| DELETE | `/files/:id`                 | `file:upload` | Your own **unattached** file: bytes removed, metadata soft-deleted, audited. Attached → `409`. Anyone else's → `404`.                                                                                                                    |

**Upload pipeline** (in this order, each step fail-closed with a stable code):

| Step                                                                                                                                                                                      | Refusal                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated, `file:upload`, per-user rate limit                                                                                                                                         | `401` / `403` / `429 RATE_LIMITED`                                                                                                                                                                                                              |
| Quota already used up                                                                                                                                                                     | `413 QUOTA_EXCEEDED`                                                                                                                                                                                                                            |
| `Content-Length` over the limit; then the same limit enforced **while streaming** (a request that hides its length is cut off)                                                            | `413 PAYLOAD_TOO_LARGE`                                                                                                                                                                                                                         |
| Extension + declared MIME must name one allowlisted type                                                                                                                                  | `415 UNSUPPORTED_MEDIA_TYPE`                                                                                                                                                                                                                    |
| Magic bytes (`file-type`) must match that type; text must be UTF-8 without NULs; no markup (`<script`, `<svg`, `<html`, …) in images, PDFs or text; no ZIP riding on a non-ZIP (polyglot) | `415 UNSUPPORTED_MEDIA_TYPE`                                                                                                                                                                                                                    |
| ZIP and DOCX/XLSX/PPTX: central-directory only (nothing extracted) — entry count, total uncompressed size, per-entry and overall ratio, nested archives, absolute / `..` paths            | `415 UNSUPPORTED_MEDIA_TYPE`                                                                                                                                                                                                                    |
| ClamAV `INSTREAM` when enabled                                                                                                                                                            | infected → `422 MALWARE_DETECTED` (bytes destroyed, row kept as `INFECTED`, audited); unreachable → `503 SCAN_FAILED` (held, never downloadable or attachable); disabled → `SKIPPED` (downloadable in development only, labelled "not scanned") |
| Quota re-checked against the real size                                                                                                                                                    | `413 QUOTA_EXCEEDED`                                                                                                                                                                                                                            |

Allowlist (default `UPLOAD_ALLOWED_TYPES`): PDF, PNG, JPEG, WEBP, GIF, DOCX, XLSX, PPTX, TXT, CSV,
ZIP. Display names are sanitized (path parts, control/bidi/zero-width characters and leading dots
removed; length capped). Storage keys are random and never derived from the name.

**Content response headers:** `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`,
the verified `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`,
`Content-Security-Policy: sandbox`.

**Attaching.** `POST /chats/:id/messages` and the socket `message:send` accept
`attachmentFileIds` (≤ 5, distinct); `POST /announcements` accepts `attachmentFileIds` (≤ 10).
Only the caller's own, live, unattached files that have passed scanning can be attached — anything
else fails the whole send with `404` and nothing is stored. A message may be attachments only
(empty body). Messages and announcements carry `attachments: [{id, name, mime, size, scanStatus}]`
— metadata only, never a URL or storage key, including in the `message:new` socket event.
Deleting a message deletes its files (bytes removed; a moderator removal is audited as before).
Unattached uploads older than `FILE_ORPHAN_TTL_HOURS` are removed by a multi-instance-safe job.

Announcements have no delete endpoint in Phase 3, so their attachments live as long as they do.

### Campus operations & career [P4]

- **Reusable workflow:** `POST /requests` (type=gate|hostel_leave|…), `GET /requests`,
  `POST /requests/:id/decide` — one engine backing gate pass, hostel leave/outing, event/academic permissions.
- `GET /gate/status`, `POST /gate/scan` (security), hostel/mess/medical/complaints/feedback/lost-found/achievements endpoints.
- Career: `GET/PUT /career/profile`, `GET /career/skill-gap`, `GET /jobs`, `GET /internships`, `POST /applications`.

### Platform & AI [P5]

- Institution admin/branding/subscription, analytics endpoints (role-scoped), recruiter portal,
  `POST /ai/assistant` and `POST /ai/career` (inherit caller authorization; never bypass it).

## Realtime (Socket.IO) — implemented in Part C-2

- **Handshake:** the access token in `auth.token` (never a query string, never a cookie). Identity
  and permissions are resolved by the same `principalFromAccessToken` the HTTP middleware uses,
  **plus** a session-liveness check that HTTP does not do — a request is over in milliseconds, a
  socket would hold a revoked device open for the rest of the token's life. Logout, logout-all,
  session revoke, password reset and a role change disconnect that user's live sockets.
- **Rooms** are tenant-scoped and built server-side: `t:<institutionId>:user:<userId>` (joined
  automatically) and `t:<institutionId>:chat:<chatId>` (only via `chat:join`, which runs the same
  policy as the REST route). A client can never name a room.
- **Client → server:** `chat:join`, `chat:leave`, `message:send`, `message:read`, `typing`. Every
  payload is Zod-validated — including an injection check on the raw frame, since a socket does
  not pass through the HTTP sanitize middleware — and every handler acks
  `{ok:true,data}` or `{ok:false,error:{code}}` without dropping the connection.
- **Server → client:** `message:new`, `message:updated`, `message:deleted`, `message:read`,
  `typing`, `presence`, `notification:new`, `chat:removed`, `session:ended`.
- **Scaling:** the Redis adapter when `REDIS_URL` is reachable, the in-memory adapter otherwise
  (single-instance fan-out), reported by `isRealtimeDegraded()`.
- **Limits:** per-connection event budget (`CHAT_SOCKET_EVENTS_PER_MINUTE`), `maxHttpBufferSize`
  64 KiB, CORS from the same allowlist as HTTP. Sending also passes the per-user Redis-backed
  send limit, because REST and socket share one service function.

## Authorization on every protected route

Route → authenticate → resolve tenant → authorize (role → permission → resource ownership →
ABAC condition) → validate → controller. Full model in `docs/security/SECURITY.md`. The API
**fails closed**: absent/ambiguous authorization means deny.
