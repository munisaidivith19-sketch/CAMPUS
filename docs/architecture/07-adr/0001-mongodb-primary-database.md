# ADR 0001: MongoDB as the sole primary database

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

The domain is document-shaped and evolves quickly: profiles, posts, events, chat messages,
notifications, career profiles, per-tenant configuration. The platform is multi-tenant and must
run at ₹0 locally. The build rules mandate MongoDB and explicitly forbid introducing a SQL store
without an approved architectural review.

## Decision

Use **MongoDB as the single primary application datastore**, accessed through **Mongoose**. Run
it as a **single-node replica set** even in local development so multi-document **transactions**
are available. Redis is used only as infrastructure (rate limiting, cache, queues), never as a
primary store.

## Consequences

- **Positive:** flexible schema for a fast-moving domain; native fit for embedded sub-documents
  (e.g. an event's registration summary); aggregation pipelines for analytics; one datastore to
  operate; transactions available for critical workflows.
- **Negative / accepted:** referential integrity and complex relational joins are the
  application's responsibility; we mitigate with careful modeling (see `docs/database`), Mongoose
  validation, and services that maintain invariants inside transactions.
- Multi-tenancy is enforced in application code via a mandatory tenant key (see ADR-0005), not by
  physical DB separation.

## Alternatives considered

- **PostgreSQL / MySQL:** strong relational guarantees, but rejected per project mandate and
  because the domain's flexibility and per-tenant variability favor documents at this stage.
- **Prisma with Mongo:** weaker support for Mongo-specific features (aggregations, some index
  types) than Mongoose. Rejected.
