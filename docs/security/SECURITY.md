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

| Threat                             | Control                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS                                | Output encoding, React auto-escaping, CSP, no `dangerouslySetInnerHTML` on untrusted data, sanitize rich text                                       |
| NoSQL injection                    | Zod at boundary; operator/`$`-key stripping; allowlisted query fields; parameterized Mongoose queries; never spread user input into filters/updates |
| CSRF                               | Bearer tokens for API; for cookie-based refresh, SameSite + CSRF token on state-changing cookie routes                                              |
| Brute force / credential stuffing  | Strict rate limits on auth routes (Redis-backed, see below), lockout/backoff, MFA, generic errors                                                   |
| Session hijacking                  | Short-lived access tokens, refresh rotation + reuse detection, Secure/httpOnly cookies (web), SecureStore (mobile), device binding signals          |
| Broken auth/z                      | Central policy layer, fail-closed, authorization tests                                                                                              |
| API abuse / DoS                    | Rate limits, request size limits, pagination caps, timeouts, connection/WS limits                                                                   |
| Malicious uploads / ZIP bombs      | Size + MIME + magic-byte checks, ClamAV scan, archive entry/ratio limits, random non-executable storage, signed authorized downloads                |
| SSRF                               | Outbound allowlist for provider calls; no user-controlled URLs fetched server-side without validation                                               |
| Open redirects / clickjacking      | Redirect allowlist; `X-Frame-Options`/`frame-ancestors`                                                                                             |
| Secret leakage                     | Secrets in `.env` only, never committed, never in client bundles; secret scanning in CI                                                             |
| Prompt injection / AI data leakage | AI inherits caller authorization; tool allowlists; input/output filtering; context isolation (see §9)                                               |
| Dependency vulns                   | `npm audit`, Dependabot, Trivy, Semgrep in CI                                                                                                       |

### Chat: threat model, and what "secure" does and does not mean here

**Chat is NOT end-to-end encrypted.** Messages are stored server-side in plain text, because the
institution has to be able to moderate them. Nothing in the product is labelled E2EE, and the UI
says so on the page. What chat _does_ guarantee:

- **TLS in transit**, for both HTTP and the WebSocket.
- **Membership is the grant.** An active `ChatMembership` row is the only thing that opens a
  conversation. Holding `chat:read` — or every permission in the catalog — shows a caller nothing
  they are not a member of, and a refusal is always `NOT_FOUND`, so a chat id cannot be probed.
- **Derived membership follows its source.** CLASS and CLUB chats are re-synced from the roster
  and the club's approved members, on change and on access, so losing the underlying membership
  revokes the conversation on the next request.
- **No bodies outside the chat.** Not in logs, not in push or email (an offline notification says
  only "New message in <chat>"), and not in audit entries — a moderator removal records the
  message id and the chat, never the text.
- **Deletion removes the text.** A soft-deleted message keeps its place so replies still read,
  and returns no body to anyone, including its sender and a moderator.
- **The socket is not a looser door.** Same identity resolution as HTTP plus a session-liveness
  check, same Zod schemas, same CORS allowlist, rooms named by the server, per-connection event
  limits, and a per-user Redis-backed send limit shared with the REST path.
- **Plain text out.** The web client renders bodies as text; `dangerouslySetInnerHTML` is not used
  in the chat feature.

Residual risks, stated plainly: an institution administrator with database access can read
messages; presence is best-effort and per-instance; chat messages are deliberately **not** in
`/search`; and reports on direct messages and private groups are recorded but never actionable
and never shown to a moderator.

**Future work:** E2EE for protected DMs and groups, using established libraries only, with the
moderation consequences designed for rather than discovered.

### Rate limiting: store and degradation policy

Counters live in Redis (`REDIS_URL`) so a limit holds across processes and instances; without it
each instance counts alone, which multiplies every limit by the instance count. **A multi-instance
deployment must set `REDIS_URL`.**

If Redis is unreachable the limiters **fail open**: the request is not rejected, it is counted by
the in-process store instead, and a warning is logged (throttled to one per minute). This is a
deliberate exception to the fail-closed rule in §3, which governs _authorization_ — an ambiguous
policy decision must deny. Rate limiting is an availability control that grants nothing, so
failing closed would convert a Redis blip into a campus-wide login outage and would hand anyone
who can disrupt Redis a denial-of-service against every user. The degraded mode still enforces the
same limit per instance, and the account-protecting controls (Argon2id, the per-challenge OTP
attempt cap, per-user reset throttling, generic responses, MFA) do not depend on Redis at all.

### Moderation: who sees what

