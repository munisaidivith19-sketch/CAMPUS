# Security Architecture

Security is continuous, not a feature. This document freezes the threat model and the controls.
Phase 1 establishes the model and the shared building blocks (`packages/security`, middleware
contracts); enforcement code lands with the features it protects, starting Phase 2.

> The system is never described as "100% secure." Controls reduce risk; defense in depth assumes
> any single control can fail.

## 1. Core principles

1. Backend is the source of truth. 2. Frontend is never trusted. 3. Authorization is always
server-side. 4. AI cannot bypass authorization. 5. Tenant isolation is mandatory. 6. Least
privilege. 7. Sensitive data protected by default. 8. Admin actions are auditable. 9. Established
cryptography only; never invent crypto. 10. Fail closed for authorization.

## 2. Defense in depth (layers)

```text
Internet → HTTPS/TLS → CDN/WAF/DDoS → reverse proxy → rate limiting
 → authentication → MFA → RBAC/ABAC → input validation → business rules
 → database → audit logging → monitoring → incident response
```

Each layer is independent; a bypass of one is still caught by the next where feasible.

## 3. Authentication (Phase 2)

- **Institution email enforced server-side** (`COLLEGE_EMAIL_DOMAIN`). Frontend checks are UX only.
- Passwords hashed with **Argon2id** (ADR-0004); strength + reuse controls; never stored/logged in plaintext.
- **MFA/OTP** and **new-device verification**; **WebAuthn/passkeys** designed-for (established library).
- **Sessions** are server-side records (ADR-0006) enabling listing + revocation; access token short-lived, refresh rotated with reuse detection.
- **Forgot password:** short-lived, single-use, rate-limited, hashed reset token; **generic
  responses** to prevent account enumeration; security notification after reset; appropriate
  session revocation. Dev email via **Mailpit**.
- **Login history + suspicious-login detection**; new-device alerts.

## 4. Authorization (every protected request)

```text
identity → role → permission → tenant → resource ownership/access → business rule
```

- **RBAC** with `Role`/`Permission` as data (14 roles; extensible). **Resource-level checks**
  (BOLA/IDOR defense): owning/allowed relationship verified before action. **ABAC conditions**
  where needed (e.g. faculty ↔ assigned class; mentor ↔ section; HOD ↔ department).
- **Tenant check** precedes resource permission; cross-tenant → `TENANT_MISMATCH`, and existence
  is not leaked (`NOT_FOUND` to the caller). See `docs/architecture/06-multi-tenancy.md`.
- **Fail closed:** missing/ambiguous policy = deny. Authorization lives in `policies/` +
  `middleware/`, never ad hoc in controllers, and is unit-tested.
- Protects against: broken access control, privilege escalation, IDOR/BOLA, cross-tenant access.

## 5. Threats & controls matrix

| Threat | Control |
| ------ | ------- |
| XSS | Output encoding, React auto-escaping, CSP, no `dangerouslySetInnerHTML` on untrusted data, sanitize rich text |
| NoSQL injection | Zod at boundary; operator/`$`-key stripping; allowlisted query fields; parameterized Mongoose queries; never spread user input into filters/updates |
| CSRF | Bearer tokens for API; for cookie-based refresh, SameSite + CSRF token on state-changing cookie routes |
| Brute force / credential stuffing | Strict rate limits on auth routes (Redis-backed, see below), lockout/backoff, MFA, generic errors |
| Session hijacking | Short-lived access tokens, refresh rotation + reuse detection, Secure/httpOnly cookies (web), SecureStore (mobile), device binding signals |
| Broken auth/z | Central policy layer, fail-closed, authorization tests |
| API abuse / DoS | Rate limits, request size limits, pagination caps, timeouts, connection/WS limits |
| Malicious uploads / ZIP bombs | Size + MIME + magic-byte checks, ClamAV scan, archive entry/ratio limits, random non-executable storage, signed authorized downloads |
| SSRF | Outbound allowlist for provider calls; no user-controlled URLs fetched server-side without validation |
| Open redirects / clickjacking | Redirect allowlist; `X-Frame-Options`/`frame-ancestors` |
| Secret leakage | Secrets in `.env` only, never committed, never in client bundles; secret scanning in CI |
| Prompt injection / AI data leakage | AI inherits caller authorization; tool allowlists; input/output filtering; context isolation (see §9) |
| Dependency vulns | `npm audit`, Dependabot, Trivy, Semgrep in CI |

