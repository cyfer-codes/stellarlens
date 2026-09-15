# Contributing to stellarlens

First off, thank you for taking the time to contribute! Whether this is your
first pull request ever or your five-hundredth, we're glad you're here.
No contribution is too small — fixing a typo, improving docs, filing a clear
bug report, and shipping a feature are all genuinely valuable.

If anything in this guide is unclear, that's a bug in the guide, not a mistake
on your part — please open an issue and let us know.

## Code of Conduct

This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you're expected to uphold it. Please read it before
contributing.

## Getting started

stellarlens is a pnpm + Turborepo monorepo. You'll need:

- Node.js 20+
- [pnpm](https://pnpm.io/) (see the `packageManager` field in `package.json`
  for the exact version)
- [Docker](https://www.docker.com/) (for local Postgres + Redis)

Set up your environment:

```bash
git clone https://github.com/cyfer-codes/stellarlens.git
cd stellarlens
pnpm install
cp .env.example .env
docker compose up -d postgres redis
```

Common commands, run from the repo root and fanned out to every workspace via
Turborepo:

```bash
pnpm dev         # start all apps in watch mode
pnpm build       # build everything
pnpm lint        # lint everything
pnpm typecheck   # type-check everything
pnpm test        # run tests
```

You can also scope any of these to a single workspace, e.g.
`pnpm --filter @stellarlens/api dev`.

## Project layout

```
apps/
  api/       NestJS API
  web/       Next.js app
  indexer/   background indexer service
packages/
  sdk/       shared client SDK
  cli/       command-line tool
  db/        Drizzle ORM schema, migrations, and db client
```

## Making a change

1. **Found a bug or have an idea?** Check the [issues](../../issues) first to
   see if it's already been reported. If not, open one — it helps us track
   the work and avoids duplicate effort. For small, obvious fixes (typos,
   broken links) feel free to skip straight to a PR.
2. **Fork the repo and create a branch** off `main` with a short, descriptive
   name.
3. **Make your change.** Keep commits focused — one logical change per
   commit, with a short, lowercase, imperative commit message (e.g.
   `fix health check route path`).
4. **Verify locally** before opening a PR:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm test
   ```
5. **Open a pull request** against `main` and fill out the PR template. Link
   the issue it addresses, if any.
6. **CI will run automatically** on your PR (lint, typecheck, build). A
   maintainer will review as soon as they can — first-time contributors are
   never expected to get everything right on the first pass, so don't worry
   about asking questions in the PR thread.

## Style

- Match the conventions already used in the file/package you're touching.
- No need to fix unrelated issues in the same PR — feel free to mention them
  in a comment or a separate issue instead.
- ESLint and Prettier are configured at the repo root; `pnpm lint` will catch
  most style issues automatically.

## Questions?

Open a [discussion or issue](../../issues) — there's no such thing as a
question too basic to ask.
