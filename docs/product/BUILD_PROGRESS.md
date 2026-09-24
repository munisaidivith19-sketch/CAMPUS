# Build progress — Phase 3 completion + Phase 4

This ledger is the working memory for the Phase 3 completion + Phase 4 build. A milestone is ✅
only when its definition of done holds **and** its commits exist on `main`.

| # | Milestone | Status | Commits | Tests after |
|---|-----------|--------|---------|-------------|
| M0 | Baseline + progress ledger | ✅ | (this commit) | 441 (7 skipped) |
| M1 | Fix `npm start` / real package builds | ⬜ | | |
| M2 | Secure file sharing (+ chat & announcement attachments) | ⬜ | | |
| M3 | Moderation queue UI + chat reports + leave club | ⬜ | | |
| M4 | Phase 3 role dashboards | ⬜ | | |
| M5 | Playwright E2E | ⬜ | | |
| M6 | Close Phase 3 | ⬜ | | |
| M7 | Digital Permission Engine | ⬜ | | |
| M8 | Gate pass, campus in/out, security dashboard | ⬜ | | |
| M9 | Hostel | ⬜ | | |
| M10 | Mess | ⬜ | | |
| M11 | Emergency alerts, SOS, medical | ⬜ | | |
| M12 | Complaints + anonymous feedback | ⬜ | | |
| M13 | Campus map, lost & found, achievements | ⬜ | | |
| M14 | Career profile, skill gap, roadmap | ⬜ | | |
| M15 | Job & internship portal, matching, applications | ⬜ | | |
| M16 | Placement officer, recruiter portal, interviews, placements | ⬜ | | |
| M17 | Alumni network | ⬜ | | |
| M18 | Phase 4 role dashboards | ⬜ | | |
| M19 | Close Phase 4 | ⬜ | | |

## M0 baseline (2026-09-24)

- `npm install`: up to date. `npm run typecheck`, `npm run lint`: exit 0.
- Web build: exit 0. Server `tsc` build: exit 0, but emits to `server/dist/server/src/…` and
  `server/dist/packages/…` rather than `server/dist/index.js` (the M1 bug).
- `npm test`: 31 files passed, 2 skipped; **434 passed + 7 skipped = 441**, floor 441 met.
  Full run takes about 5.5 min on this machine.
- Services: MongoDB runs as the local Windows service (replica set `rs0`). Redis, Mailpit and
  ClamAV run in Docker.

## Decisions taken

## Blocked / needs owner

## Deferred (to Phase 5 or later)

## Bugs found by running things
