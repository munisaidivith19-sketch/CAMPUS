# Build progress — Phase 3 completion + Phase 4

This ledger is the working memory for the Phase 3 completion + Phase 4 build. A milestone is ✅
only when its definition of done holds **and** its commits exist on `main`.

| #   | Milestone                                                   | Status | Commits       | Tests after     |
| --- | ----------------------------------------------------------- | ------ | ------------- | --------------- |
| M0  | Baseline + progress ledger                                  | ✅     | dbb6a70       | 441 (7 skipped) |
| M1  | Fix `npm start` / real package builds                       | ✅     | de869c6       | 441 (7 skipped) |
| M2  | Secure file sharing (+ chat & announcement attachments)     | ✅     | (see git log) | 520 (9 skipped) |
| M3  | Moderation queue UI + chat reports + leave club             | ✅     | (see git log) | 547 (9 skipped) |
| M4  | Phase 3 role dashboards                                     | ✅     | (see git log) | 559 (9 skipped) |
| M5  | Playwright E2E                                              | ⬜     |               |                 |
| M6  | Close Phase 3                                               | ⬜     |               |                 |
| M7  | Digital Permission Engine                                   | ⬜     |               |                 |
| M8  | Gate pass, campus in/out, security dashboard                | ⬜     |               |                 |
| M9  | Hostel                                                      | ⬜     |               |                 |
| M10 | Mess                                                        | ⬜     |               |                 |
| M11 | Emergency alerts, SOS, medical                              | ⬜     |               |                 |
| M12 | Complaints + anonymous feedback                             | ⬜     |               |                 |
| M13 | Campus map, lost & found, achievements                      | ⬜     |               |                 |
| M14 | Career profile, skill gap, roadmap                          | ⬜     |               |                 |
| M15 | Job & internship portal, matching, applications             | ⬜     |               |                 |
| M16 | Placement officer, recruiter portal, interviews, placements | ⬜     |               |                 |
| M17 | Alumni network                                              | ⬜     |               |                 |
| M18 | Phase 4 role dashboards                                     | ⬜     |               |                 |
| M19 | Close Phase 4                                               | ⬜     |               |                 |

## M0 baseline (2026-09-24)

- `npm install`: up to date. `npm run typecheck`, `npm run lint`: exit 0.
- Web build: exit 0. Server `tsc` build: exit 0, but emits to `server/dist/server/src/…` and
  `server/dist/packages/…` rather than `server/dist/index.js` (the M1 bug).
- `npm test`: 31 files passed, 2 skipped; **434 passed + 7 skipped = 441**, floor 441 met.
  Full run takes about 5.5 min on this machine.
- Services: MongoDB runs as the local Windows service (replica set `rs0`). Redis, Mailpit and
  ClamAV run in Docker.

## M1 live check

```
$ npm run build            # packages (tsc -b) → server (tsc -b) → web (vite)
$ ls server/dist/index.js  → server/dist/index.js
$ node server/dist/index.js &   → "🚀 CampusConnect API listening on :4000 (development)"
$ curl localhost:4000/health    → 200 {"status":"ok","uptime":12.17}
$ rm -rf packages/*/dist && tsx --conditions=development src/index.ts   → /health 200 (dev needs no build)
```

## M2 live check (2026-09-24)

Two built instances (`node dist/index.js`, ports 4101/4102) against the Windows MongoDB replica
set (database `campusconnect_live`), Redis, Mailpit and ClamAV (`--profile scan`), with
`CLAMAV_ENABLED=true` and one shared `FILE_SIGNING_SECRET`. Script: a Node client logging in
through the real endpoints, with device-verification OTPs read from the Mailpit API.

```
logged in (asha@A, vikram@B, meera@B, ravi@A other tenant) ok
upload PDF on A → status, scanStatus                       201 CLEAN
vikram joins DM room on B                                  true
send DM with attachment on A → status                      201
message:new on B carries attachment metadata only          [{"id":"6ab48d8654f7d0d8631bb3e6","name":"live-check.pdf","mime":"application/pdf","size":104,"scanStatus":"CLEAN"}]
  …and no URL / storage key in the event                   true
vikram downloads on B → status                             200
  sha256 uploaded == sha256 downloaded                     true
  headers                                                  {"disposition":"attachment; filename=\"live-check.pdf\"; filename*=UTF-8''live-check.pdf","nosniff":"nosniff","csp":"sandbox","cache":"private, no-store"}
EICAR length (must be 68)                                  68
EICAR upload → status, code                                422 MALWARE_DETECTED
HTML renamed .png → status, code                           415 UNSUPPORTED_MEDIA_TYPE
ZIP bomb (20 MiB of zeros, deflated) → status, code, ms    415 UNSUPPORTED_MEDIA_TYPE 210ms
meera (group member) downloads on B → status               200
asha removes meera from group → status                     200
meera after removal → status                               404
ravi (other tenant) GET /files/:id → status                404
ravi (other tenant) GET /files/:id/meta → status           404
```

