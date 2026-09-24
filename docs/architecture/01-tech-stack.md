# Technology Stack & Rationale

Each choice below is frozen for the project. "Rejected" columns record what was considered
so later phases don't relitigate settled decisions without cause.

## Language

**TypeScript everywhere** (server, web, mobile, shared packages). Rationale: one language
across the stack, shared types/DTOs/validation, compile-time safety on API contracts,
strong editor tooling. `strict` mode plus `noUncheckedIndexedAccess` is enabled in
`tsconfig.base.json`.

## Backend

| Concern        | Choice                    | Why                                                        | Rejected / deferred                                     |
| -------------- | ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Runtime        | Node.js 20 LTS            | LTS, stable, ubiquitous, free                              | Bun (less mature for this scope)                        |
| HTTP framework | Express 4                 | Simple, battle-tested, huge middleware ecosystem           | NestJS (heavier), Fastify (fine, less familiar to team) |
| API style      | REST, versioned `/api/v1` | Simple, cacheable, matches CRUD-heavy domain               | GraphQL (auth/tenant complexity, N+1 risk early)        |
| Realtime       | Socket.IO                 | Rooms model fits chat/notifications; reconnection built-in | raw ws (more plumbing)                                  |
| Validation     | Zod                       | Shared schemas server+client; TS type inference            | Joi (no TS inference), class-validator                  |
| ORM/ODM        | Mongoose                  | Mature MongoDB ODM, schema validation, middleware          | Prisma Mongo (weaker Mongo feature support)             |

## Database

**MongoDB, sole primary datastore**, accessed via Mongoose. Chosen for the document-shaped,
rapidly-evolving domain (profiles, posts, events, chat) and flexible per-tenant data. A
single-node **replica set** runs even locally so multi-document **transactions** are available
(needed for workflows like gate-pass approval and attendance correction). No SQL database is
introduced; if one is ever proposed it requires an ADR and explicit approval.

**Redis is infrastructure only** — rate limiting, caching, queues/background jobs, and
session-adjacent state. It is never the primary datastore, and the local prototype must still
function (with documented degradation) when Redis is absent.

## Web frontend

| Concern    | Choice                | Why                                                        |
| ---------- | --------------------- | ---------------------------------------------------------- |
| Framework  | React 18              | Mandated; largest ecosystem                                |
| Build tool | Vite                  | Fast dev server, first-class TS, simple env handling       |
| Styling    | Tailwind CSS          | Token-driven utility CSS; pairs with the design system     |
| State      | Redux Toolkit         | Predictable global state; RTK Query for server cache       |
| Routing    | React Router          | Standard SPA routing with data APIs                        |
| HTTP       | Axios                 | Interceptors for auth refresh + error envelope handling    |
| Forms      | React Hook Form + Zod | Perf + shared validation schemas                           |
| Animation  | Framer Motion         | Declarative transitions; respects `prefers-reduced-motion` |
| Icons      | Lucide React          | Clean, consistent, tree-shakeable                          |

## Mobile

| Concern        | Choice                                 | Why                                            |
| -------------- | -------------------------------------- | ---------------------------------------------- |
| Framework      | React Native + Expo                    | One codebase iOS/Android; Expo = ₹0 tooling    |
| Styling        | NativeWind                             | Tailwind tokens shared with web where possible |
| State          | Redux Toolkit                          | Same model as web                              |
| Navigation     | React Navigation                       | De-facto RN standard                           |
| HTTP/realtime  | Axios + Socket.IO client               | Same contracts as web                          |
| Secure storage | Expo SecureStore                       | OS keychain for refresh tokens                 |
| Device         | Expo Camera / Location / Notifications | QR scan, SOS location, push                    |

## Infrastructure & dev services (all free/local)

| Service | Purpose                                   | Local provider                  |
| ------- | ----------------------------------------- | ------------------------------- |
| MongoDB | primary DB                                | `mongo:7` (Docker)              |
| Redis   | rate limit / cache / queues               | `redis:7-alpine`                |
| Mailpit | catches dev email, web UI                 | `axllent/mailpit`               |
| ClamAV  | upload malware scanning                   | `clamav/clamav` (profile-gated) |
| nginx   | reverse proxy / TLS / headers (prod-like) | `infrastructure/nginx`          |

## Security libraries (established, never hand-rolled)

Argon2id (`argon2`), JWT (`jsonwebtoken`), Helmet, `express-rate-limit` (+ Redis store),
`express-mongo-sanitize`-style operator stripping, Zod, Multer (uploads), `file-type`
(magic-byte sniffing), CORS allowlist. WebAuthn via a maintained library (e.g.
`@simplewebauthn/server`) when passkeys land. **No custom cryptography.**

## AI & job providers (abstractions, Phase 5 / Phase 4)

`AIProvider` interface with `gemini` (free tier) and `ollama` (fully local) implementations;
default `none`. `JobProvider` interface normalizing external job feeds to one schema; keys
stay server-side. Neither is wired up in Phase 1.

## Why npm workspaces (not Nx / Turborepo / pnpm) — for now

The monorepo needs exactly two things today: hoisted installs and cross-package imports of
shared types/schemas. npm workspaces provides both with zero extra tooling, no daemon, and
nothing new for a solo/student team to learn. Turborepo caching can be layered on later
without moving files (recorded as a future ADR) if build times warrant it. This keeps the
"understandable and maintainable local prototype" rule intact.
