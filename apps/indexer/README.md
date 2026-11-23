# @stellarlens/indexer

Polls Soroban RPC for new contract events, decodes them, persists them to Postgres, and
fires signed webhooks for anything you've registered. This page documents every knob in
[`src/config.ts`](src/config.ts) and how the polling loop fits together. Signature/URL
details for the webhooks themselves live in [`docs/webhooks.md`](../../docs/webhooks.md).

## The loop

One iteration of the daemon (see [`src/index.ts`](src/index.ts) and
[`src/events.ts`](src/events.ts)):

1. **Poll** — `processEventsBatch` calls Soroban RPC's `getEvents` starting from the
   persisted checkpoint cursor, fetching up to `EVENTS_BATCH_LIMIT` events in one request.
2. **Decode** — each RPC event is decoded into a row for the `events` table plus any
   `token_transfers` rows derived from it (`@stellarlens/decode`).
3. **Persist** — events, transfers and the advanced checkpoint cursor are written in a
   single database transaction, so a crash can never leave the cursor ahead of the data.
4. **Deliver webhooks** — only after the transaction commits, each event is matched
   against active webhooks (contract + event types) and delivered in ledger order, with
   up to `WEBHOOK_CONCURRENCY` deliveries in flight per event.

By default the process runs this loop forever, sleeping `POLL_INTERVAL_MS` between
cycles, and starts a small registry HTTP server (`REGISTRY_PORT`) alongside it. Set
`POLL_ONCE=true` to run exactly one cycle and exit without starting the registry server
— handy for cron-style operation and for tests.

Failed poll cycles are logged and retried on the next cycle; they never crash the daemon.

## Environment variables

Loaded from `.env` via `dotenv` (see the repository root [`.env.example`](../../.env.example)).

| Variable | Required | Default | What it does / misconfiguration behaviour |
|---|---|---|---|
| `SOROBAN_RPC_URL` | yes | — | Soroban RPC endpoint to poll. Throws at startup if missing or empty. |
| `STELLAR_NETWORK` | yes | — | One of `testnet`, `futurenet`, `mainnet`, `standalone`. Any other value throws at startup. |
| `DATABASE_URL` | yes | — | Postgres connection string (used by `@stellarlens/db`). |
| `REGISTRY_PORT` | no | `3002` | Port for the built-in registry HTTP server (`GET /health`, `POST /contracts`). Note: `Number(...)` is used, so a non-numeric value yields `NaN` and the server won't listen — use a plain integer. |
| `POLL_INTERVAL_MS` | no | `5000` | Sleep between poll cycles. Must be a positive integer; anything else (non-numeric, `0`, negative) throws at startup. |
| `EVENTS_BATCH_LIMIT` | no | `100` | Max events fetched from Soroban RPC per poll cycle. Must be a positive integer, but unlike the other knobs it **never throws**: missing, empty, whitespace-only or non-integer values (`abc`, `10.5`, `0`, `-5`) silently fall back to `100`, so a bad batch size can't break polling. |
| `WEBHOOK_CONCURRENCY` | no | `10` | Max simultaneous webhook deliveries per event. Must be a positive integer; otherwise throws at startup. |
| `POLL_ONCE` | no | `false` | Only the exact string `true` enables one-shot mode (process one batch, exit, skip registry server). |

## Hardcoded constants

These are compile-time constants in [`src/config.ts`](src/config.ts) — changing them
means editing the file (no env var today):

| Constant | Value | Used by | Meaning |
|---|---|---|---|
| `MAX_RETRIES` | `5` | [`src/retry.ts`](src/retry.ts) | Attempts for transient RPC/database operations. |
| `RETRY_BASE_DELAY_MS` | `1000` | `retry.ts` | First retry delay; doubles each attempt. |
| `RETRY_MAX_DELAY_MS` | `30000` | `retry.ts` | Ceiling for the exponential backoff. |
| `WEBHOOK_MAX_RETRIES` | `3` | [`src/webhooks.ts`](src/webhooks.ts) | Attempts per delivery before the delivery is marked failed (attempts 1 + 3 retries). |
| `WEBHOOK_RETRY_BASE_DELAY_MS` | `500` | `webhooks.ts` | First backoff between delivery attempts (500ms / 1s / 2s). |
| `WEBHOOK_RETRY_MAX_DELAY_MS` | `5000` | `webhooks.ts` | Ceiling for the delivery backoff. |
| `WEBHOOK_TIMEOUT_MS` | `5000` | `webhooks.ts` | Abort signal timeout for a single delivery attempt. |
| `STELLAR_NETWORKS` | `testnet, futurenet, mainnet, standalone` | `config.ts` | The allow-list validated against `STELLAR_NETWORK`. |

## Scripts

Run from the repository root (pnpm workspace):

```bash
pnpm --filter @stellarlens/indexer dev       # tsx watch src/index.ts
pnpm --filter @stellarlens/indexer build     # tsc -b
pnpm --filter @stellarlens/indexer start     # node dist/index.js (after build)
pnpm --filter @stellarlens/indexer test      # vitest run
pnpm --filter @stellarlens/indexer typecheck # tsc --noEmit -p tsconfig.test.json
pnpm --filter @stellarlens/indexer lint      # eslint .
```

## Registry server

Outside `POLL_ONCE` mode the indexer also listens on `REGISTRY_PORT` (default `3002`)
with a minimal HTTP surface used by local tooling:

- `GET /health` → `200 { "status": "ok" }`
- `POST /contracts` → registers a contract in the database (`201` on success, `400` on
  an invalid body)
- anything else → `404`

The public, authenticated contract/webhook API is the separate NestJS app in
[`apps/api`](../api) — see [`docs/api.md`](../../docs/api.md).
