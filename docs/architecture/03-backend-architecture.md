# Backend Architecture

## Layering (strict, one-directional)

```text
route → middleware chain → controller → service → repository → Mongoose model → MongoDB
```

| Layer            | Responsibility                                                          | May import                                    |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| **routes**       | Map HTTP verb+path to a middleware chain + controller method.           | middleware, controllers, validators           |
| **middleware**   | Cross-cutting: auth, tenant, rate limit, validation, upload, errors.    | utils, policies, config                       |
| **controllers**  | Parse the validated request, call one service, shape the response.      | services, utils                               |
| **services**     | Business rules, orchestration, transactions. The only place rules live. | repositories, other services, utils, policies |
| **repositories** | Data access. Build safe queries; the only layer touching models.        | models, utils                                 |
| **models**       | Mongoose schemas, indexes, schema-level validation.                     | (mongoose only)                               |

Controllers are **thin**: no DB calls, no business logic. Services are **framework-agnostic**:
no `req`/`res`. This keeps services unit-testable and lets the same service back both REST and
Socket.IO handlers (e.g. `sendMessage` used by an HTTP fallback and the socket layer).

## Configuration (`config/`)

Environment variables are read **once** at startup, validated with a Zod schema, and exposed as
a typed, frozen `config` object. The app **refuses to boot** if required vars are missing or
malformed (fail fast). No other module reads `process.env` directly.

## Error model

A single `AppError` class carries an HTTP status, a stable machine `code`, and a safe public
message. A central error-handling middleware converts any thrown error into the consistent
envelope and attaches the `requestId`. Unexpected errors are logged with full context but the
client only ever sees a generic message — never stack traces, secrets, or DB internals.

```jsonc
// success
{ "success": true, "data": { /* ... */ }, "requestId": "..." }
// failure
{ "success": false, "error": { "code": "AUTHORIZATION_DENIED", "message": "..." }, "requestId": "..." }
// paginated
{ "success": true, "data": [ /* ... */ ], "pagination": { "page": 1, "limit": 20, "total": 137 }, "requestId": "..." }
```

Stable error codes (e.g. `AUTH_REQUIRED`, `AUTHORIZATION_DENIED`, `VALIDATION_FAILED`,
`NOT_FOUND`, `RATE_LIMITED`, `TENANT_MISMATCH`, `CONFLICT`) are defined in
`@campusconnect/config` so clients can branch on them without string matching.

## Transactions

Multi-document invariants use Mongoose sessions/transactions (available because MongoDB runs as
a replica set even locally). Examples that will need them: gate-pass approval chain, attendance
correction with audit, event registration with capacity decrement, club membership approval.
Services own the transaction boundary; repositories accept an optional session.

## Realtime (`sockets/`)

Socket.IO connections authenticate with the same access token and resolve the same tenant +
identity as HTTP. Rooms are namespaced and **tenant-scoped** (e.g. `t:<institutionId>:chat:<chatId>`).
A socket may only join a room after the same authorization check the REST endpoint would run —
the socket layer calls the same policy functions. No authorization logic is duplicated.

## Background jobs (`jobs/`)

Redis-backed queue for work that shouldn't block a request: email dispatch, push fan-out,
notification aggregation, file post-processing (scan results), analytics rollups. When Redis is
absent in dev, jobs fall back to inline execution with a logged warning (documented degradation),
so the prototype still works at ₹0.

**Status today.** Rate limiting is Redis-backed (see the store and fail-open policy in
`middleware/rateLimit.middleware.ts` and docs/security/SECURITY.md). Notification delivery is
Redis-backed too: `services/deliveryQueue.ts` holds a `pending` LIST and an `inflight` ZSET, and
claims are made by a Lua script that pops and sets a visibility deadline in one atomic step, so
two instances never deliver the same item. Work survives a restart (it lives in Redis, not in the
process) and a worker that dies releases its item once the deadline lapses; the per-channel claim
in `notificationDelivery.service.ts` keeps that recovery from turning into a duplicate send.

When `REDIS_URL` is unset, or Redis is unreachable at enqueue time, delivery degrades to an
in-process queue and logs it: the in-app notification is still written and delivery is still
attempted on that instance, but queued work no longer survives a restart. The in-app row is
unaffected by any of this — it is the source of truth and is written before anything is queued.

## Repository pattern & safe queries

Repositories construct queries from **allowlisted** fields only. User-supplied objects are never
spread directly into a query or update. Query operators from untrusted input are stripped
(NoSQL-injection defense), and every tenant-scoped repository method requires an `institutionId`
argument — there is no "query all tenants" method on tenant-scoped models. See
`docs/security/SECURITY.md` and `docs/architecture/06-multi-tenancy.md`.

## Startup sequence (`loaders/`)

```text
load + validate config
  → connect MongoDB (retry w/ backoff) + ensure indexes
  → connect Redis (optional; degrade if absent)
  → build Express app (security headers, CORS, parsers, routes, error handler)
  → attach Socket.IO
  → start queue workers
  → listen on PORT (only in server entrypoint, not in app.ts)
```

`app.ts` builds and returns the Express app **without** listening, so integration tests can
import it directly with an in-memory/ephemeral MongoDB.