Also: `TEST_CLAMAV_HOST=localhost npx vitest run tests/integration/clamav-live.test.ts` → 2/2
passed against the real clamd.

## M3 live check (2026-09-24)

Same two-instance setup as M2 (fresh seed into `campusconnect_live`).

```
bhavana has a class chat                                   2022-2026 A
chirag reports the class message on B → status             201
meera (section mentor) queue on B                          ["CHAT_MESSAGE/CLASS x1 actionable=true reporter=hidden"]
rajesh (HOD) queue on A                                    ["CHAT_MESSAGE/CLASS","DISCUSSION/COMMUNITY"]
vikram (faculty, no moderation) GET queue → status         403
principal queue (all, reporters shown)                     ["CHAT_MESSAGE/CLASS reporter=shown","DISCUSSION/COMMUNITY reporter=shown"]
meera removes on B → status, body                          200 {"status":"REMOVED","closedReports":1}
bhavana sees message:deleted on A (cross-instance)         {"chatId":"6ab4934c015c9c9f755cdc66","messageId":"6ab4934d015c9c9f755cdcdd"}
meera history[0]                                           {"action":"REMOVE","note":"Offensive language in class chat.","reportCount":1}
principal sees DM report: actionable, preview              false null
meera sees DM report                                       false
principal tries to remove a DM → status                    409
chirag is a member of                                      Coding Club
chirag opens club chat before leaving → status             200
chirag leaves club on B → status                           200
chirag opens club chat after leaving (on A) → status       404
rejoin request → status                                    201
ravi (other tenant, student) GET queue → status            403
```

## M4 live check (2026-09-24)

Two instances, `campusconnect_live` freshly seeded. Every seeded role's dashboard, requests
alternating between instances:

```
student (bhavana) overall attendance                       90% (90/100)
  per subject                                              ["CS301:90% (18/20)","CS302:90% (18/20)","CS303:90% (18/20)","CS304:90% (18/20)","CS305:90% (18/20)"]
  today / unread ann / clubs / unread notif                5 / 2 /  / 0
student → /dashboards/hod                                  403
faculty (vikram): classes, to-mark, corrections, low       2, 0, 0, 2
mentor (meera): section, roster, section attendance        2022-2026 A, 8, 85% (680/800)
  low attendance                                           ["1JN22CS006:66%","1JN22CS005:67%"]
hod (rajesh): department, attendance                       CSE, 85% (680/800)
  by class                                                 ["CS301 A:85% (136/160)","CS302 A:85% (136/160)","CS303 A:85.63% (137/160)","CS304 A:85% (136/160)","CS305 A:84.38% (135/160)"]
principal: college attendance                              85% (680/800)
  by department                                            ["CSE:85% (680/800)"]
  events this month / moderation queue                     1 / 2
  security                                                 {"activeSessions":25,"loginsLast24h":25,"failedLoginsLast24h":0}
  SUM of departments == college (present/total)            680/800 vs 680/800
club admin (meera administers)                             ["Coding Club: 4 members, 0 pending, 1 events","Robotics Society: 0 members, 1 pending, 0 events","Music Club: 0 members, 0 pending, 1 events","Photography Circle: 0 members, 0 pending, 0 events"]
file:///C:/Users/KMSD/AppData/Local/Temp/claude/d--POJECTS-AI-ATDDENCE-CAMPUS/57360ca6-0df0-486d-bdd3-7966db0a475a/scratchpad/live/lib.mjs:41
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.text}`);
                                ^

