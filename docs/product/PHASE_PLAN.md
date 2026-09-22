# Phase Plan & Controls

The project is built in **5 controlled phases**. Each phase completes, is reviewed, and **stops**
until the explicit instruction to start the next. Architecture is never rebuilt between phases
(the source of truth is `docs/architecture/`); a conflicting requirement follows the change
process in `docs/architecture/00-overview.md`.

## Phase gate rule

After finishing a phase, do not automatically continue. Wait for the exact instruction
(`START PHASE 2`, etc.). This is deliberate: it keeps each layer solid before the next depends
on it.

## Phase 1 — Foundation ✅ (this deliverable)

Architecture, monorepo, environment, database design, API design, security architecture,
UI/UX design system, Docker, documentation, configuration. **No features implemented.**
Detailed report: `PHASE_1_REPORT.md`.

## Phase 2 — Identity & Security 🔒 (next, on approval)

Authentication (institution-email enforced), registration, login, forgot/reset password, MFA/OTP,
new-device verification, sessions + "My Devices" + revocation, login history, suspicious-login
alerts, RBAC + resource authorization, user/student/faculty profiles, role management, Digital
Student ID + secure QR, audit logging, security-dashboard foundation. Tests run before completion.

**Prerequisites (all satisfied by Phase 1):** env config + secrets contract, `User`/`Session`/
`MFA`/`LoginHistory`/`PasswordReset`/`AuditLog`/`Role`/`Permission`/`StudentID`/`QRToken` model
shapes, the request pipeline + error envelope, shared Zod validation + types, Argon2id decision
(ADR-0004), session model (ADR-0006), Mailpit for reset emails, rate-limit + Helmet + CORS baseline.

## Phase 3 — Core Campus Platform

Academics, subjects, classes, timetable, attendance + correction workflow, announcements, clubs +
membership, events + registration, discussions, notifications, secure chat, file sharing, search,
moderation, and the student/faculty/mentor/HOD/principal-foundation dashboards. Integration + E2E
tests.

## Phase 4 — Campus Operations & Career

Gate pass + campus in/out + security dashboard, hostel (leave/outing), mess, medical, emergency +
SOS, the reusable digital permission engine, complaints, anonymous feedback, campus map, lost &
found, achievements, job/internship portals, career profile + target role + skill gap + roadmap +
matching, resume/project/certification guidance, interview prep, placement, company/recruiter
portals, alumni. Full integration tests.

## Phase 5 — Advanced Platform

AI campus + career assistants (provider abstraction), Industry Expectations Engine, advanced
analytics, institution SaaS multi-tenancy + branding + storage + subscriptions, company
partnerships + sponsored events, AI security monitoring + circuit breakers, advanced audit
monitoring, data integrity (optional blockchain verification), production hardening, CI/CD,
deployment, observability, backup/restore, disaster recovery. Complete test suite.

## Cross-phase invariants (never violated)

Backend is source of truth; frontend never trusted; authorization always server-side and
fail-closed; AI never bypasses authorization; tenant isolation mandatory; least privilege;
established crypto only; APIs versioned; providers replaceable; ₹0 local dev; synthetic data
only; no silent architecture changes; never claim "100% secure."
