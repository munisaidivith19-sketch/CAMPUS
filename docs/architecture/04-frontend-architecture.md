# Web Frontend Architecture

## Shape

Feature-sliced React SPA built with Vite. Global concerns (store, router, theme, providers)
live in `src/app`; each product capability is a self-contained slice under `src/features`
(added phase by phase). Design-system primitives live in `src/components/ui` and are the only
components allowed to define raw visual styling; everything else composes them.

```text
src/
├── app/           # <App>, providers (store, router, theme, toast), error boundary
├── routes/        # route tree + <RequireAuth>/<RequireRole> guards
├── store/         # configureStore + RTK Query `api` slice (per-domain endpoints)
├── features/      # e.g. features/auth, features/attendance (later phases)
├── components/ui/ # Button, Card, Input, Modal, Toast, Skeleton, Table… (tokens only)
├── components/layout/ # AppShell, Sidebar, Topbar, role-aware nav
├── hooks/         # useAuth, usePermission, useDebounce…
├── lib/           # axios instance (+ auth refresh interceptor), socket client
├── theme/         # tokens.ts bridged into tailwind.config
└── styles/        # tailwind entry + globals
```

## State & data fetching

- **Server state** → RTK Query. One `api` slice per domain, auto-caching, tags for
  invalidation. Components never call axios directly for CRUD.
- **Client/UI state** → Redux Toolkit slices (auth session, theme, transient UI) and local
  component state for the rest. No global state for things that are truly local.
- **Auth tokens**: access token in memory; refresh handled by an axios interceptor that calls
  the refresh endpoint on 401 and retries once. (Refresh token storage strategy — httpOnly
  cookie vs. secure store — is finalized in Phase 2's auth ADR.)

## Routing & guards

React Router with a declarative route tree. `<RequireAuth>` gates authenticated areas;
`<RequireRole roles={[...]}>` gates role-specific dashboards. **Guards are UX only** — they
hide/redirect, they do not secure anything. Every action still calls an API that re-checks
authorization server-side. This is stated explicitly so no one mistakes a route guard for a
security control.

## Design system integration

Tokens (color, spacing, radius, blur, shadow, typography) are defined once in
`packages/ui` and `src/theme/tokens.ts`, consumed by `tailwind.config`. The glassmorphism/
liquid-UI language is expressed through token-driven utilities and a small set of `ui`
primitives, never ad-hoc inline styles. Framer Motion handles transitions and respects
`prefers-reduced-motion`. Accessibility (focus states, semantic HTML, contrast, labels) is a
requirement of every `ui` primitive, not an afterthought.

## Loading / empty / error states

Every data-driven view must implement all three: skeletons while loading, a designed empty
state, and a friendly error state that reads the API error `code`. These are first-class
components in `components/ui`.

## Performance

Route-level code splitting, RTK Query caching, list virtualization for large tables, and
pagination on every list endpoint. Optimize only when measurement shows a need.