- Reports are **routed by where the content lives**, not only by permission. Community content
  goes to `moderation:review` holders. Class chats go to that section's mentor, the HOD and the
  principal. Club chats go to that club's admins and the principal. A moderator without a backing
  assignment reaches nothing extra. Out of scope is `NOT_FOUND`.
- **Private conversations are not opened up.** DM and private-group reports are recorded. Only
  institution-wide moderators see that they exist, with no preview and no action.
- **Reporter anonymity:** names are shown only to `audit:read` holders, so a mentor reviewing
  their class chat does not learn which student reported.
- **Previews are plain text**, control/bidi characters stripped, 280 characters max, rendered by
  React. Removal needs a stated reason. Removals are soft (body removed, attachments deleted)
  and audited without the content.
- **One report per person per item:** repeat reports can't inflate the ranking, and a dismissed
  report can't be reopened by the same person.

## 6. Web & API hardening

- **Helmet** with a strict **CSP**, **HSTS**, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, frame protection.
- **CORS allowlist** (explicit origins; no wildcard in prod).
- Request body size limits, JSON parse limits, per-route timeouts.
- Consistent error envelope; **no stack traces/secrets/DB internals** in responses.

## 7. File security pipeline (implemented, Phase 3 Part C-3)

```text
auth → file:upload → per-user rate limit → quota → size (Content-Length, then while streaming)
     → extension + declared MIME allowlisted → magic bytes agree → text/markup/polyglot checks
     → ZIP/Office central-directory limits → ClamAV INSTREAM → metadata row → audit
download: re-authorize → short-lived HMAC URL (file+user+tenant+expiry) → re-authorize again
          on use → attachment + verified type + nosniff + CSP sandbox + no-store
```

| Threat                                               | Control                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oversized upload / disk exhaustion                   | `MAX_UPLOAD_BYTES` checked from `Content-Length` **and** enforced while streaming (busboy limit + a metered writer that aborts and deletes the temp file); per-user quota across live files; per-user upload rate limit (own Redis prefix, same fail-open policy).               |
| Type confusion (HTML-as-PNG, EXE-as-PDF, SVG)        | Allowlist by extension + declared MIME; magic bytes read by `file-type` must name the same type; SVG, HTML, JS and executables are not on the list and fail the magic check even when renamed.                                                                                   |
| Polyglots                                            | Markup markers (`<script`, `<html`, `<svg`, `<iframe`, …) refused anywhere in images, PDFs and text; a ZIP end-of-central-directory record trailing a non-ZIP file is refused.                                                                                                   |
| ZIP bombs (incl. DOCX/XLSX/PPTX bombs)               | Central directory only, never extracted: entry count, total uncompressed size, per-entry and overall compression ratio, nested archives, absolute and `..` entry paths.                                                                                                          |
| Malware                                              | ClamAV `INSTREAM`. Infected: bytes destroyed, row kept as `INFECTED`, audited, `MALWARE_DETECTED`. Scanner unreachable: `SCAN_FAILED` — held, not attachable, not downloadable ("could not check" is not "clean").                                                               |
| Path traversal / executable storage                  | Keys are 256-bit random with a tenant prefix and a strict pattern, and the resolved path must stay inside the root; files are written `0o600` via temp file + atomic rename; the root is outside anything served.                                                                |
| Filename tricks (RTL override, control chars, `../`) | Display names sanitized; `Content-Disposition` built with an ASCII fallback and RFC 5987 `filename*`.                                                                                                                                                                            |
| Unauthorized access / IDOR / cross-tenant            | No per-file ACL: `PRIVATE` → owner only; `LINKED` → whoever the linked resource's own read rule admits, evaluated at read time. Every miss is `NOT_FOUND`. Attaching requires owning a live, unattached, scan-passed file, claimed with one conditional update (all or nothing). |
| Leaked / replayed download link                      | Links live 300 s, bind file + user + tenant (HMAC-SHA256, constant-time compare), and the content endpoint re-authorizes the bound user at use time — removal from the chat or suspension kills an unexpired link.                                                               |
| Browser rendering a download                         | `Content-Disposition: attachment`, verified `Content-Type`, `nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`. The web client never renders file content inline.                                                                                 |
| Orphans                                              | Unattached files are removed after `FILE_ORPHAN_TTL_HOURS` by a job that claims each file with a conditional update, so concurrent instances never double-delete.                                                                                                                |

Residual risks, stated plainly: without ClamAV enabled, files are **not scanned** (development
only, and labelled so; in production such files are not downloadable). Two simultaneous uploads
by one user can overshoot the quota by at most one file. Signature-based scanning does not catch
novel malware. `FILE_SIGNING_SECRET` must be set (and identical) on every instance in production.

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
