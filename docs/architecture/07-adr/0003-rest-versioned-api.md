# ADR 0003: REST + versioning over GraphQL

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

The API is CRUD-heavy across many domains and must enforce strict per-request authorization and
tenant isolation. The team needs a model that is simple to secure and reason about.

## Decision

Expose a **versioned REST API under `/api/v1`**. Realtime concerns use **Socket.IO** alongside
REST. Responses use a consistent envelope with stable error codes.

## Consequences

- **Positive:** simple to secure (per-route middleware chains), cacheable, easy pagination,
  straightforward to document; versioning gives a clean deprecation path.
- **Negative / accepted:** clients may over-/under-fetch vs. GraphQL; mitigated with
  purpose-fit endpoints and RTK Query caching on the client.

## Alternatives considered

- **GraphQL:** flexible fetching, but per-field authorization, tenant scoping, query-cost limits,
  and N+1 avoidance add significant early complexity and risk for a security-critical platform.
  Rejected for the MVP; could be added as a gateway later if a real need emerges.
