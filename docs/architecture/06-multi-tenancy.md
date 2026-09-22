# Multi-Tenancy Architecture

CampusConnect serves multiple institutions from one platform. **Cross-tenant data access must
never be possible.** This document defines how that guarantee is achieved.

## Tenant model

```text
Platform
  └── Institution (the tenant)
        ├── Departments
        ├── Users (all roles)
        ├── Clubs / Events / Announcements / …
        └── all other tenant-scoped resources
```

The **Institution `_id` is the tenant key.** Every tenant-scoped document carries an indexed
`institutionId` field. A small number of documents are platform-global (e.g. the `Institution`
registry itself, platform `SponsoredEvent` catalog) and are explicitly marked as such.

## Isolation strategy: shared database, enforced tenant key

For the prototype we use a **single MongoDB database with a mandatory `institutionId` discriminator**
on tenant-scoped collections — not a database-per-tenant. Rationale:

- Simple, ₹0, and operationally trivial for a prototype and small deployments.
- Enforcement is centralized in code (below), which is auditable and testable.
- Migrating hot tenants to dedicated databases/clusters later is possible without changing the
  application's tenant *contract* (recorded as a future ADR if needed).

The trade-off — isolation is enforced by application logic rather than physical separation — is
mitigated by making the enforcement impossible to forget (see next section) and by security tests
that specifically attempt cross-tenant access.

## Enforcement (defense in depth)

1. **Tenant resolution middleware** binds `req.tenantId` from the authenticated principal (a
   user belongs to exactly one institution; platform admins operate within an explicitly chosen
   institution context). Clients cannot set the tenant via header/body.
2. **Tenant-scoped repositories require `institutionId`.** There is no repository method that
   queries a tenant-scoped collection without it. The base repository injects
   `{ institutionId }` into every `find`/`update`/`delete` filter and every insert.
3. **Compound indexes lead with `institutionId`** so scoping is also the performant path.
4. **Authorization layer** re-checks that the target resource's `institutionId` equals the
   principal's tenant before any resource-level permission is evaluated (`TENANT_MISMATCH` →
   fail closed).
5. **Security tests** (in `tests/security`) assert that a user of tenant A receives `NOT_FOUND`
   (not `FORBIDDEN`, to avoid existence leaks) for tenant B resources across representative
   endpoints.

## Institution configuration

Each institution carries its own branding (logo, colors), department set, storage quota,
subscription plan reference, admin users, and custom-domain readiness. These are modeled now
(see `docs/database/DATABASE.md`) and consumed starting in later phases; Phase 1 only freezes
the shape.

## What Phase 1 fixes vs. defers

- **Fixed now:** tenant key = `institutionId`; shared-DB-with-discriminator strategy; the
  "repositories require tenant" rule; index-leading-tenant rule; fail-closed tenant checks.
- **Deferred:** per-tenant database migration path, custom-domain routing, subscription
  metering — all Phase 5, and all expressible without breaking the tenant contract above.
