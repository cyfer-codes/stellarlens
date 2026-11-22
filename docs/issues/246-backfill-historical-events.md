# #246: Backfill historical events for newly registered contracts

**Area:** indexer, db · **Complexity:** high

## Problem

The indexer keeps one cursor per network (`indexer_checkpoints`, keyed by `network`). When there's no
stored cursor, [`processEventsBatch`](../../apps/indexer/src/events.ts) starts at `getLatestLedger()`.
After that it follows the cursor forward. A contract registered today therefore gets events only from
the network's current position. Everything it emitted before registration is never indexed, even when
Soroban RPC still holds those events.

Users expect recent history to show up after they register a contract, at least as far back as RPC
retention goes.

## Goals

1. Registration accepts an optional `startLedger`. Without one, the indexer backfills a default window.
2. Each contract's backfill has its own progress cursor, stored separately from the network cursor.
   A backfill never blocks or delays live polling.
3. Backfilled events go through the same decode, transfer-detection and dedupe code as live events.
4. Webhooks don't fire for backfilled events unless the registration opts in.
5. Tests cover backfill progress, resuming after a restart, and the no-webhook default.

## Non-goals

- Backfilling older than RPC retention. Archive or Horizon history is out of scope.
- Re-backfilling a contract that is already registered. A later issue could add a re-backfill endpoint.
- Changing how the live cursor works.

## Current behaviour (what to change)

| Piece | Today | File |
| --- | --- | --- |
| Live cursor | One row per network: `cursor`, `latestLedger` | [`indexerCheckpoints.ts`](../../packages/db/src/schema/indexerCheckpoints.ts) |
| First poll | `startLedger = getLatestLedger().sequence` | [`events.ts`](../../apps/indexer/src/events.ts) |
| RPC filter | `{ type: "contract" }` with no `contractIds`, so all contract events on the network | `events.ts` |
| Registration | `registerContract(db, { address, name, network })` | [`registry.ts`](../../apps/indexer/src/registry.ts), [`server.ts`](../../apps/indexer/src/server.ts) |
| Transfer dedupe | `token_transfers.rpc_event_id` unique index + `onConflictDoNothing` | [`tokenTransfers.ts`](../../packages/db/src/schema/tokenTransfers.ts) |
| Event dedupe | **None.** `events` has no unique key, so a reprocessed range inserts duplicate rows | [`events.ts` schema](../../packages/db/src/schema/events.ts) |
| Webhooks | Fired for every inserted event after the transaction commits | `events.ts` → `deliverWebhooksForEvent` |

The missing event dedupe has to be fixed first. A backfill's end overlaps the range the live loop
has already indexed, so without dedupe that overlap produces duplicate events.

## Design

### 1. Schema

**Event dedupe.** Add an `rpc_event_id` column to `events` with a unique index on
`(contract_id, rpc_event_id)`. Fill it in from `decoded_data->>'id'` in the migration. Inserts use
`onConflictDoNothing().returning(...)`. When no row comes back, the event was already stored, so skip
transfer detection and webhooks for it.

**Backfill state.** Add a new table, `contract_backfills`, one row per contract:

```ts
// packages/db/src/schema/contractBackfills.ts
export const contractBackfills = pgTable("contract_backfills", {
  contractId: integer("contract_id").primaryKey().references(() => contracts.id, { onDelete: "cascade" }),
  startLedger: integer("start_ledger").notNull(),   // first ledger requested (after clamping to retention)
  endLedger: integer("end_ledger").notNull(),       // live checkpoint's latestLedger at registration
  cursor: text("cursor"),                           // RPC paging cursor; null = not started
  status: text("status").notNull().default("pending"), // pending | running | done | failed
  notifyWebhooks: boolean("notify_webhooks").notNull().default(false),
  indexedCount: integer("indexed_count").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});
```

This is a separate table, not extra rows in `indexer_checkpoints`. The live checkpoint is keyed by
`network`, and mixing per-contract rows into it would complicate the api's
`GET /contracts/:id/status` lookup, which reads that table by network.

### 2. Registration

`registerContract` and the registry `POST` body take two optional fields:

| Field | Type | Default |
| --- | --- | --- |
| `startLedger` | positive integer | `latestLedger - BACKFILL_DEFAULT_LEDGERS` |
| `backfillWebhooks` | boolean | `false` |

Registration does the following:

1. Validates `startLedger` locally: it must be a positive integer and not greater than the latest ledger.
2. Clamps it to RPC's oldest retained ledger. If it was clamped, the response says so with
   `backfill.clamped: true`.
3. Sets `endLedger` to the live checkpoint's `latestLedger`. If there's no live checkpoint yet, it uses
   `getLatestLedger()`.
4. Inserts the `contracts` row and the `contract_backfills` row in one transaction.

The response gains a `backfill` object: `{ startLedger, endLedger, status }`.

The api's `CreateContractDto` (`apps/api/src/contracts/dto/create-contract.dto.ts`) needs the same two
optional fields. A follow-up should expose backfill progress on `GET /contracts/:id/status`.

