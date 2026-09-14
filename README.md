# stellarlens

**Live:** [stellarlens-web.vercel.app](https://stellarlens-web.vercel.app)

## Overview

`stellarlens` is a pnpm + Turborepo monorepo. It's a young project — several
workspaces are still bare scaffolding rather than finished apps. Check each
workspace's own source before assuming functionality exists.

## Tech stack

- **Package manager**: pnpm (workspaces), pinned via `packageManager` in root
  `package.json`
- **Build orchestration**: Turborepo (`turbo.json` — `build`, `lint`,
  `typecheck`, `test`, `dev` pipelines)
- **Language**: TypeScript everywhere, strict mode. Root `tsconfig.base.json`
  holds shared compiler options; each workspace has its own `tsconfig.json`
  overriding `module`/`target`/`outDir`/`rootDir` as needed for its toolchain
- **Lint/format**: ESLint 9 flat config (`eslint.config.js`, root-level,
  `typescript-eslint`) + Prettier (`.prettierrc.json`)
- **API** (`apps/api`): NestJS 12, Express platform
- **Web** (`apps/web`): Next.js 14 (App Router), Tailwind CSS v3
- **DB** (`packages/db`): Drizzle ORM targeting Postgres, `postgres` (postgres.js)
  driver, `drizzle-kit` for migrations
- **Local infra**: Docker Compose for Postgres 16 + Redis 7 (`docker-compose.yml`)
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — install, lint,
  typecheck, build on every push and PR

## Monorepo layout

```
apps/
  api/       NestJS API. GET /health -> { status: "ok" }. Otherwise bare.
  web/       Next.js App Router + Tailwind. Bare landing page only.
  indexer/   Bare TypeScript scaffold (tsc -b). No runtime logic yet.
packages/
  sdk/       Bare TypeScript scaffold. Intended as the shared client SDK.
  cli/       Bare TypeScript scaffold with a `bin` entry (`stellarlens`).
  db/        Drizzle config + db client factory (`createDb`). No schema yet —
             src/schema/ and migrations/ are intentionally empty.
.github/     CI workflow, CONTRIBUTING.md, CODE_OF_CONDUCT.md, PR/issue templates
docker-compose.yml   Local Postgres + Redis
.env.example         DATABASE_URL, REDIS_URL
```

Workspaces are `apps/*` and `packages/*` (see `pnpm-workspace.yaml`), scoped
as `@stellarlens/<name>`.

## Coding conventions

- **Commit messages**: single line, lowercase, imperative mood, no period —
  e.g. `add health check endpoint to api`. No AI attribution lines
  (no `Co-Authored-By: Claude` or similar) — commits should read as if
  written directly by the maintainer.
- **Match existing style** in whatever file/package you're editing rather
  than introducing a new pattern. Root ESLint/Prettier config governs
  formatting — run `pnpm lint` before committing.
- **Don't add speculative abstractions or dependencies.** Several workspaces
  are intentionally bare scaffolding; don't flesh them out unless asked.
- **Build artifacts are gitignored** (`dist/`, `.next/`, `.turbo/`,
  `*.tsbuildinfo`) — never commit them.

## Running locally

Install once, from the repo root:

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis   # Postgres on localhost:5433, Redis on 6379
```

Run a single app/package with `pnpm --filter <name> <script>`, or fan a
script out to everything with the root script (`pnpm dev`, `pnpm build`, etc.).

| Workspace | Dev command | Notes |
|---|---|---|
| `apps/api` | `pnpm --filter @stellarlens/api dev` | NestJS, `nest start --watch`. Listens on `:3000` by default (`PORT` env overrides). `GET /health` |
| `apps/web` | `pnpm --filter @stellarlens/web dev` | Next.js, `next dev`. Also listens on `:3000` by default — **run api and web with different `PORT` values if both are up at once** |
| `apps/indexer` | `pnpm --filter @stellarlens/indexer dev` | `tsc -b --watch` only; no entrypoint script yet |
| `packages/sdk` | `pnpm --filter @stellarlens/sdk dev` | `tsc -b --watch` only |
| `packages/cli` | `pnpm --filter @stellarlens/cli dev` | `tsc -b --watch` only; `bin: stellarlens` -> `dist/index.js` once built |
| `packages/db` | n/a (library) | `db:generate` / `db:migrate` / `db:studio` scripts wrap `drizzle-kit`; requires `DATABASE_URL` (see `.env.example`) and Postgres running |

Full pipeline check before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```
