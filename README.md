# CampusConnect

**College Community & Digital Campus Platform** — a scalable, secure, multi-tenant
digital campus ecosystem. This repository is a TypeScript-first monorepo containing
the web app, mobile app, backend API, shared packages, infrastructure, and docs.

> **Status: Phase 1 (Foundation) complete.** This repo currently contains the frozen
> architecture, the monorepo skeleton, configuration, the design-system tokens, Docker
> infrastructure, and documentation. **No product features are implemented yet** — that
> begins in Phase 2. See [`docs/product/PHASE_PLAN.md`](docs/product/PHASE_PLAN.md).

---

## What this is (and isn't)

CampusConnect centralizes fragmented college communication (notice boards, WhatsApp
groups, email, social media) into one platform covering community, academics, campus
operations, communication, student services, career, recruitment, alumni, security, and
(later) AI. It is **not** a traditional ERP or a basic college website.

The build proceeds in **5 controlled phases**. Each phase stops and waits for explicit
approval before the next begins. Phase boundaries and the "what's ready for next phase"
gate are defined in [`docs/product/PHASE_PLAN.md`](docs/product/PHASE_PLAN.md).

## Tech stack (frozen)

| Layer      | Choice                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| Web        | React + TypeScript + Vite, Tailwind, Redux Toolkit, React Router, Axios   |
| Mobile     | React Native + Expo + TypeScript, NativeWind, Redux Toolkit, React Nav    |
| Backend    | Node.js + Express + TypeScript, REST (versioned), Socket.IO               |
| Database   | **MongoDB only** (Mongoose) — sole primary datastore                      |
| Infra      | Redis (cache/rate-limit/queues), Mailpit (dev email), ClamAV (uploads)    |
| Validation | Zod (shared schemas), Mongoose schema validation                          |
| Auth       | Argon2id, JWT access/refresh, MFA/OTP, WebAuthn-ready                      |
| Design     | Glassmorphism / liquid-UI design system with shared tokens                |

Full rationale: [`docs/architecture/`](docs/architecture/).

## Repository layout

```text
campusconnect/
├── apps/
│   ├── web/          # React + Vite web client
│   └── mobile/       # Expo React Native app
├── server/           # Express + TypeScript API (controllers→services→repos→Mongoose)
├── packages/
│   ├── types/        # Shared TS types / DTOs / enums
│   ├── validation/   # Shared Zod schemas (used by server + clients)
│   ├── ui/           # Shared design tokens + primitives
│   ├── config/       # Shared runtime config loader + constants
│   └── security/     # Shared security helpers (sanitizers, policy types)
├── infrastructure/   # docker/, nginx/, monitoring/
├── docs/             # architecture/, api/, security/, database/, deployment/, product/
├── scripts/          # dev/setup helper scripts
├── tests/            # cross-cutting integration/, e2e/, security/
├── docker-compose.yml
├── .env.example
└── package.json      # npm workspaces root
```

A full annotated tree is in [`docs/architecture/02-folder-structure.md`](docs/architecture/02-folder-structure.md).

## Quick start (local, ₹0)

Prerequisites: Node.js ≥ 20.11, npm ≥ 10, Docker Desktop, Git. Windows-specific
step-by-step commands are in [`docs/deployment/SETUP_WINDOWS.md`](docs/deployment/SETUP_WINDOWS.md).

```bash
# 1. Install workspace dependencies
npm install

# 2. Create your local env file and review it
cp .env.example .env      # (Windows: copy .env.example .env)

# 3. Start backing services (MongoDB replica set, Redis, Mailpit)
docker compose up -d

# 4. (Later phases) run the API and web app
npm run dev:server
npm run dev:web
```

- Mailpit UI (caught dev emails): http://localhost:8025
- MongoDB: `mongodb://localhost:27017/campusconnect`
- To also run malware scanning: `docker compose --profile scan up -d`

## Documentation

| Area          | Start here                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Architecture  | [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md)  |
| Database      | [`docs/database/DATABASE.md`](docs/database/DATABASE.md)                |
| API           | [`docs/api/API.md`](docs/api/API.md)                                    |
| Security      | [`docs/security/SECURITY.md`](docs/security/SECURITY.md)                |
| Deployment    | [`docs/deployment/SETUP_WINDOWS.md`](docs/deployment/SETUP_WINDOWS.md)  |
| API keys      | [`docs/API_KEYS.md`](docs/API_KEYS.md)                                  |
| Phases        | [`docs/product/PHASE_PLAN.md`](docs/product/PHASE_PLAN.md)              |

## Security posture (summary)

Backend is the single source of truth; the frontend is never trusted for authorization.
Every protected request validates identity → role → permission → tenant → resource
ownership → business rule, and fails closed. Passwords use Argon2id; secrets stay in
`.env` (never committed, never shipped to any client). Full model:
[`docs/security/SECURITY.md`](docs/security/SECURITY.md).

## Contributing / workflow

Branches: `main`, `develop`, `feature/*`, `fix/*`, `security/*`. Conventional commits
(`feat(scope): …`). Never commit `.env`, secrets, keys, or real student PII. Development
uses **synthetic data only**.

## License

UNLICENSED — private academic project.
