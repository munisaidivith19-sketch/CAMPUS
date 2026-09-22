# CampusConnect — Web

React + TypeScript + Vite, Tailwind (design tokens from `@campusconnect/ui`), Redux Toolkit,
React Router, Axios, React Hook Form, Framer Motion, Lucide.

## Scripts

```bash
npm run dev -w apps/web        # Vite dev server on :5173
npm run build -w apps/web
npm run typecheck -w apps/web
```

## Phase 1 status

Skeleton only. A single glass foundation screen (`src/app/App.tsx`) verifies the design tokens
and build pipeline. **No dashboards, no auth screens, no features** — forbidden in Phase 1.
Scaffolded (empty) folders: `routes/`, `store/`, `features/`, `components/ui`,
`components/layout`, `hooks/`. Architecture: `../../docs/architecture/04-frontend-architecture.md`.

Config comes only from `VITE_*` env vars — no secrets ever reach the client bundle.
