# API Keys & External Services

This is the authoritative matrix of external services CampusConnect may use. **Nothing here is
configured or required for the Phase 1 foundation, and the local prototype runs at ₹0 with no
paid services.** Keys, when used, live only in the backend `.env` (never in frontend code, never
committed). We never invent keys or pretend a service is configured when it is not — unconfigured
integrations report **`NOT CONFIGURED`** at runtime.

| Service                 | Required?                 | Purpose                                     | Where to obtain                                               | Env variable                                                        | Free / local alternative                                                                                                                          |
| ----------------------- | ------------------------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MongoDB**             | ✅ Required               | Sole primary database                       | Local via Docker (`mongo:7`) or MongoDB Atlas free tier       | `MONGODB_URI`                                                       | Local Docker (default) — no account needed                                                                                                        |
| **Redis**               | ⬜ Optional               | Rate limiting, cache, queues, session infra | Local via Docker (`redis:7`)                                  | `REDIS_URL`                                                         | Local Docker; app degrades to in-memory where safe if absent                                                                                      |
| **SMTP / Email**        | ⬜ Optional (dev)         | Password reset, notifications, verification | Any SMTP provider (e.g. Gmail SMTP, SES) for prod             | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`              | **Mailpit** (Docker) — catches all dev mail, no account, UI at :8025                                                                              |
| **Gemini (AI)**         | ⬜ Optional               | AI campus/career assistant (Phase 5)        | Google AI Studio (free tier)                                  | `GEMINI_API_KEY` (only when `AI_PROVIDER=gemini`)                   | **Ollama** local model — fully offline, no key                                                                                                    |
| **Ollama (AI)**         | ⬜ Optional               | Local AI provider (Phase 5)                 | Install Ollama locally                                        | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`                                   | Is itself the free/local option                                                                                                                   |
| **Job provider(s)**     | ⬜ Optional               | External job/internship feeds (Phase 4)     | Depends on chosen provider; keys stay server-side             | `JOB_PROVIDER`, `JOB_API_KEY`                                       | Institution-posted jobs + company careers entered manually; no external key needed                                                                |
| **Maps**                | ⬜ Optional               | Campus map (Phase 4)                        | **None** — OpenStreetMap + Leaflet need no key/token          | `MAP_TILE_URL`                                                      | OSM public tiles (default); self-host tiles for heavy use                                                                                         |
| **Push notifications**  | ⬜ Optional               | Mobile push (Phase 3+)                      | Expo Push (free) via Expo project                             | _(Expo project id in app config)_                                   | Expo Push service — free; in-app + email cover the rest                                                                                           |
| **File storage**        | ⬜ Optional               | Uploaded files (Phase 3 C-3)                | Any S3-compatible store (driver **NOT CONFIGURED** — Phase 5) | `STORAGE_DRIVER`, `STORAGE_LOCAL_ROOT`                              | **Local disk** (`STORAGE_DRIVER=local`) — default, ₹0. Any other driver refuses to boot.                                                          |
| **File signing secret** | ✅ Required in production | HMAC for short-lived download URLs          | Generate locally (no account)                                 | `FILE_SIGNING_SECRET`                                               | Dev without it: a random per-process key, single-instance only (warned at boot)                                                                   |
| **ClamAV**              | ⬜ Optional               | Upload malware scanning (Phase 3 C-3)       | Bundled Docker image                                          | `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_ENABLED`, `CLAMAV_TIMEOUT_MS` | `clamav/clamav` Docker service (`--profile scan`) — free. Disabled → SKIPPED (dev-only downloads); unreachable → SCAN_FAILED (never downloadable) |
| **Sentry**              | ⬜ Optional               | Error tracking (Phase 5)                    | sentry.io (free tier)                                         | `SENTRY_DSN`                                                        | Structured logs (pino) locally; Sentry only if desired                                                                                            |

## Rules

- **Backend-only.** Third-party keys are read by the server; they are never sent to web/mobile.
  Only `VITE_*` / `EXPO_PUBLIC_*` values (non-secret) reach clients.
- **Never commit `.env`.** `.gitignore` blocks it; CI runs secret scanning.
- **Provider abstractions** (`AIProvider`, `JobProvider`, storage, email) make every external
  service replaceable, so swapping providers never touches feature code.
- **Default posture is local/free.** A fresh clone runs entirely on Docker services with no
  external account.
