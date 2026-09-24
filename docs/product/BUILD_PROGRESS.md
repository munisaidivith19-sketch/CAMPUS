# Build progress — Phase 3 completion + Phase 4

This ledger is the working memory for the Phase 3 completion + Phase 4 build. A milestone is ✅
only when its definition of done holds **and** its commits exist on `main`.

| #   | Milestone                                                   | Status | Commits       | Tests after     |
| --- | ----------------------------------------------------------- | ------ | ------------- | --------------- |
| M0  | Baseline + progress ledger                                  | ✅     | dbb6a70       | 441 (7 skipped) |
| M1  | Fix `npm start` / real package builds                       | ✅     | (this commit) | 441 (7 skipped) |
| M2  | Secure file sharing (+ chat & announcement attachments)     | ⬜     |               |                 |
| M3  | Moderation queue UI + chat reports + leave club             | ⬜     |               |                 |
| M4  | Phase 3 role dashboards                                     | ⬜     |               |                 |
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

## Blocked / needs owner

## Deferred (to Phase 5 or later)

## Bugs found by running things
