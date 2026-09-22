# scripts/

Developer helper scripts.

- `check-env.mjs` — verifies `.env` exists and required variables are present (no secret
  values printed). Run: `node scripts/check-env.mjs`.

The MongoDB single-node replica set (needed for transactions) is initialized automatically by
the `mongo-init` service in `docker-compose.yml` — no manual script needed for local dev.
Seeders (synthetic data only) live in `server/src/db/seed.ts` and are run with
`npm run seed -w server` starting in the phases that add models.
