# CampusConnect — Phase 3 Part C-3: Secure File Sharing (+ chat & announcement attachments)

You are continuing CampusConnect in this repo. Phases 1, 2, 3 Part A, B, C-1 and **C-2 (secure
chat)** are complete and committed (C-2 ends at `b524031` or later).

## AUTONOMY — READ FIRST

**Work straight through every step below without asking me for confirmation.** Do not stop to
ask "shall I continue?", "should I proceed?" or "which option do you prefer?" between steps.
When a choice comes up, pick the option most consistent with the frozen architecture and the
existing code, write it down, and keep going. Put every such decision in the final report under
"Decisions taken". Only stop early if:
- the Step 0 baseline is red, or
- an action would destroy data or rewrite history (dropping collections/volumes, `git reset
  --hard`, force-push) — don't do those at all, or
- the docs directly contradict this prompt in a way that changes the architecture.

Otherwise, finish the whole increment, then report and STOP.

## Read before writing

- `docs/architecture/00-overview.md`, `03-backend-architecture.md`, `06-multi-tenancy.md`
- `docs/database/DATABASE.md` — the **File** shape is frozen: institutionId, ownerUserId,
  storageKey, originalName, mime, size, checksum, scanStatus(pending/clean/infected),
  visibility, → linkedResource
- `docs/security/SECURITY.md` — upload pipeline: *auth → authorization → size → MIME →
  magic-byte/content → malware scan (ClamAV)*; uploads never execute; downloads always
  re-authorize; ZIP entry-count + decompression-ratio limits; generated storage keys (no path
  traversal)
- `docs/api/API.md` (`POST /files`, `GET /files/:id` planned), `docs/API_KEYS.md` (storage,
  ClamAV rows), `.env.example` (`STORAGE_DRIVER`, `STORAGE_LOCAL_ROOT`, `MAX_UPLOAD_BYTES`,
  `CLAMAV_*`)
- `server/src/services/chat.service.ts`, `policies/chatAccess.ts`, `announcement.service.ts`,
  `notificationDelivery.service.ts`, `deliveryQueue.ts`, `middleware/*`, `config/env.ts`
- `tests/test-count-floor.json`, `scripts/check-test-floor.mjs`

**Frozen:** MongoDB (Mongoose) is the only database — file *metadata* lives in Mongo, file
*bytes* go through the storage abstraction (local disk by default). Do **not** store file bytes
in MongoDB/GridFS, do not add S3 SDKs as a hard dependency, no new database, no new auth scheme.
Redis stays infrastructure only.

## Scope of THIS increment

File upload/download with the full security pipeline, a storage-provider abstraction, the scan
lifecycle, attachments for **chat messages** and **announcements**, web UI, tests, docs.

**Out of scope:** moderation-queue UI, per-role dashboards, Playwright E2E (all Part C-4),
mobile screens, the `npm start` packaging fix, E2EE, image thumbnails/transcoding, cloud storage
driver implementation (define the interface only), Phase 4 uses (complaint images etc.). Note
anything you find there under "Deferred".

---

## Step 0 — Baseline (must be green)

`npm install`, `npm run typecheck`, server + web lint, `npm test` → confirm **441** tests,
floor met, ≤7 skipped. Red baseline → stop and report.

## Step 1 — Types, permissions, validation, config

