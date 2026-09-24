# Local Setup — Windows

Step-by-step to run the CampusConnect **Phase 1 foundation** on Windows 10/11. Everything is
free (₹0). Commands are for **PowerShell**.

## 1. Prerequisites

Install these once:

| Tool           | Version    | Get it                                                                |
| -------------- | ---------- | --------------------------------------------------------------------- |
| Node.js        | 20.11 LTS+ | https://nodejs.org (LTS installer)                                    |
| Git            | latest     | https://git-scm.com                                                   |
| Docker Desktop | latest     | https://www.docker.com/products/docker-desktop (enable WSL 2 backend) |
| VS Code        | latest     | https://code.visualstudio.com                                         |

Verify:

```powershell
node -v      # v20.x or newer
npm -v       # 10.x or newer
git --version
docker --version
docker compose version
```

> Docker Desktop must be **running** before `docker compose` commands. On first launch it may ask
> to enable WSL 2 / virtualization — accept.

## 2. Get the code & install

```powershell
git clone <your-repo-url> campusconnect
cd campusconnect
npm install          # installs all workspaces (root, server, web, mobile, packages)
```

## 3. Configure environment

```powershell
copy .env.example .env
node scripts/check-env.mjs   # confirms required vars are present (no secrets printed)
```

Open `.env` in VS Code. For local dev the defaults work as-is. Optionally generate strong auth
secrets (used in Phase 2):

```powershell
# Run twice; paste each value into JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## 4. Start backing services (Docker)

```powershell
docker compose up -d              # MongoDB (replica set), Redis, Mailpit
docker compose ps                 # all should become healthy
```

- MongoDB → `mongodb://localhost:27017/campusconnect`
- Mailpit UI (caught emails) → http://localhost:8025
- To also run malware scanning: `docker compose --profile scan up -d`

## 5. Verify the foundation

```powershell
# Type-check everything
npm run typecheck

# Run the API (Phase 1 exposes /health and /api/v1/meta)
npm run dev:server
```

In a second PowerShell window:

```powershell
curl http://localhost:4000/health
curl http://localhost:4000/api/v1/meta
```

Run the web foundation screen:

```powershell
npm run dev:web        # opens http://localhost:5173
```

Mobile (optional, needs the Expo Go app on your phone):

```powershell
npm run start -w apps/mobile
```

## 6. Common issues

| Symptom                                    | Fix                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `docker compose` errors                    | Ensure Docker Desktop is running; try `wsl --update`.                                                                    |
| Port already in use (27017/6379/4000/5173) | Stop the conflicting process or change the port in `.env` / compose.                                                     |
| Mongo transactions fail                    | The `mongo-init` service sets up the replica set; re-run `docker compose up -d` and wait for `cc-mongodb` to be healthy. |
| `npm install` engine warning               | Install Node 20.11+ (`nvm-windows` helps manage versions).                                                               |

## 7. Stopping

```powershell
docker compose down            # stop services (keeps data volumes)
docker compose down -v         # also remove data volumes (fresh start)
```

## What you can and can't do yet

Phase 1 is the **foundation**: the API answers health/meta, the web and mobile apps render a
foundation screen, and all architecture/docs are in place. **Login, dashboards, and features do
not exist yet** — they begin in Phase 2. See `docs/product/PHASE_PLAN.md`.
