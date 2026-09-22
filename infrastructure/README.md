# Infrastructure

Local dev is orchestrated by the root `docker-compose.yml` (MongoDB, Redis, Mailpit, and
profile-gated ClamAV). This directory holds the production-like pieces.

- `docker/` — per-service Dockerfiles for the API and web app (added when the apps
  containerize; multi-stage, minimal base images, non-root users, health checks, no baked
  secrets — per section 63 of the build spec).
- `nginx/nginx.conf` — reference reverse proxy: TLS termination, security headers, coarse
  rate limiting, WebSocket upgrade, upstreams for API and web.
- `monitoring/` — Prometheus scrape config and Grafana dashboards (observability, Phase 5).
  All free/local.

Nothing here is required to run the Phase 1 foundation; it documents the "reverse proxy",
"monitoring", and container layers of the frozen architecture so later phases slot in
without redesign.