New indexer config in [`config.ts`](../../apps/indexer/src/config.ts):

| Env var | Default | Meaning |
| --- | --- | --- |
| `BACKFILL_DEFAULT_LEDGERS` | `17280` (~24h at 5s ledgers) | Window used when `startLedger` is omitted. `0` disables the default backfill. |
| `BACKFILL_BATCH_LIMIT` | `100` | Events per `getEvents` call for backfill. |
| `BACKFILL_MAX_BATCHES_PER_TICK` | `1` | How many backfill pages to process per poll cycle. |

### 3. Shared ingest path

Move the body of the `db.transaction(...)` loop in `processEventsBatch` into a shared function:

```ts
export async function ingestEvents(
  tx: Transaction,
  events: RawEvent[],
  registeredContracts: Map<string, number>
): Promise<WebhookEventPayload[]>   // payloads for newly inserted events only
```

The live path and the backfill path both call it, so decode, `decodeErrors`, transfer detection and
dedupe stay in one place. Each caller decides what to do with the returned payloads.

### 4. Backfill loop

Add `processBackfillBatch(db, server)` in a new `apps/indexer/src/backfill.ts`:

1. Pick the oldest row with `status in ('pending', 'running')`.
2. Call `getEvents` with `filters: [{ type: "contract", contractIds: [address] }]`. Use `cursor` when it
   is set, otherwise `startLedger`.
3. Keep only events with `ledger <= endLedger`, and run them through `ingestEvents` inside one
   transaction.
4. In the same transaction, save the new `cursor` and `indexedCount`, and set `status = 'running'`.
   Saving the cursor in the same transaction as the inserts is what makes a restart resume safely.
5. Set `status = 'done'` when the page has events past `endLedger`, when the response's `latestLedger`
   passes `endLedger`, or when an empty page comes back after `endLedger`.
6. After the commit, deliver the payloads only if `notifyWebhooks` is true.
7. On an RPC error that `withRetry` couldn't recover from, save `lastError` and leave the row
   `running`, so the next tick retries it. If the start ledger has fallen out of retention, re-clamp
   once. If it still fails, mark the row `failed`.

In [`index.ts`](../../apps/indexer/src/index.ts), each poll cycle runs the live batch first and then up
to `BACKFILL_MAX_BATCHES_PER_TICK` backfill batches. Each one has its own `try/catch`, so a backfill
failure never skips or delays the next live poll. A separate interval loop would also work, but running
both in sequence keeps the RPC request rate predictable and avoids two writers racing on the same
contract.

### 5. Why the ranges join cleanly

```
ledger ──────────────────────────────────────────────────────────▶
          startLedger                endLedger (live latestLedger at registration)
backfill  [=============================]
live                                  [==============================▶
                                   ▲
                       overlap deduped by (contract_id, rpc_event_id)
```

Live polling already covers everything after registration. The backfill stops at `endLedger`, and the
unique index absorbs any overlap. So the result has no gaps and no duplicate events, transfers or
webhook deliveries.

### 6. Ordering caveat

Backfilled events get `events.id` values higher than live events that were indexed earlier. Event ids
are `bigserial`. Anything that uses `id` as a time-ordered cursor (`events tail`, `export --resume`,
SDK `watchEvents`) will **not** see backfilled events that land behind its cursor. That is acceptable
for this issue. Document it in the api's events docs. If it becomes a problem, ledger-ordered cursors
are a separate change.

## Test plan (`apps/indexer/test/backfill.test.ts`)

Use the existing RPC mocks in `apps/indexer/test/rpc-mocks.ts`.

| Test | Asserts |
| --- | --- |
| progresses across batches | Two mocked pages: the cursor is saved after page 1, `indexedCount` adds up, `status` goes `pending → running → done`. |
| resumes after a restart | Run one batch, build a fresh `db` handle, run again: the second `getEvents` uses the stored `cursor`, not `startLedger`, and no event is inserted twice. |
| stops at endLedger | Events with `ledger > endLedger` are not inserted by the backfill. |
| dedupes the overlap with live | The same RPC event comes from both paths: one `events` row, one `token_transfers` row. |
| no webhooks by default | A webhook is registered for the contract: no `fetch` call and no `webhook_deliveries` rows after a backfill. |
| webhooks when opted in | `notifyWebhooks: true`: one delivery per newly inserted event. |
| never blocks live polling | The backfill `getEvents` rejects: the live `processEventsBatch` still advances the network cursor. |
| default window & clamping | No `startLedger`: `latestLedger - BACKFILL_DEFAULT_LEDGERS`. Too-old `startLedger`: clamped, `clamped: true`. |

Also update `registry.test.ts` and `server.test.ts` for the new body fields and validation errors.

## Rollout

1. Migration: add `events.rpc_event_id`, fill it in, add the unique index, create `contract_backfills`.
   Contracts that already exist get no backfill row.
2. Ship the `ingestEvents` refactor with no behaviour change. The existing `events.test.ts` must still pass.
3. Ship registration fields, the backfill loop and the tests.
4. Update [`docs/webhooks.md`](../webhooks.md): backfilled events are not delivered by default.
