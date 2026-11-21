# stellarlens

[![CI](https://github.com/cyfer-codes/stellarlens/actions/workflows/ci.yml/badge.svg)](https://github.com/cyfer-codes/stellarlens/actions/workflows/ci.yml)

**Status:** CI passing on `main` — lint, typecheck, build, and the api/indexer/web test suites are all
green (see the badge above for the current state).

- **Live:** [stellarlens-web.vercel.app](https://stellarlens-web.vercel.app)
- **Live demo:** [stellarlens-web.vercel.app/contracts](https://stellarlens-web.vercel.app/contracts) —
  browse real indexed contracts, events, and transfers with no sign-in required.

## What is stellarlens?

stellarlens is an indexing and monitoring platform for [Soroban](https://soroban.stellar.org/)
smart contracts on Stellar. Register a contract address, and stellarlens:

- polls Soroban RPC for that contract's events and decodes them (raw XDR alongside native values),
- detects SEP-41 token transfers and tracks volume/sender/receiver stats,
- fires signed webhooks to your own endpoints as new events land ([docs/webhooks.md](docs/webhooks.md)),
- and surfaces all of it in a login-gated web dashboard, a REST api, a typed SDK, and a CLI.

## Screenshots

<table>
<tr>
<td align="center">Contracts</td>
<td align="center">Contract detail (events)</td>
<td align="center">Transfers</td>
</tr>
<tr>
<td><a href="docs/screenshots/contracts-list.png"><img src="docs/screenshots/contracts-list.png" width="320"></a></td>
<td><a href="docs/screenshots/contract-detail.png"><img src="docs/screenshots/contract-detail.png" width="320"></a></td>
<td><a href="docs/screenshots/contract-transfers.png"><img src="docs/screenshots/contract-transfers.png" width="320"></a></td>
</tr>
</table>

Taken from a `PUBLIC_DEMO` deployment — no login required. See
[docs/screenshots.md](docs/screenshots.md) for the full capture checklist (a few more views — login,
onboarding, settings — are still outstanding).

## Quickstart

```bash
git clone https://github.com/cyfer-codes/stellarlens.git
cd stellarlens
pnpm install
cp .env.example .env
docker compose up -d postgres redis   # Postgres on localhost:5433, Redis on 6379

pnpm --filter @stellarlens/db db:migrate
pnpm --filter @stellarlens/web seed-admin   # SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars

pnpm dev   # starts every app in watch mode
```

Prefer containers? See [Running everything with Docker](#running-everything-with-docker) for a
single-command stack.

Then open the web dashboard (default `:3000` — see the per-workspace table below for exact ports and
env vars each app needs), log in with the seeded admin account, and generate your first api key from
**Settings**.

| Workspace | Dev command | Notes |
|---|---|---|
| `apps/api` | `pnpm --filter @stellarlens/api dev` | Listens on `:3000` by default (`PORT` overrides). `GET /health` is public |
| `apps/web` | `pnpm --filter @stellarlens/web dev` | Also defaults to `:3000` — run with a different `PORT` if both are up. Needs `API_URL`, `API_KEY`, `DATABASE_URL`, `SESSION_SECRET` (see `apps/web/.env.example`) |
| `apps/indexer` | `pnpm --filter @stellarlens/indexer dev` | Needs `DATABASE_URL`, `SOROBAN_RPC_URL`, `STELLAR_NETWORK` |
| `packages/sdk` | `pnpm --filter @stellarlens/sdk dev` | `tsup --watch` |
| `packages/cli` | `pnpm --filter @stellarlens/cli dev` | Needs `STELLARLENS_API_URL` / `STELLARLENS_API_KEY` to actually run the built binary — see `packages/cli/README.md` |
| `packages/db` | n/a (library) | `db:generate` / `db:migrate` / `db:studio` wrap `drizzle-kit`; needs `DATABASE_URL` and Postgres running |

The indexer runs as a daemon by default. Set `POLL_ONCE=true` to process one poll cycle and exit; in
this mode the registry server is not started. `WEBHOOK_CONCURRENCY` optionally sets the maximum
number of simultaneous webhook deliveries per event (default: `10`). `WEBHOOK_MAX_RETRIES`,
`WEBHOOK_RETRY_BASE_DELAY_MS`, `WEBHOOK_RETRY_MAX_DELAY_MS` and `WEBHOOK_TIMEOUT_MS` tune delivery
retries and the per-attempt timeout (defaults: `3`, `500`, `5000`, `5000`); see
[docs/webhooks.md](docs/webhooks.md#configuration) for everything else that affects delivery.

Full pipeline check before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @stellarlens/db db:migrate   # tests run against the migrated schema; they don't create tables
pnpm test
```

The api and indexer test suites never create or migrate tables themselves: they fail fast with a
"database is missing N migration(s)" error unless `DATABASE_URL` has every migration applied. CI
applies all migrations to a fresh Postgres before testing, runs `drizzle-kit check`, and fails if
`drizzle-kit generate` would produce a new migration — so after changing `packages/db/src/schema`,
run `pnpm --filter @stellarlens/db db:generate` and commit the generated files.

## Running everything with Docker

`docker compose up -d` still starts only Postgres and Redis (for `pnpm dev` on the host). The `full`
profile builds and runs the whole stack:

```bash
docker compose --profile full up -d --build --wait
```

| Service | What it does | Host port |
|---|---|---|
| `postgres`, `redis` | Datastores (health-checked) | `5433`, `6379` |
| `migrate` | One-shot `drizzle-kit migrate` against the compose database; everything else waits for it to exit `0` | — |
| `seed` | One-shot, idempotent: creates the dashboard admin user and registers the dashboard's api key | — |
| `api` | NestJS api, healthy once `GET /health/ready` can reach the database | `3001` (`API_PORT`) |
| `indexer` | Polling worker; health-checked via the registry server's `GET /health` | `3002` (`INDEXER_REGISTRY_PORT`) |
| `web` | Next.js dashboard, started once the api is healthy and seeding has finished | `3000` (`WEB_PORT`) |

Open <http://localhost:3000> and log in as `admin@stellarlens.local` / `stellarlens-local`. The CLI
can use the same stack:
`STELLARLENS_API_URL=http://localhost:3001 STELLARLENS_API_KEY=local-dev-api-key-change-me stellarlens contracts list`.

The defaults are for local use only. Override them from the shell or a root `.env` file:
`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `STELLARLENS_API_KEY` (the key the dashboard sends, seeded
into `api_keys`), `SESSION_SECRET`, `SOROBAN_RPC_URL`, `STELLAR_NETWORK`, `POLL_INTERVAL_MS`,
`WEBHOOK_CONCURRENCY`, `REGISTRY_SECRET` (required by the indexer; send it as `X-Registry-Secret`
when calling `POST /contracts`), `CORS_ORIGINS`, `PUBLIC_DEMO`, `SITE_URL`, and the host ports above.
`docker compose --profile full down -v` removes everything, including the database volume.

Each app has a multi-stage Dockerfile (`apps/api/Dockerfile`, `apps/indexer/Dockerfile`,
`apps/web/Dockerfile`) that runs `turbo prune <app> --docker`, so an image only installs and builds
that app and its workspace dependencies, and the runtime stage carries production dependencies plus
compiled output. Build any of them from the repo root, e.g.
`docker build -f apps/api/Dockerfile -t stellarlens-api .`. Extra targets: `apps/api/Dockerfile`'s
`migrate` and `apps/web/Dockerfile`'s `tools` (seeding). CI builds every image on each push and PR.

## Architecture

```mermaid
flowchart LR
    RPC[Soroban RPC]

    subgraph stellarlens
        Indexer[apps/indexer]
        API[apps/api — NestJS]
        Web[apps/web — Next.js dashboard]
        DB[(Postgres)]
    end

    RPC -->|poll for events| Indexer
    Indexer -->|events, transfers, checkpoints| DB
    Indexer -->|signed POST| Webhooks[Registered webhook URLs]

    API <-->|read/write| DB
    Web -->|x-api-key| API
    Web -->|login + api-key management, direct| DB

    SDK[packages/sdk] -->|x-api-key| API
    CLI[packages/cli] --> SDK
```

Everything but the dashboard's own login and api-key management goes through the api, which is the
single source of truth gated by `x-api-key`. The dashboard talks to Postgres directly only for the
one thing that can't depend on an api key existing yet: creating the first one (see
[`apps/web/lib/apiKeys.ts`](apps/web/lib/apiKeys.ts) if you're curious why).

## Tech stack

- **Package manager**: pnpm (workspaces), pinned via `packageManager` in root `package.json`
- **Build orchestration**: Turborepo (`turbo.json`)
- **Language**: TypeScript everywhere, strict mode
- **Lint/format**: ESLint 9 flat config + Prettier
- **API** (`apps/api`): NestJS, api-key auth, per-key rate limiting
- **Indexer** (`apps/indexer`): a polling worker, no framework — decodes XDR, detects transfers, delivers webhooks
- **Web** (`apps/web`): Next.js 14 App Router, Tailwind, session-cookie auth gating every route
- **SDK** (`packages/sdk`): typed client for the api, published as `@stellarlens/sdk`
- **CLI** (`packages/cli`): `stellarlens contracts add` (single or bulk) / `list`, `stellarlens events tail`, built on the SDK
- **CLI** (`packages/cli`): `stellarlens contracts add/list`, `stellarlens events tail` (starts at the latest event; `--since <cursor|iso-date>` or `--from-start` to replay), built on the SDK
- **DB** (`packages/db`): Drizzle ORM + Postgres, `drizzle-kit` for migrations
- **CI**: GitHub Actions — install, lint, typecheck, build, migrate + drift check, test, and Docker image builds on every push and PR

## Monorepo layout

```
apps/
  api/       NestJS API — contracts, events, transfers, stats, api keys
  web/       Next.js dashboard — login, contracts/events/transfers views, settings
  indexer/   Polls Soroban RPC, writes events/transfers, delivers webhooks
packages/
  sdk/       Typed TypeScript client for the api (@stellarlens/sdk)
  cli/       Command-line tool built on the sdk (@stellarlens/cli)
  db/        Drizzle schema, migrations, and the shared db client
docs/        Supplementary docs (see docs/screenshots.md)
.github/     CI workflow, CONTRIBUTING.md, CODE_OF_CONDUCT.md, PR/issue templates
docker-compose.yml   Local Postgres + Redis; `--profile full` adds migrations, api, indexer, web
.env.example         Root-level env vars for db/indexer; apps/web and apps/api have their own
```

Workspaces are `apps/*` and `packages/*` (see `pnpm-workspace.yaml`), scoped as `@stellarlens/<name>`.

## Docs

- [docs/webhooks.md](docs/webhooks.md) — webhook delivery semantics, retries, signature verification,
  blocked destinations, pausing, the delivery history api, and related env vars
- [docs/screenshots.md](docs/screenshots.md) — capture checklist for the README's screenshots
- Deployment: see the Render + Vercel runbook shared separately (ask if you need it re-sent)

## Coding conventions

- **Commit messages**: single line, lowercase, imperative mood, no period — e.g.
  `add health check endpoint to api`. No AI attribution lines — commits should read as if written
  directly by the maintainer.
- **Match existing style** in whatever file/package you're editing. Root ESLint/Prettier config
  governs formatting — run `pnpm lint` before committing.
- **Don't add speculative abstractions or dependencies** without a reason tied to the task at hand.
- **Build artifacts are gitignored** (`dist/`, `.next/`, `.turbo/`, `*.tsbuildinfo`) — never commit them.

## Contributing

Contributions are welcome — see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) for the full
guide (setup, branch/PR flow, style). New to the codebase? Look for issues tagged
[`good first issue`](https://github.com/cyfer-codes/stellarlens/labels/good%20first%20issue) — they're
scoped to be a reasonable first contribution. Please also read the
[Code of Conduct](.github/CODE_OF_CONDUCT.md) before participating.
