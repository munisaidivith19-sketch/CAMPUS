# ADR 0005: Shared-DB multi-tenancy with a mandatory tenant key

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

The platform is multi-tenant (many institutions) and cross-tenant access must be impossible. The
prototype must stay ₹0 and operationally simple, while keeping a clean path to stronger isolation
later.

## Decision

Use a **single MongoDB database** with a **mandatory, indexed `institutionId` on every
tenant-scoped collection**. Isolation is enforced in application code: tenant resolution
middleware binds the tenant from the authenticated principal; the base repository injects
`institutionId` into every query/insert; compound indexes lead with `institutionId`; the
authorization layer rejects `TENANT_MISMATCH` fail-closed; security tests attempt cross-tenant
access and expect `NOT_FOUND`.

## Consequences

- **Positive:** simple, cheap, testable; enforcement centralized where it can't be forgotten;
  performant (tenant-leading indexes).
- **Negative / accepted:** logical (not physical) isolation. Mitigated by centralized
  enforcement + targeted security tests. A future ADR can migrate hot/large tenants to dedicated
  databases or clusters **without changing the application's tenant contract**.

## Alternatives considered

- **Database-per-tenant:** strongest isolation, but heavy to operate and provision for a
  prototype and small deployments. Deferred as a future scaling option, not a rebuild.
- **Collection-per-tenant:** explodes collection/index counts; rejected.