Error: login ravi.student@riverside.test: 429 {"success":false,"error":{"code":"RATE_LIMITED","message":"Too many requests."},"requestId":"req_25ac3ce0-fe2a-4c48-8867-7f4d975369d7"}
    at login (file:///C:/Users/KMSD/AppData/Local/Temp/claude/d--POJECTS-AI-ATDDENCE-CAMPUS/57360ca6-0df0-486d-bdd3-7966db0a475a/scratchpad/live/lib.mjs:41:33)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async file:///C:/Users/KMSD/AppData/Local/Temp/claude/d--POJECTS-AI-ATDDENCE-CAMPUS/57360ca6-0df0-486d-bdd3-7966db0a475a/scratchpad/live/live-m4.mjs:42:14

Node.js v24.15.0
other-tenant student: attendance total / clubs / announcements 0 / 0 / 0
```

The college figure equals the sum of the department counts (680/800), i.e. SUM/SUM, not an
average of department percentages.

## Decisions taken

- **M0 — branch.** The local branch is `sai` and tracks `origin/main`. Pushing means
  `git push origin sai:main`, a plain fast-forward. No force, and no local branch rename.
- **M1 — package build tool: `tsc -b` with composite project references** (not tsup). There's
  no new dependency, and the `.d.ts` output matches what the typechecker already sees. Each
  package has a `tsconfig.build.json`. The server's `tsconfig.build.json` clears `paths`, so it
  compiles against the packages' emitted `dist/`, not their source.
- **M1 — dev/test resolve source.** Each package's `exports` map has `react-native` and
  `development` conditions pointing at `src/`, plus `types`/`default` pointing at `dist/`.
  `tsx` runs with `--conditions=development`. Vite and Vitest alias the packages to `src/`.
  TS `paths` in `tsconfig.base.json` still point at `src/` for typechecking.
  `apps/web/tailwind.config.ts` imports the tokens by relative path, because Tailwind's config
  loader resolves `default` (`dist/`).

- **M2 — `file-type` pinned to v19.** v20+ needs Node ≥ 22, but CI and `engines` use Node 20.
  The server tsconfig adds `customConditions: ["node"]` so TS resolves its Node entry
  (`fileTypeFromFile`).
- **M2 — ZIP inspection with `yauzl`**, central directory only (`lazyEntries`, never
  `openReadStream`). yauzl's own name validation, which refuses absolute and `..` paths, is also
  treated as a refusal.
- **M2 — a small clamd INSTREAM client (`infra/clamav.ts`)** instead of an npm wrapper. The
  protocol is framing only, with no crypto. Any unclear reply is treated as scanner-unavailable.
- **M2 — ClamAV unreachable → `503 SCAN_FAILED`.** The row is kept as SCAN_FAILED, with bytes
  held for an operator. It can't be attached or downloaded, and the orphan job removes it after
  the TTL.
- **M2 — infected → the row is kept as INFECTED and soft-deleted (`deletedReason: MALWARE`).**
  Its bytes are destroyed immediately.
- **M2 — polyglot rule.** Markup markers anywhere in an image, PDF or text file are refused, and
  so is a ZIP EOCD in the tail of a non-ZIP file. HTML-in-text is refused too, not just
  HTML-as-image.
- **M2 — nested archives = archive extensions** (zip, jar, rar, 7z, gz, tar…). Office files
  embedded in Office files (charts in a DOCX) are allowed. They still count toward the
  size/ratio limits.
- **M2 — `STORAGE_LOCAL_ROOT` relative values resolve against the repo root.** The owner's
  `.env` has `./storage`. The effective path is always absolute and git-ignored.
- **M2 — dev without `FILE_SIGNING_SECRET`** uses a random per-process key and logs a warning.
  Production refuses to boot without one.
- **M2 — the content route needs no bearer token** (it's a browser download), so it is mounted
  ahead of the routers that authenticate every path. The signed token authorizes it, and the
  bound user is re-authorized at use time.
- **M2 — upload rate limit keyed per user** (`cc:rl:file-upload:`, default 60/h). The content
  route is limited per IP (120/min), since there is no user until the token is verified.
- **M2 — announcements have no delete endpoint in Part A**, so their attachments live as long as
  the announcement. `deleteFilesForResource` is ready for when one exists.
- **M2 — dev seed adds a synthetic second institution** (`ravi.student@riverside.test`), so
  cross-tenant 404s can be demonstrated live.
- **M2 — test config shrinks limits** (1 MiB max, 3 MiB quota, 25 uploads/h) so the size, quota
  and rate paths run with small fixtures. The fake clamd flags a harmless marker, not EICAR.
  EICAR is used only by the live, `TEST_CLAMAV_HOST`-gated suite, assembled in memory.

- **M3 — per-report records (`ContentReport`) alongside the Part A counters.** The counters
  keep the old `/moderation/queue` working. The new queue groups the records. One row per
  reporter per target: repeats are no-ops and a dismissed report stays dismissed. A new reporter
  does raise the item again.
- **M3 — routing by where the content lives.** Community → `moderation:review`. Class chat →
  mentor/HOD/principal via the academic scope. Club chat → its admins plus principal/admin. The
  `ModerationReach` gains `institutionWide`, so the principal/system admin can also moderate club
  chats (before, club chats were club-admin only).
- **M3 — moderator removal doesn't require chat membership** (`removeMessageAsModerator`). A
  principal or HOD isn't in every class chat. The scope rule (`canModerateDelete`) decides.
- **M3 — DM/private-group reports are visible only to institution-wide moderators**, with no
  preview and no chat name. Deciding one returns 409.
- **M3 — reporter names only for `audit:read` holders** (principal, system admin).
- **M3 — new endpoints next to Part A's** (`/moderation/reports`, `/reports/decide`,
  `/history`), leaving the pinned Part A contract unchanged. The Part A decide path also closes
  the report records.
- **M3 — leave club.** Also withdraws a pending request. A club admin gets 409 (no orphaned
  clubs). Rejoining reuses the row.
- **M3 — the web nav and route guard accept "any of" permissions** (moderation = review OR chat
  moderate). Chat messages gain a Report action.
- **M2 — `.gitignore`'s bare `storage/` hid `server/src/infra/storage`**, so one push went out
  without the storage source. Fixed by anchoring it to `/storage/`, pushed right after
  (0880d1f).

- **M4 — dashboards gated by role, then scope-narrowed.** Each route requires the permission its
  data needs (`attendance:read:self` / `attendance:mark` / `attendance:read:scope` /
  `club:manage`), and the service checks the role (403 AUTHORIZATION_DENIED otherwise). No new
  permissions.
- **M4 — faculty "low attendance" covers only their own classes**, not the student's record
  across all subjects. Mentor, HOD and principal get the wider views.
- **M4 — no charting library.** Charts are the existing accessible `AttendanceMeter` bars
  (`role="meter"`) with the percentage and raw counts always printed, plus stat cards. Status is
  shown as text, not colour alone.
- **M4 — role switcher.** The landing page opens the primary role's dashboard, with tabs for any
  other roles held.
- **M4 — seeded club admin gets `CLUB_ADMIN`.** The mentor administered clubs but lacked
  `club:manage`, so could neither approve members nor open the club-admin dashboard (a
  pre-existing seed inconsistency, found by the live check).
- **M4 — two indexes added:** `LoginHistory {institutionId, at}` and
  `Session {institutionId, revokedAt, expiresAt}`, for the principal's security summary.
- **M3/M4 — whole-directory prettier sweeps** reformatted some pre-existing web and doc files in
  those commits. Formatting only.

## Blocked / needs owner

- **The dev database `campusconnect` on the local MongoDB holds another app's data.** Its
  `clubs` collection has `slug`/`members` fields and a unique `slug_1` index, so
  `npm run seed -w server` fails with E11000 on it. I did not drop or change anything. Live
  checks seed and run against `MONGODB_DB_NAME=campusconnect_live`. Owner: either point
  CampusConnect at its own database (set `MONGODB_DB_NAME`) or clear that collection yourself.

## Deferred (to Phase 5 or later)

## Bugs found by running things

- **M2 — busboy decodes multipart filenames as latin1 by default**, so `résumé.pdf` arrived
  mangled. Fixed with `defParamCharset: 'utf8'`.
- **M2 — the token-only download route got 401**, because earlier routers apply
  `authenticate` to every path under `/`. Fixed by mounting it first.
- **M2 — the clamd client half-closed its socket after the zero-length terminator.** A real
  clamd behind Docker's port proxy then closed without a verdict, so every upload came back
  SCAN_FAILED. The fake clamd in the tests tolerated it. Found only by the live check. Fixed
  (write the terminator, wait for the NUL-terminated reply), and it's now covered by the gated
  live suite.
- **Intermittent "Worker exited unexpectedly" (seen twice: once mid-run in M2, once at start in M4), no failing assertion; reruns are clean.** A live script on the same machine then aborted on exit with the libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)` in `src\winsync.c`, a known Node 24-on-Windows exit-path bug. That's the likely cause (the machine runs Node v24.15.0; CI and `engines` target Node 20). No code change masks it. Owner: prefer Node 20/22 LTS locally. Original M2 note: the first full run after M2 had one "Worker exited unexpectedly"** partway through,
  with no failing assertion. The next full run was clean (520/520). It didn't reproduce. I'm
  watching it in the M6 five-run check.
- **M2 — `cc-mongodb` (Docker) came back when Docker Desktop started** and listened on
  `[::]:27017` next to the Windows `mongod` on `127.0.0.1:27017`. Stopped with `docker stop`
  (volume untouched), per the owner's setup: CampusConnect uses the Windows service.
