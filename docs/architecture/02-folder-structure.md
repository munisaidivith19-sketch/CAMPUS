# Monorepo Folder Structure (annotated)

This is the frozen physical layout. Directories exist now as the skeleton; files are added
phase by phase. The structure — not the current file count — is the contract.

```text
campusconnect/
├── apps/
│   ├── web/                     # React + Vite web client
│   │   ├── public/              # static assets served as-is
│   │   └── src/
│   │       ├── app/             # app bootstrap (providers, root, error boundary)
│   │       ├── components/
│   │       │   ├── ui/          # design-system primitives (Button, Card, Input…)
│   │       │   └── layout/      # shells, nav, sidebars
│   │       ├── features/        # feature slices (added per phase: auth, attendance…)
│   │       ├── hooks/           # reusable React hooks
│   │       ├── lib/             # axios client, socket client, helpers
│   │       ├── routes/          # route definitions + guards
│   │       ├── store/           # Redux store + RTK Query api slices
│   │       ├── styles/          # Tailwind entry + global CSS
│   │       ├── theme/           # design tokens consumed by Tailwind config
│   │       └── types/           # web-only types (most types come from @campusconnect/types)
│   │
│   └── mobile/                  # Expo React Native app
│       ├── assets/
│       └── src/
│           ├── app/             # entry + providers
│           ├── components/      # RN UI components
│           ├── navigation/      # React Navigation stacks/tabs + guards
│           ├── screens/         # screens (added per phase)
│           ├── hooks/
│           ├── lib/             # api/socket/securestore wrappers
│           ├── store/           # Redux store (shared slices where possible)
│           └── theme/           # NativeWind token bridge
│
├── server/                      # Express + TypeScript API
│   ├── src/
│   │   ├── config/              # env loading + typed config object
│   │   ├── loaders/             # startup wiring (db, express, sockets, jobs)
│   │   ├── controllers/         # thin HTTP handlers (orchestration only)
│   │   ├── middleware/          # auth, tenant, rate-limit, error, validation, upload
│   │   ├── models/              # Mongoose schemas/models (one file per model)
│   │   ├── routes/
│   │   │   └── v1/              # versioned route registration
│   │   ├── services/            # business rules, transactions (the "brains")
│   │   ├── repositories/        # data access; safe query construction
│   │   ├── validators/          # Zod schemas (re-export shared ones + server-only)
│   │   ├── policies/            # authorization policies (RBAC/ABAC rules)
│   │   ├── sockets/             # Socket.IO namespaces/handlers
│   │   ├── jobs/                # background/queue workers
│   │   ├── utils/               # logger, errors, envelope, ids, crypto wrappers
│   │   ├── db/                  # connection + index sync + seed entry
│   │   ├── types/               # server-only types
│   │   └── app.ts               # builds the Express app (no listen)
│   └── tests/
│       ├── unit/
│       └── integration/
│
├── packages/                    # shared, versionless internal packages
│   ├── types/                   # DTOs, enums (Role, Permission…), shared interfaces
│   ├── validation/              # Zod schemas shared by server + clients
│   ├── ui/                      # design tokens + framework-agnostic primitives
│   ├── config/                  # shared constants (route names, limits, regexes)
│   └── security/                # shared sanitizers, policy types, header helpers
│
├── infrastructure/
│   ├── docker/                  # per-service Dockerfiles (added when apps containerize)
│   ├── nginx/                   # reverse proxy config (headers, TLS, rate limit)
│   └── monitoring/              # prometheus/, grafana/ dashboards
│
├── docs/
│   ├── architecture/            # THIS is the source of truth
│   ├── api/                     # API conventions + domain endpoint maps
│   ├── security/                # threat model + controls
│   ├── database/                # data model + indexing strategy
│   ├── deployment/              # setup + deploy runbooks
│   ├── product/                 # phase plan, design system, roadmap
│   └── API_KEYS.md              # external service key matrix
│
├── scripts/                     # dev helpers (env check, seed, replica-set init)
├── tests/                       # cross-cutting suites
│   ├── integration/
│   ├── e2e/
│   └── security/
│
├── .github/workflows/           # CI (lint, typecheck, test, audit, container scan)
├── docker-compose.yml
├── .env.example
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc.json
└── package.json                 # npm workspaces root
```

## Boundary rules (enforced by convention + ESLint later)

- **Controllers never touch Mongoose.** They call services. Services call repositories.
  Repositories are the only layer that imports models.
- **Authorization lives in `policies/` + `middleware/`, never in controllers ad hoc.**
- **Shared contracts flow one direction:** `packages/*` → apps/server. Packages never
  import from apps or server.
- **No secret ever appears in `apps/*`.** Only `VITE_*` / `EXPO_PUBLIC_*` values reach clients.
- **One Mongoose model per file** in `server/src/models`, named `<Model>.model.ts`.
