# ADR 0002: npm workspaces monorepo

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Server, web, and mobile must share types and validation schemas to prevent contract drift. We
need hoisted installs and cross-package imports. The team is small/student-scale and the local
prototype must stay understandable.

## Decision

Use a **single monorepo managed by npm workspaces**. Shared code lives in `packages/*`
(`types`, `validation`, `ui`, `config`, `security`) and is imported by `server` and `apps/*`
via `@campusconnect/*` path aliases.

## Consequences

- **Positive:** one source of truth for DTOs and Zod schemas; atomic cross-cutting changes;
  zero extra tooling, no daemon, nothing new to learn; standard `npm install` at the root.
- **Negative / accepted:** no build caching or task graph out of the box. Acceptable at current
  scale; Turborepo can be layered on later without moving files (future ADR) if build times grow.

## Alternatives considered

- **Turborepo / Nx:** better caching and task orchestration, but added complexity not justified
  yet. **pnpm workspaces:** excellent, but npm is already universal and sufficient. Both remain
  available as future migrations.
