# apps/api

NestJS REST API for stellarlens. Exposes contracts, events, transfers, stats, webhooks, and API key
management, all gated by `x-api-key` authentication.

## Running locally

```bash
# From the repo root — starts the API in watch mode on :3000
pnpm --filter @stellarlens/api dev

# Or build and run the compiled output
pnpm --filter @stellarlens/api build
pnpm --filter @stellarlens/api start
```

Swagger UI is available at `http://localhost:3000/docs` in non-production environments
(`NODE_ENV !== "production"`). The raw OpenAPI JSON is at `/docs-json`.

## Environment variables

Copy `.env.example` from the repo root and fill in the required values before starting.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string, e.g. `postgres://user:pass@localhost:5433/stellarlens` |
| `REDIS_URL` | | — | Redis connection URL, e.g. `redis://localhost:6379`. Backs the throttler with Redis for distributed rate limiting across instances; falls back to in-memory storage when unset. |
| `PORT` | | `3000` | Port the API listens on |
| `CORS_ORIGINS` | | _(disabled)_ | Comma-separated list of origins allowed to make cross-origin requests. Leave unset to block all cross-origin access. |
| `NODE_ENV` | | — | Set to `production` to disable Swagger UI |
| `INDEXER_STALE_AFTER_SECONDS` | | `60` | Seconds after which a missing indexer checkpoint is considered stale (used by `GET /health/ready`) |
| `INDEXER_DEGRADED_RETURNS_503` | | `true` | Set to `false` or `200` to have `GET /health/ready` return HTTP 200 even when the indexer is stale |
| `ALLOW_INSECURE_WEBHOOK_URLS` | | — | Set to `true` to allow `http://` webhook URLs. Leave unset in production. |
| `EVENTS_STREAM_POLL_INTERVAL_MS` | | — | How often the SSE stream polls for new events |
| `EVENTS_STREAM_HEARTBEAT_INTERVAL_MS` | | — | Interval between SSE heartbeat comments |
| `EVENTS_STREAM_MAX_PER_KEY` | | — | Maximum concurrent SSE connections per API key |

## Endpoints

All routes except `GET /health` and `GET /health/ready` require an `x-api-key` header.
Routes marked **full scope** additionally require a key with `full` scope.

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | public | Liveness probe. Returns `{ status: "ok" }`. |
| `GET` | `/health/ready` | public | Readiness probe. Checks database connectivity and indexer checkpoint freshness. Returns `{ status: "ok" \| "degraded", indexer: { status, lastCheckpointAt, lagSeconds, threshold } }`. Returns 503 when degraded unless `INDEXER_DEGRADED_RETURNS_503=false`. |

### Contracts

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/contracts` | x-api-key | Register a single contract by address. |
| `POST` | `/contracts/bulk` | x-api-key | Register multiple contracts in one request. |
| `GET` | `/contracts` | x-api-key | List all registered contracts (paginated). |
| `GET` | `/contracts/:id` | x-api-key | Fetch a single contract by internal ID. |
| `GET` | `/contracts/:id/status` | x-api-key | Fetch the indexing status of a contract. |
| `PATCH` | `/contracts/:id` | x-api-key | Update a contract's label or other metadata. |

### Events

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/contracts/:contractId/events` | x-api-key | Paginated list of events for a contract, newest first. |
| `GET` | `/contracts/:contractId/events/stream` | x-api-key | Server-sent events (SSE) stream of new events for a contract. Resume from a known event with the `Last-Event-ID` header or `?lastEventId=` query parameter. |

### Transfers

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/contracts/:contractId/transfers` | x-api-key | Paginated list of SEP-41 token transfers for a contract. |
| `GET` | `/contracts/:contractId/stats` | x-api-key | Aggregate transfer stats for a contract. |
| `GET` | `/contracts/:contractId/stats/volume` | x-api-key | Transfer volume over time for a contract. |
| `GET` | `/contracts/:contractId/stats/top-accounts` | x-api-key | Top sender/receiver accounts for a contract. |
| `GET` | `/accounts/:address/transfers` | x-api-key | All transfers involving a given Stellar account address. |

### Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/contracts/:contractId/webhooks` | x-api-key | Register a webhook URL for a contract. |
| `GET` | `/contracts/:contractId/webhooks` | x-api-key | List all webhooks for a contract. |
| `GET` | `/contracts/:contractId/webhooks/:id` | x-api-key | Fetch a single webhook. |
| `PATCH` | `/contracts/:contractId/webhooks/:id` | x-api-key | Update a webhook (URL, enabled state, etc.). |
| `DELETE` | `/contracts/:contractId/webhooks/:id` | x-api-key | Remove a webhook. Returns 204. |
| `GET` | `/contracts/:contractId/webhooks/:id/deliveries` | x-api-key | Paginated delivery history for a webhook. |
| `GET` | `/contracts/:contractId/webhooks/:id/stats` | x-api-key | Delivery success/failure stats for a webhook. `?window=24h` (default) or other duration. |
| `POST` | `/contracts/:contractId/webhooks/:id/rotate-secret` | x-api-key | Rotate the signing secret for a webhook. |

### API Keys

All API key routes require **full scope**.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api-keys` | x-api-key (full) | Generate a new API key. |
| `GET` | `/api-keys` | x-api-key | List all API keys. |
| `PATCH` | `/api-keys/:id` | x-api-key (full) | Update an API key (label, scope, rate limit). |
| `POST` | `/api-keys/:id/rotate` | x-api-key (full) | Rotate an API key. Accepts an optional `{ gracePeriodMs }` body to keep the old key valid briefly. |
| `DELETE` | `/api-keys/:id` | x-api-key (full) | Revoke an API key. Returns 204. |

## See also

- [docs/webhooks.md](../../docs/webhooks.md) — webhook delivery semantics, retries, signature verification
- Root [README.md](../../README.md) — full monorepo setup, Docker, architecture diagram
