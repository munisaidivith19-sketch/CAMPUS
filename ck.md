START PHASE 2 — IDENTITY & SECURITY for CampusConnect.

This repo already has the Phase 1 foundation (monorepo, frozen architecture, config, design
tokens, Docker, docs). Build Phase 2 ONLY. Do NOT build Phase 3+ (no academics, attendance,
clubs, events, chat, or role dashboards beyond the security-dashboard foundation).

FIRST, read and obey these — they are the source of truth, do not contradict them:
- docs/architecture/00-overview.md, 03-backend-architecture.md, 06-multi-tenancy.md
- docs/architecture/07-adr/0004-argon2id-password-hashing.md
- docs/architecture/07-adr/0005-shared-db-multi-tenancy.md
- docs/architecture/07-adr/0006-jwt-session-model.md  (accept it now; implement exactly this)
- docs/database/DATABASE.md   (model shapes are frozen — match them)
- docs/api/API.md             (envelope, error codes, endpoint map)
- docs/security/SECURITY.md    (authz pipeline, threats, fail-closed rules)
- docs/product/PHASE_PLAN.md   (Phase 2 scope + prerequisites)

NON-NEGOTIABLE RULES (from the spec):
- Backend is the source of truth. Frontend authz is UX only, never trusted.
- Every protected request: identity → role → permission → tenant → resource ownership →
  business rule. FAIL CLOSED (default deny). Tenant mismatch returns NOT_FOUND (no existence leak).
- Argon2id for passwords. NEVER log passwords, OTPs, reset tokens, secrets, or session secrets.
- Institution email domain (COLLEGE_EMAIL_DOMAIN) enforced on the BACKEND.
- Established crypto only — no invented crypto. QR carries an opaque revocable token id, NEVER PII.
- Multi-tenant: every tenant-scoped query goes through the base repository with institutionId
  injected. Compound indexes lead with institutionId.
- Use the consistent response envelope + stable error codes already defined.
- Zod validation at the boundary using @campusconnect/validation (add schemas there, shared with clients).
- Synthetic data only in seeds. Never real PII.

BACKEND — build in server/src following the strict layering (route → middleware → controller →
service → repository → model), one Mongoose model per file as <Model>.model.ts:

1. MODELS (match docs/database/DATABASE.md shapes): Institution, Department, User, Role,
   Permission, Session, LoginHistory, PasswordReset, MFA, AuditLog, StudentProfile,
   FacultyProfile, StudentID, QRToken. Add the indexes the doc specifies (unique
   {institutionId,email}; TTL on Session.expiresAt, PasswordReset.expiresAt, QRToken.expiresAt).

2. RBAC as data: seed the 14 roles and a permission catalog; role→permission resolution cached
   in memory. A base repository that REQUIRES institutionId for tenant-scoped collections.

3. AUTH SERVICE + ROUTES (/api/v1):
   - register (institution-email enforced, Argon2id hash, email-verify token via Mailpit)
   - login (rate-limited, generic errors, records LoginHistory, triggers MFA/new-device when needed)
   - refresh (rotating refresh token bound to a Session record; reuse detection revokes the chain)
   - logout / logout-all
   - forgot-password + reset-password (short-lived single-use hashed token, generic responses,
     rate-limited, revoke sessions on reset, send security-notification email via Mailpit)
   - MFA: enroll + verify (TOTP via a maintained lib; OTP over email for new-device verification)
   - new-device verification gating refresh issuance

4. MIDDLEWARE: authenticate (verify access JWT → Principal), resolveTenant (from principal, never
   client), authorize (RBAC + resource ownership + ABAC hooks, fail-closed), validate (Zod),
   auth-route rate limiters. Wire into routes/v1.

5. IDENTITY ENDPOINTS: /me (get/patch), /me/sessions (list + revoke + revoke-others),
   /me/login-history, profiles (student/faculty), role management (SYSTEM_ADMIN only),
   /me/student-id (issue + fetch), QR issue/verify using QRToken (opaque, single-use, TTL, revocable).

6. AUDIT LOGGING: append-only AuditLog on register, login success/fail, password reset, session
   revocation, role changes, student-ID issue. Never logs secrets.

FRONTEND — apps/web (Phase 2 identity UI ONLY; NO role dashboards — those are Phase 3):
- Auth screens using the design system + glass tokens: login, register, forgot-password,
  reset-password, MFA/OTP verify, new-device verify.
- RTK Query auth api slice; axios refresh-on-401 interceptor in src/lib/api.ts.
- <RequireAuth> / <RequireRole> route guards (UX only) + a minimal authenticated shell.
- "My Devices" (sessions list + revoke) and a security-dashboard FOUNDATION (login history +
  active sessions), not full dashboards.
- Mobile (apps/mobile): wire Expo SecureStore for the refresh token + an auth API client and a
  login screen stub. Keep it minimal; full mobile screens come later.

SEEDS: extend server/src/db/seed.ts with SYNTHETIC data — 1 institution (domain jnn.edu.in),
a few departments, the 14 roles + permissions, and one user per key role (student, faculty,
class_mentor, hod, principal, system_admin) with known dev passwords printed to console (dev only).

TESTS (run before you call the phase done — this is required by the spec):
- Unit: auth service, password hashing, token rotation, policy/authz decisions.
- Integration (vitest + ephemeral Mongo + supertest against buildApp()): register/login/refresh/
  reset/MFA happy + failure paths.
- Security/authz: missing/invalid token rejected; IDOR/BOLA denied; CROSS-TENANT access returns
  NOT_FOUND; injection ($-operators/dotted keys) stripped; rate limits fire.
All tests green, npm run typecheck clean, npm run lint clean.

VERIFY: docker compose up -d must be running. Demonstrate register → verify → login → refresh →
forgot/reset (check the email in Mailpit at http://localhost:8025) → session revoke, all via curl
or tests. Update docs ONLY where Phase 2 adds detail (e.g. mark ADR-0006 Accepted, add the
implemented auth endpoints in docs/api). Do NOT rewrite architecture.

WORKING RULES:
- Give me COMPLETE files when you show code, not diffs.
- Do not hide errors or fake success responses. Mark any unavailable integration NOT CONFIGURED.
- Commit in logical chunks with conventional commits (feat(auth): …, security(api): …) IF the
  repo has git initialized; otherwise just leave the working tree clean and tell me.

When Phase 2 is implemented, tested green, and verified: STOP and report (what was built, test
results, how to try it). Do NOT start Phase 3. Wait for me to say START PHASE 3.