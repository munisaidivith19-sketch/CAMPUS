# Testing Strategy

Testing is layered so each layer catches what it is cheapest to catch. Tests are written
**with** each feature (starting Phase 2), and security/authorization tests are first-class, not
an afterthought. Phase 1 ships the strategy and the test scaffolding (folders + runner config);
there is no feature code to test yet.

## Layers & tools

| Layer | Scope | Where | Tool |
| ----- | ----- | ----- | ---- |
| **Unit** | Pure services, policies, validators, utils (no I/O) | `server/tests/unit`, package tests | Vitest |
| **Integration** | API routes end-to-end against an ephemeral MongoDB | `server/tests/integration`, `tests/integration` | Vitest + `mongodb-memory-server` / disposable container + supertest |
| **API contract** | Request/response envelope + Zod schemas hold | integration suite | Vitest + Zod |
| **Authorization** | RBAC, resource ownership, tenant isolation | `tests/security` | Vitest (dedicated suites) |
| **Security** | Cross-tenant access, IDOR/BOLA, injection, upload rules | `tests/security` | Vitest + targeted probes |
| **E2E** | Critical user journeys in a browser | `tests/e2e` | Playwright (added Phase 3) |

`app.ts` builds the Express app without listening, so integration tests import it directly and
run against a throwaway database — no external services needed.

## What gets tested (per the build spec)

Authentication, MFA, password reset, session revocation, RBAC, **tenant isolation**, attendance
math + correction, gate passes, file uploads (size/MIME/magic-byte/scan), chat permissions,
career permissions, job matching (deterministic), admin operations, and **AI authorization**
(the assistant can never access what the caller couldn't).

## Key security-test assertions

- A user of tenant A gets `NOT_FOUND` (not `FORBIDDEN`) for tenant B resources — no existence leak.
- Every protected route rejects missing/invalid tokens with `AUTH_REQUIRED`/`AUTH_INVALID`.
- Manipulated resource ids (IDOR/BOLA) are denied by resource-ownership checks.
- Injection payloads (`$`-operators, dotted keys) are stripped/rejected.
- Uploads that fail size/MIME/magic-byte/scan are rejected with the right code.

## Quality gates (before any phase is "done")

TypeScript clean, lint clean, format clean, tests green, Docker services healthy, no high-severity
`npm audit`/Semgrep/Trivy findings, docs updated. Errors are never hidden and fake success
responses are never used to make a feature look complete; unavailable integrations are marked
`NOT CONFIGURED`.
