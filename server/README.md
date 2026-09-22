# CampusConnect — Server

Express + TypeScript API. Sole datastore is MongoDB (Mongoose). Layering is strict:
`route → middleware → controller → service → repository → model` (see
`../docs/architecture/03-backend-architecture.md`).

## Scripts

```bash
npm run dev -w server        # tsx watch (needs a running MongoDB + a .env)
npm run typecheck -w server
npm run test -w server       # vitest
npm run build -w server && npm run start -w server
```

## Phase 1 status

Skeleton only. What exists:

- `config/env.ts` — validated, typed, fail-fast environment config.
- `app.ts` — Express app builder with security headers, CORS allowlist, body limits, request
  IDs, global rate limit, `/health`, versioned `/api/v1` router, and the central error handler.
- `routes/v1` — `GET /api/v1/meta` only.
- `db/connection.ts` — Mongoose connect with retry/backoff.
- `utils/` — logger (with secret redaction), `AppError`, response envelope helper.
- `index.ts` — entrypoint with graceful shutdown.

**No feature logic, no models, no auth** — those begin in Phase 2. Empty layer folders
(`controllers/`, `services/`, `repositories/`, `models/`, `policies/`, `validators/`,
`jobs/`, `sockets/`) are placeholders for that work.

## Folder contract

| Folder         | Holds                                                        |
| -------------- | ----------------------------------------------------------- |
| `config/`      | env schema + typed config (only place reading process.env)  |
| `loaders/`     | startup wiring (db, express, sockets, jobs)                 |
| `controllers/` | thin HTTP handlers                                          |
| `middleware/`  | auth, tenant, rate-limit, validation, upload, errors        |
| `models/`      | Mongoose schemas (`<Model>.model.ts`), one per file         |
| `routes/v1/`   | versioned route registration                                |
| `services/`    | business rules + transactions (framework-agnostic)          |
| `repositories/`| data access; safe, tenant-scoped queries                    |
| `validators/`  | Zod schemas (re-export shared + server-only)                |
| `policies/`    | authorization rules (RBAC/ABAC)                             |
| `sockets/`     | Socket.IO namespaces/handlers                               |
| `jobs/`        | background/queue workers                                    |
| `utils/`       | logger, errors, envelope, ids, crypto wrappers              |
| `db/`          | connection, index sync, seed                                |