- `@campusconnect/types`: `FileScanStatus` (`PENDING`, `CLEAN`, `INFECTED`, `SCAN_FAILED`,
  `SKIPPED`), `FileVisibility` (`PRIVATE`, `LINKED`), `FileLinkType` (`CHAT_MESSAGE`,
  `ANNOUNCEMENT`), `FileDTO` (never exposes `storageKey` or checksum internals to clients
  beyond what's needed).
- Permissions with human descriptions: `file:upload`, `file:read` (download via a link you can
  see), `file:delete:self`. Grant least-privilege; justify grants in the commit message.
- Zod schemas for upload metadata, link, and download params.
- `config/env.ts`: validate `STORAGE_DRIVER` (`local` only implemented; others → fail fast
  with a clear "NOT CONFIGURED" error), `STORAGE_LOCAL_ROOT` (resolved absolute, created on
  boot, **outside** any web-served directory), `MAX_UPLOAD_BYTES` (default 25 MiB),
  `CLAMAV_ENABLED/HOST/PORT`, new `UPLOAD_ALLOWED_TYPES` allowlist, `ZIP_MAX_ENTRIES`,
  `ZIP_MAX_RATIO`, `ZIP_MAX_TOTAL_BYTES`, `FILE_DOWNLOAD_TOKEN_TTL_S` (default 300). Add all to
  `.env.example` + `docs/API_KEYS.md`.

## Step 2 — Storage abstraction

`server/src/infra/storage/`: `StorageProvider` interface (`put(stream) → {storageKey, size,
sha256}`, `getStream`, `delete`, `exists`) + `LocalDiskStorage`.
- Storage key = random (crypto) + tenant prefix, e.g. `<institutionId>/<yyyy>/<mm>/<random>`;
  **never** derived from the original filename. Resolve and verify every path stays inside the
  root (defense in depth against traversal even though keys are generated).
- Write to a temp file, hash while streaming, enforce the byte limit **while streaming** (abort
  and delete on overflow — don't buffer the whole file in memory), then atomic rename.
- Files written with non-executable permissions.

## Step 3 — Upload pipeline (`POST /files`, multipart)

Exact order, each step fail-closed with the stable error codes:
1. authenticate → 2. `file:upload` + per-user upload rate limit (existing Redis limiter,
   own prefix + `localKeys`, same fail-open policy) + per-user **quota** (config, default
   200 MiB total active files) →
3. size (`PAYLOAD_TOO_LARGE`) — enforced at the parser *and* while streaming →
4. declared MIME in allowlist (`UNSUPPORTED_MEDIA_TYPE`) →
5. **magic bytes** (`file-type` or equivalent established library) must match an allowed type
   and agree with the declared MIME; extension must agree too. Reject polyglots/mismatches.
   Allowlist to start: PDF, PNG, JPEG, WEBP, GIF, DOCX, XLSX, PPTX, TXT, CSV, ZIP. Explicitly
   reject HTML, SVG, JS, executables, and anything unknown. Note: DOCX/XLSX/PPTX are ZIP
   containers — apply the ZIP checks to them too.
6. ZIP-bomb defense: inspect the central directory without extracting to disk; enforce entry
   count, total uncompressed size and per-entry + overall compression ratio; reject nested
   archives and entries with `..` or absolute paths.
7. malware scan: if `CLAMAV_ENABLED=true`, stream to clamd (INSTREAM). `INFECTED` → delete
   bytes, keep the metadata row as `INFECTED`, audit it, return `MALWARE_DETECTED`. ClamAV
   unreachable → `SCAN_FAILED`, file is **not downloadable** (fail closed), and the user sees a
   clear status. If ClamAV is disabled → `SKIPPED`, which is downloadable in dev only and
   clearly labelled in the API/UI as "not scanned". Decide whether to scan inline or via the
   existing durable queue; if async, the file stays `PENDING` and undownloadable until clean.
8. persist `File` metadata (checksum, size, sanitized display name — strip control chars,
   path parts, and RTL-override characters; cap length).

Uploaded files start `PRIVATE` (only the owner can see them) until linked.

## Step 4 — Linking + authorization (`policies/fileAccess.ts`, unit-tested)

- `POST /chats/:id/messages` (and the socket `message:send`) now accept `attachmentFileIds`
  (max 5). Only your own, `CLEAN`/`SKIPPED`, not-yet-linked, same-tenant files can be linked.
  Remove the C-2 "reject attachmentRef" guard and replace it with this.
- `POST /announcements` accepts `attachmentFileIds` (max 10), same rules.
- **Access is inherited from the linked resource**: you can download a file iff you can read
  the chat message (active chat member) or the announcement (addressed to you) it is linked to,
  or you own it. Everything else → `NOT_FOUND` (never FORBIDDEN, no existence leak), including
  cross-tenant. Losing chat membership removes access to its attachments immediately.
- Deleting a chat message (sender or moderator) or its attachment removes the bytes and marks
  the metadata deleted; moderator deletes are audited. `DELETE /files/:id` for unlinked own files.
- Orphan cleanup: unlinked `PRIVATE` files older than 24 h are removed by a periodic job (reuse
  the existing worker pattern; must be multi-instance safe).

## Step 5 — Download (`GET /files/:id` + signed token)

- `GET /files/:id` re-authorizes, then either streams the file or returns a short-lived signed
  download URL (`/files/:id/content?token=…`, HMAC with a backend-only secret, bound to fileId +
  userId + institutionId + expiry, **single-use or very short TTL** — pick one and justify).
- Response headers on content: `Content-Disposition: attachment; filename*=UTF-8''<encoded>`
  (always attachment — never inline for untrusted types), correct `Content-Type` from the
  **stored verified type**, `X-Content-Type-Options: nosniff`, `Cache-Control: private,
  no-store`, a restrictive `Content-Security-Policy: sandbox`. Support `Range` only if trivial.
- Audit downloads of announcement attachments by non-owners? No — too noisy. Audit only
  uploads rejected as INFECTED, moderator deletes, and denied cross-tenant attempts.

## Step 6 — Realtime + notifications

- `message:new` payloads include attachment metadata (name, size, type, scan status) — never a
  download URL or storage key.
- Push/email for a message with attachments still carries **no body and no filenames**.

## Step 7 — Web UI

- Chat composer: attach button + drag-and-drop, client-side pre-check of size/type (UX only —
  server is the authority), upload progress, cancel, per-file error state; attachments shown as
  cards (icon, name, size, "not scanned"/"scanning"/"blocked" badges); download via the
  authorized endpoint.
- Announcement create form: attachments; announcement view: attachment list.
- Images: do **not** render uploaded images inline from the download endpoint in this increment
  (attachment cards only) — note inline preview as deferred.
- Loading / empty / error states mandatory; design tokens only; no `dangerouslySetInnerHTML`.

## Step 8 — Tests (raise the floor honestly)

At minimum:
- Pipeline: over-size (parser + streaming), disallowed MIME, **magic-byte mismatch** (PNG
  bytes named `.pdf`, HTML renamed `.png`, SVG, EXE), polyglot, ZIP bomb (ratio, entry count,
  nested archive, `..` entries), DOCX-as-zip bomb, filename sanitization (traversal, RTL
  override, control chars).
- ClamAV: EICAR test string → `INFECTED` + `MALWARE_DETECTED` + audit (unit with a mocked clamd;
  a live test gated on `TEST_CLAMAV_HOST` like the Redis-gated files, and raise `maxSkipped`
  only by that file's count, saying why); ClamAV down → `SCAN_FAILED`, not downloadable.
- Authorization: owner can, chat member can, ex-member can't, non-member → 404, other tenant →
  404, announcement not addressed to you → 404, linking someone else's file → refused,
  linking an INFECTED/PENDING file → refused, linking the same file twice → refused.
- Signed URL: expired, tampered, other user's token, other file's token, replay (if single-use).
- Headers: attachment disposition, nosniff, no-store, CSP sandbox on every content response.
- Quota + rate limit enforced; orphan cleanup deletes bytes + metadata and is safe with two
  workers.
- Storage: path stays inside root, temp file removed on abort.

Update `tests/test-count-floor.json`. **5 consecutive clean runs.** Typecheck, server lint, web
lint, web build, tsc build all clean. Seed and dev boot.

## Step 9 — Live verification (real MongoDB replica set + Redis + ClamAV via `docker compose --profile scan`)

Report actual output for:
1. Upload a PDF in a DM → recipient on the **other instance** gets `message:new` with the
   attachment card → downloads it; bytes match (sha256).
2. EICAR upload → blocked, audited, nothing left on disk.
3. HTML file renamed `.png` → rejected at magic-byte step.
4. ZIP bomb (e.g. 1 GB of zeros compressed) → rejected without ever extracting.
5. Remove the recipient from a GROUP → their download of the old attachment → 404.
6. Cross-tenant user with the fileId → 404; tampered / expired signed URL → refused.
7. ClamAV stopped → new upload `SCAN_FAILED`, not downloadable; restarted → new uploads scan.
8. Re-verify invariants: forgot-password 202 known/unknown, cross-tenant 404, attendance
   SUM/SUM, durable delivery (no duplicates), chat cross-instance delivery, revoked session
   disconnects socket.

## Step 10 — Docs

`docs/api/API.md` (files endpoints + attachment fields, mark implemented),
`docs/database/DATABASE.md` (File indexes actually created), `docs/security/SECURITY.md` (the
pipeline as implemented, signed-URL design, scan states, what "SKIPPED" means),
`docs/deployment/TESTING.md` (new gated suite, new floor), `docs/deployment/SETUP_WINDOWS.md`
(how to run ClamAV locally and the storage folder).

## Step 11 — Commits

Small conventional commits: types/config → storage → pipeline → policy + linking → download →
realtime/notifications → web → tests → docs. Each must typecheck. Don't commit `ck.md`,
`playground-1.mongodb.js`, `.claude/settings.local.json` or anything under the storage root;
add the storage root to `.gitignore`. **Do not push** — I push myself.

---

## Report (then STOP)

1. What was built, per step. 2. Upload pipeline as implemented (order + each check).
3. Authorization rules as implemented. 4. **Decisions taken** (every choice you made without
asking, with why). 5. Deviations from this prompt, with why. 6. Tests old → new, skipped count,
5-run result. 7. Live verification with real output. 8. Real bugs found by running things.
9. Commits (hash + message). 10. Deferred.

**Then STOP.** Part C-4 (moderation-queue UI, per-role dashboards, Playwright E2E — closes
Phase 3) starts only when I say `START PHASE 3 PART C-4`.