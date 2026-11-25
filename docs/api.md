# API reference

REST API for the stellarlens indexer. Every route below is declared by a controller in
[`apps/api/src`](../apps/api/src); this document is hand-written and kept in sync with that source.

- **Base URL:** `http://localhost:3000` (or `PORT`), no global path prefix — paths are `/contracts`,
  `/events`, … exactly as shown below.
- **Interactive docs:** `GET /docs` (Swagger UI) and `GET /docs-json` (spec), only when
  `NODE_ENV !== "production"`.
- **Spec snapshot:** [`apps/api/openapi.json`](../apps/api/openapi.json) is generated and lags behind
  the controllers — see [Known gaps](#known-gaps).

## Authentication

All routes require an API key in the `x-api-key` header, except `GET /health` and `GET /health/ready`.

```http
x-api-key: <key>
```

| Situation | Status | Message |
|---|---|---|
| Header missing/empty | 401 | `missing x-api-key header` |
| Unknown, expired, or malformed key | 401 | `invalid api key` |
| `read`-scope key on `POST`/`PATCH`/`PUT`/`DELETE` | 403 | `read-only api key cannot perform mutating requests` |
| Key without `full` scope on a `full`-only route | 403 | `api key requires the "full" scope` |

**Scopes** (`read` | `full`):

- `read` — read-only routes; rejected on any mutating method.
- `full` — everything, plus the `full`-only routes: `POST /api-keys`, `PATCH /api-keys/:id`,
  `POST /api-keys/:id/rotate`, `DELETE /api-keys/:id`.

**Rate limiting:** 100 requests/minute by default, counted per API key (or per client IP for the
public health routes). A key's `rateLimitPerMinute` overrides the default. Exceeding it returns
**429** with a `Retry-After` header (seconds).

## Errors

Errors use one envelope:

```json
{
  "statusCode": 404,
  "message": "contract 42 not found",
  "error": "Not Found",
  "requestId": "3f2b…"
}
```

- `message` is a string, or an array of strings for validation failures.
- `requestId` echoes your `X-Request-Id` request header when you send one, otherwise a generated
  UUID. The same value is always returned in the `X-Request-Id` response header and in the API's
  JSON request logs.
- Bodies are validated with `whitelist` + `transform`: unknown fields are stripped, query strings
  are coerced to numbers. Invalid input → **400** with `message` as an array.

## Pagination

Cursor-based. Pass the previous response's `nextCursor` as `cursor`; `nextCursor: null` means the
last page. `limit` is `1`–`100`, default `20` unless noted. Pages are stable (ordered by `id`).

---

## Health (public)

### `GET /health`

```json
{ "status": "ok" }
```

### `GET /health/ready`

Checks the database and indexer freshness:

- Database unreachable → **503** `{ "status": "error" }`
- Latest indexer checkpoint older than `INDEXER_STALE_AFTER_SECONDS` (default `60`), or no
  checkpoint at all → `indexer.status: "degraded"` and **503** by default. Set
  `INDEXER_DEGRADED_RETURNS_503` (or the legacy `HEALTH_DEGRADED_STATUS`) to `200`, `false`, or `0`
  to return **200** instead; anything else keeps 503.

```json
{
  "status": "ok",
  "indexer": {
    "status": "ok",
    "lastCheckpointAt": "2026-11-22T10:00:00.000Z",
    "lagSeconds": 4,
    "threshold": 60
  }
}
```

---

## Contracts

### `POST /contracts` · full scope

Registers one contract. `address` must be a valid Stellar strkey (`G…`/`C…`, 56 chars).

```json
{ "address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4", "network": "testnet", "name": "My Token" }
```

| Field | Required | Notes |
|---|---|---|
| `address` | yes | validated strkey |
| `network` | yes | non-empty string (`mainnet`, `testnet`, `futurenet`, `custom`) |
| `name` | no | human-readable label |

**201** with the contract. Re-registering an existing address updates `name`/`network` and returns
the existing row (upsert, not an error).

### `POST /contracts/bulk` · full scope

Registers 1–100 contracts in one request.

```json
{ "items": [ { "address": "C…", "network": "testnet", "name": "A" } ] }
```

The envelope is validated (400 if `items` is empty or has more than 100 entries); per-item problems
are reported as results rather than failing the batch.

**201:**

```json
{
  "results": [
    { "index": 0, "address": "C…", "network": "testnet", "name": "A", "status": "created", "id": 7 },
    { "index": 1, "address": "C…", "network": "testnet", "name": "B", "status": "error", "error": "…" }
  ]
}
```

`status` is `created`, `existing` (already registered, left untouched), or `error`.

### `GET /contracts`

| Query | Default | Notes |
|---|---|---|
| `cursor` | — | contract id to start after |
| `limit` | `20` | `1`–`100` |
| `name` | — | case-insensitive substring match |
| `network` | — | exact match |
| `include` | — | relations to include; `activity` adds `eventCount`, `transferCount`, and `lastEventAt` |
| `order` | `asc` | `asc` or `desc` |

**200:** `{ "data": Contract[], "nextCursor": number | null }`

When `?include=activity` is specified, each item in `data` includes an activity summary:

```json
{
  "id": 7,
  "address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "name": "My Token",
  "network": "testnet",
  "decimals": 7,
  "symbol": "TOKEN",
  "eventCount": 42,
  "transferCount": 18,
  "lastEventAt": "2026-11-22T10:00:00.000Z"
}
```

### `GET /contracts/:id`

**200** with the contract, **404** if unknown.

```json
{ "id": 7, "address": "C…", "name": "My Token", "network": "testnet", "decimals": 7, "symbol": "TOKEN" }
```

`decimals` and `symbol` come from SEP-41 metadata cached by the indexer; both are `null` for
non-token contracts or before the contract is indexed.

### `GET /contracts/:id/status`

Indexing status for the contract's network:

```json
{ "status": "not_indexed", "lag": null }
```

when no checkpoint exists for the network, otherwise:

```json
{ "status": "live", "lag": 0, "latestLedger": 123456, "indexedLedger": 123456, "updatedAt": "2026-11-22T10:00:00.000Z" }
```

`status` is `behind` instead of `live` when the checkpoint is older than 120s or `lag > 0`.
`lag` is `latestLedger - indexedLedger` (never negative, `0` when either side is unknown).

### `PATCH /contracts/:id` · full scope

Body: `{ "name"?: string, "network"?: string }`. With no fields it is a no-op and returns the
contract unchanged. **200** with the contract, **404** if unknown.

---

## Events

An event row:

```json
{
  "id": 9001,
  "contractId": 7,
  "ledger": 123456,
  "txHash": "abc…",
  "topic": "[\"transfer\",\"G…\",\"G…\"]",
  "decodedData": {
    "id": "0001234-0000000001",
    "type": "contract",
    "ledgerClosedAt": "2026-11-22T10:00:00.000Z",
    "inSuccessfulContractCall": true,
    "raw": { "topic": ["…"], "value": "AAAA…" },
    "decoded": { "topic": ["transfer", "G…", "G…"], "value": { "from": "G…" } },
    "decodeErrors": [ { "field": "value", "error": "…" } ]
  },
  "ledgerClosedAt": "2026-11-22T10:00:00.000Z",
  "createdAt": "2026-11-22T10:00:05.000Z"
}
```

`topic` is a JSON-encoded string of the raw topics; `decodedData.raw` holds the raw XDR,
`decodedData.decoded` the decoded values, and `decodeErrors` is present only when decoding failed
partially. `decodeErrors`/`decodedData` may be absent or `null` for undecoded events.

### `GET /events`

Most recent events across all contracts.

| Query | Default | Notes |
|---|---|---|
| `limit` | `20` | `1`–`100` |

**200** — a **plain array** (not a page envelope), newest first (ledger desc, then id desc):

```json
[ { "id": 9001, "contractId": 7, "contractName": "My Token", "ledger": 123456, "…": "…" } ]
```

`contractName` is the registered name (`null` when unset).

### `GET /contracts/:contractId/events`

Paginated events for one contract (**404** if the contract is unknown).

| Query | Default | Notes |
|---|---|---|
| `cursor` | — | event id to start after |
| `limit` | `20` | `1`–`100` |
| `order` | `asc` | `asc` = oldest first (cursor moves forward); `desc` = newest first (cursor moves backward). `order=desc&limit=1` returns the latest event. |
| `topic` | — | matches at **any** position of the decoded topic array (JSONB containment) |
| `topic0`…`topic3` | — | exact match at a specific decoded topic index |
| `topics` | — | matches **any** of several values; repeated params or comma-separated (`?topics=transfer,mint`) |
| `from`, `to` | — | ISO 8601 bounds on `ledgerClosedAt` |

**200:** `{ "data": Event[], "nextCursor": number | null }` — rows here have no `contractName`.

### `GET /contracts/:contractId/events/stream` (SSE)

Server-sent events stream of newly observed events for one contract.

- `Content-Type: text/event-stream`; heartbeats keep the connection alive.
- Resume: `Last-Event-ID` request header, or `lastEventId` query parameter.
- Limits per API key (env vars): `EVENTS_STREAM_MAX_PER_KEY` (default `5` concurrent streams —
  exceeding it fails the request), `EVENTS_STREAM_POLL_INTERVAL_MS` (default `1000`),
  `EVENTS_STREAM_HEARTBEAT_INTERVAL_MS` (default `15000`).

---

## Transfers

A transfer row:

```json
{
  "id": 500,
  "contractId": 7,
  "from": "G…",
  "to": "G…",
  "amount": "1000000000",
  "asset": "CCONTRACT…",
  "txHash": "abc…",
  "ledger": 123456,
  "rpcEventId": "0001234-0000000001",
  "ledgerClosedAt": "2026-11-22T10:00:00.000Z",
  "createdAt": "2026-11-22T10:00:05.000Z"
}
```

`amount` is a decimal string in the token's base units (i128 — do not parse with `Number`).

### `GET /contracts/:contractId/transfers`

| Query | Default | Notes |
|---|---|---|
| `cursor` | — | transfer id to start after |
| `limit` | `20` | `1`–`100` |
| `minAmount`, `maxAmount` | — | integer decimal strings in base units; `minAmount > maxAmount` → 400 |
| `from`, `to` | — | filter by sender / recipient address |
| `asset` | — | exact asset match |

**200:** `{ "data": Transfer[], "nextCursor": number | null }`, ordered by id ascending.
**404** if the contract is unknown.

### `GET /transfers`

Transfer history for an account across **all** contracts.

| Query | Default | Notes |
|---|---|---|
| `address` | — | **required**; matches rows where the account is sender *or* recipient |
| `cursor` | — | transfer id to start after |
| `limit` | `20` | `1`–`100` |

**200:** `{ "data": Transfer[], "nextCursor": number | null }`

### `GET /accounts/:address/transfers`

Same history, scoped by path, with a direction filter. The address must be a valid Stellar strkey,
otherwise **400** `Invalid Stellar address`.

| Query | Default | Notes |
|---|---|---|
| `direction` | `both` | `in` (received), `out` (sent), `both` |
| `cursor` | — | transfer id to start after |
| `limit` | `20` | `1`–`100` |
| `order` | `asc` | accepted but **not applied** — results are always id ascending |

**200:** `{ "data": Transfer[], "nextCursor": number | null }`

---

## Stats

All stats routes **404** if the contract is unknown. `from`/`to` are ISO 8601 bounds on
`ledgerClosedAt`.

### `GET /contracts/:contractId/stats`

```json
{
  "transferCount": 128,
  "uniqueSenders": 42,
  "uniqueReceivers": 39,
  "volumeByAsset": [ { "asset": "CCONTRACT…", "volume": "1000000000" } ]
}
```

`volume` values are decimal strings in base units.

### `GET /contracts/:contractId/stats/volume`

| Query | Default | Notes |
|---|---|---|
| `interval` | `day` | `hour` or `day` |
| `from`, `to` | — | range; a range wider than 1000 buckets → 400 |
| `asset` | — | restrict to one asset |

**200:** array ordered by bucket ascending; empty buckets are **omitted**, not zero-filled (zero-fill
client-side if you need a continuous series):

```json
[ { "bucket": "2026-11-22T00:00:00.000Z", "volume": "1000000000", "count": 12 } ]
```

### `GET /contracts/:contractId/stats/top-accounts`

| Query | Default | Notes |
|---|---|---|
| `direction` | `from` | rank senders (`from`) or recipients (`to`) |
| `limit` | `10` | `1`–`100` |
| `from`, `to` | — | range |

**200:** ordered by volume descending:

```json
[ { "account": "G…", "volume": "1000000000", "count": 12 } ]
```

---

## API keys

Raw keys are shown **once**, on creation and rotation, and never again — store them immediately.
Keys are compared in constant time against a SHA-256 hash.

### `POST /api-keys` · full scope

| Field | Default | Notes |
|---|---|---|
| `name` | `null` | label |
| `scope` | `full` | `full` or `read` |
| `expiresAt` | `null` | ISO 8601 |
| `rateLimitPerMinute` | `null` (= 100) | integer ≥ 1 |

**201:**

```json
{
  "id": 3,
  "name": "CI pipeline key",
  "scope": "read",
  "createdAt": "2026-11-22T10:00:00.000Z",
  "expiresAt": null,
  "rateLimitPerMinute": null,
  "key": "9f2c…"
}
```

### `GET /api-keys`

Any valid key may list keys (read-only output, no raw secrets), newest first:

```json
[ { "id": 3, "name": "CI pipeline key", "scope": "read", "createdAt": "…", "revokedAt": null, "rateLimitPerMinute": null } ]
```

### `PATCH /api-keys/:id` · full scope

Body (all optional):

- `name`, `scope` — updated as given.
- `expiresAt` — future ISO 8601 timestamp; `null` clears expiry. Past or unparseable → 400.
- `rateLimitPerMinute` — integer ≥ 1.

**200** with the updated key (no raw secret). **404** unknown, **409** already revoked.

### `POST /api-keys/:id/rotate` · full scope

Issues a new raw key; the old key keeps working for a grace period, then stops.

| Field | Default | Notes |
|---|---|---|
| `gracePeriodMs` | `86400000` (24h) | positive finite number; otherwise 400 |

**201** with the new key's fields plus `key` (raw, shown once). The previous key's `expiresAt` is set
to now + grace, so it expires on its own.

**404** unknown, **409** already revoked, **403** if the target key is not `full` scope
(`only full-scope api keys can be rotated`).

### `DELETE /api-keys/:id` · full scope

**204**. Idempotent: revoking an already-revoked key also returns 204; unknown id → 404.

---

## Webhooks

Full payload/signature documentation lives in [webhooks.md](webhooks.md); this section covers the
management routes.

### `POST /contracts/:contractId/webhooks` · mutating

```json
{ "url": "https://example.com/hooks", "eventTypes": ["transfer"] }
```

`eventTypes` omitted (or empty) means all events. `url` must be a valid URL.

**201** with the webhook **including its `secret`** (shown once):

```json
{ "id": 1, "contractId": 7, "url": "https://example.com/hooks", "secret": "whsec_…", "eventTypes": ["transfer"], "active": true, "createdAt": "…" }
```

**404** unknown contract, **409** a webhook with that URL already exists for the contract.

### `GET /contracts/:contractId/webhooks`

```json
[ { "id": 1, "url": "https://example.com/hooks", "eventTypes": ["transfer"], "createdAt": "…" } ]
```

Secrets are never returned here.

### `PATCH /contracts/:contractId/webhooks/:id` · mutating

Body: `{ "url"?: string, "eventTypes"?: string[] }`. An empty `eventTypes` array resets it to "all
events". Unknown fields are stripped.

**200:** `{ "id": 1, "contractId": 7, "url": "…", "eventTypes": null, "createdAt": "…" }` (no secret).
**404** unknown, **409** URL already used by another webhook on the contract.

### `DELETE /contracts/:contractId/webhooks/:id` · mutating

**204**. **404** unknown or belonging to another contract. Also removes the delivery history.

### `GET /contracts/:contractId/webhooks/:id/deliveries`

| Query | Default | Notes |
|---|---|---|
| `limit` | `20` | `1`–`100` |
| `cursor` | — | delivery id to start after |
| `status` | — | `pending`, `delivered`, or `failed` |
| `from`, `to` | — | ISO 8601 bounds on `createdAt` |

**200:** `{ "data": Delivery[], "nextCursor": number | null }`, newest first:

```json
{
  "id": 125,
  "eventId": 9001,
  "status": "failed",
  "attempts": 4,
  "lastError": "webhook responded with status 503",
  "deliveredAt": null,
  "createdAt": "2026-11-22T10:02:11.481Z"
}
```

**404** if the webhook does not belong to the contract.

### `GET /contracts/:contractId/webhooks/:id/stats`

| Query | Default | Notes |
|---|---|---|
| `window` | `24h` | `\d+[smhd]`, e.g. `30m`, `7d`; anything else → 400 |

```json
{
  "total": 10,
  "success": 8,
  "failed": 2,
  "successRate": 0.8,
  "lastSuccessAt": "2026-11-22T10:00:00.000Z",
  "lastFailureAt": "2026-11-22T09:55:00.000Z",
  "consecutiveFailures": 0
}
```

**404** unknown webhook or contract.

### `POST /contracts/:contractId/webhooks/:id/rotate-secret` · mutating

**201** with a **new `secret`** (shown once). The old secret stops working immediately — there is no
overlap window, so update your endpoint's copy promptly.

---

## Known gaps

Documented here because they are visible in the source today; they are pre-existing issues, not
introduced by this document.

- **`openapi.json` is stale** — it is missing `GET /contracts/:id/status`,
  `GET /contracts/:contractId/stats/volume`, `…/stats/top-accounts`, `GET /events`,
  `GET /contracts/:contractId/events/stream`, `GET /transfers`,
  `GET /accounts/:address/transfers`, `GET /contracts/:contractId/webhooks/:id/stats`,
  `PATCH /api-keys/:id`, and `POST /api-keys/:id/rotate`. Treat the controllers (and this document)
  as authoritative; regenerate the spec to refresh it.
- **Delivery status values** — the indexer records deliveries as `success`/`failed`
  (see [webhooks.md](webhooks.md)), while the `status` query filter and the stats query use
  `delivered`. Filtering `status=delivered` therefore does not match indexer-written rows.
- **Accepted-but-ignored query params** — `order` on `GET /contracts` and on
  `GET /accounts/:address/transfers` is validated but not applied.
