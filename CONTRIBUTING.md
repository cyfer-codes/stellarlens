# Contributing

## Setup

```
pnpm install
cp apps/web/.env.example apps/web/.env
```

Start a local Postgres (`docker run -p 5432:5432 -e POSTGRES_USER=stellarlens -e POSTGRES_PASSWORD=stellarlens -e POSTGRES_DB=stellarlens postgres:16-alpine`), then:

```
pnpm --filter @stellarlens/db db:migrate
```

## Checks

```
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`pnpm test` runs each package's unit/integration tests (vitest) via turbo. It does not run the Playwright end-to-end suite below.

## End-to-end tests (apps/web/e2e)

A Playwright suite walks the core dashboard flow against a real, running api + web stack: log in, add a contract, view its events and transfers, create and delete a webhook, and create and revoke an api key. It exists to catch regressions that only show up when the dashboard actually talks to a live api (e.g. a malformed proxied URL) — nothing else in the test suite exercises that path.

It needs the api and web app built and running, with a migrated database and a seeded admin user and api key. CI (`.github/workflows/ci.yml`, job `e2e`) does this against Postgres and api service — to run it locally:

```
# 1. Migrate and seed a database (see Setup above for starting Postgres)
pnpm --filter @stellarlens/db db:migrate
SEED_ADMIN_EMAIL=admin@stellarlens.local SEED_ADMIN_PASSWORD=<password> \
  pnpm --filter @stellarlens/web seed-admin

# 2. Mint a full-scope api key for the web app to proxy with
pnpm --filter @stellarlens/web seed-api-key   # prints the raw key once

# 3. Build and start the api on :3400
pnpm --filter @stellarlens/api build
PORT=3400 DATABASE_URL=<...> SOROBAN_RPC_URL=<...> STELLAR_NETWORK=<...> \
  node apps/api/dist/main.js

# 4. Build and start the web app on :3100, pointed at the api
pnpm --filter @stellarlens/web build
cd apps/web && API_URL=http://localhost:3400 API_KEY=<key from step 2> \
  DATABASE_URL=<...> SESSION_SECRET=<...> npx next start -p 3100

# 5. Run the suite (from another shell)
cd apps/web
npx playwright install --with-deps chromium   # first time only
SEED_ADMIN_EMAIL=admin@stellarlens.local SEED_ADMIN_PASSWORD=<password> \
  E2E_BASE_URL=http://localhost:3100 pnpm test:e2e
```

`apps/web/playwright.config.ts` doesn't manage the api/web servers itself — they need their own migrated database and seeded credentials first, which Playwright's `webServer` option isn't set up to do.