### Rate limiting: store and degradation policy

Counters live in Redis (`REDIS_URL`) so a limit holds across processes and instances; without it
each instance counts alone, which multiplies every limit by the instance count. **A multi-instance
deployment must set `REDIS_URL`.**

If Redis is unreachable the limiters **fail open**: the request is not rejected, it is counted by
the in-process store instead, and a warning is logged (throttled to one per minute). This is a
deliberate exception to the fail-closed rule in §3, which governs *authorization* — an ambiguous
policy decision must deny. Rate limiting is an availability control that grants nothing, so
failing closed would convert a Redis blip into a campus-wide login outage and would hand anyone
who can disrupt Redis a denial-of-service against every user. The degraded mode still enforces the
same limit per instance, and the account-protecting controls (Argon2id, the per-challenge OTP
attempt cap, per-user reset throttling, generic responses, MFA) do not depend on Redis at all.

## 6. Web & API hardening

- **Helmet** with a strict **CSP**, **HSTS**, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, frame protection.
- **CORS allowlist** (explicit origins; no wildcard in prod).
- Request body size limits, JSON parse limits, per-route timeouts.
- Consistent error envelope; **no stack traces/secrets/DB internals** in responses.

## 7. File security pipeline

```text
auth → authorization → size check → MIME check → magic-byte/content check → malware scan (ClamAV)
     → random-name non-executable storage → audit → authorized/signed download only
```

Uploads never execute; downloads always re-authorize. ZIP handling enforces entry count and
decompression-ratio limits (ZIP-bomb defense). Path traversal is impossible (generated storage keys).

## 8. Audit logging

Append-only `AuditLog` for sensitive/admin/state-changing actions: actor, tenant, action,
resource, result, IP/device context, reason, timestamp. **Never logs** passwords, OTPs, reset
tokens, private keys, session secrets, or E2EE plaintext.

## 9. AI security (Phase 5, designed now)

- AI **inherits the caller's authorization** — it can access exactly what the caller could via
  the normal API, no more. It never makes authorization, attendance, eligibility, security, or
  approval decisions itself (those stay deterministic server logic).
- Tool allowlists, per-tool permission checks, input/output validation, sensitive-data filtering,
  context isolation, rate limits, audit logs.
- Behavior monitoring with **circuit breakers**: on suspicious behavior, stop the action, block
  further tool execution, preserve logs, raise a security incident, alert an admin, require
  controlled recovery. **No uncontrolled "AI self-destruct."**

## 10. Cryptography & data protection

Established libraries only (Argon2id, JWT, WebAuthn lib, TLS). **Never invent cryptographic
algorithms.** E2EE for protected private/group chat uses an audited protocol/library. QR codes
carry opaque revocable token ids — **never PII**. Optional data-integrity module may use record
hashes/certificates; **no sensitive student data on any public blockchain**, and no blockchain for
marketing's sake.

## 11. Privacy by design

Role-scoped visibility; users see only what their role needs. Especially protected: medical data,
student records, attendance, private messages, career profiles, contact info, SOS data, anonymous
feedback (anonymity protected from ordinary admins), security logs. Synthetic data only in
development; never real student PII (also a git rule).

## 12. Security tooling in CI

`npm audit` (high+), Semgrep (SAST), Trivy (container/deps), secret scanning, Dependabot. CI fails
on high-severity findings. See `.github/workflows/ci.yml`.
