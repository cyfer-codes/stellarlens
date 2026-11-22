# #248: Store ledger close time as a real column on `events` and `token_transfers`

## Problem

Charts and range filters need to know **when the ledger closed**, not when the indexer happened to
ingest the row. After a backfill or downtime, `created_at` can be off by hours or days.

## Where things stand on `main`

Part of this is already merged, and the current state is inconsistent:

| Piece | State |
| --- | --- |
| `ledgerClosedAt` column + index in [`schema/events.ts`](../../packages/db/src/schema/events.ts) | ✅ declared, `NOT NULL` |
| `ledgerClosedAt` column + index in [`schema/tokenTransfers.ts`](../../packages/db/src/schema/tokenTransfers.ts) | ✅ declared, `NOT NULL` |
| API filters/buckets on it ([`transfers.service.ts`](../../apps/api/src/transfers/transfers.service.ts), [`events.service.ts`](../../apps/api/src/events/events.service.ts)) | ✅ |
| SQL migration in [`packages/db/migrations`](../../packages/db/migrations) | ❌ none of the migrations mention `ledger_closed_at` |
| Indexer writes the column ([`apps/indexer/src/events.ts`](../../apps/indexer/src/events.ts)) | ❌ only writes `decodedData.ledgerClosedAt` |
| Indexer tests assert the column | ❌ |

So against a migrated database the API queries a column that doesn't exist. Once the column exists,
the indexer's inserts fail the `NOT NULL` check. Finishing this issue fixes both.

## Changes

### 1. Migration

Generate it with `pnpm --filter @stellarlens/db db:generate`, then edit the SQL by hand so it adds the
column nullable, backfills, and only then tightens to `NOT NULL`. Otherwise it fails on any
database that already has rows.

```sql
ALTER TABLE "events" ADD COLUMN "ledger_closed_at" timestamptz;
ALTER TABLE "token_transfers" ADD COLUMN "ledger_closed_at" timestamptz;

-- events: the RPC value is already stored in the JSON
UPDATE "events"
SET "ledger_closed_at" = ("decoded_data"->>'ledgerClosedAt')::timestamptz
WHERE "ledger_closed_at" IS NULL
  AND "decoded_data"->>'ledgerClosedAt' IS NOT NULL;

-- events with no JSON value: fall back to ingestion time (best available)
UPDATE "events" SET "ledger_closed_at" = "created_at" WHERE "ledger_closed_at" IS NULL;

-- token_transfers: take it from the event row in the same ledger.
-- All events in one ledger share one close time, so matching on ledger alone is enough,
-- and it still works for older transfers whose rpc_event_id is NULL.
UPDATE "token_transfers" t
SET "ledger_closed_at" = e."ledger_closed_at"
FROM (
  SELECT "ledger", min("ledger_closed_at") AS "ledger_closed_at"
  FROM "events" GROUP BY "ledger"
) e
WHERE t."ledger" = e."ledger" AND t."ledger_closed_at" IS NULL;

UPDATE "token_transfers" SET "ledger_closed_at" = "created_at" WHERE "ledger_closed_at" IS NULL;

ALTER TABLE "events" ALTER COLUMN "ledger_closed_at" SET NOT NULL;
ALTER TABLE "token_transfers" ALTER COLUMN "ledger_closed_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "events_ledger_closed_at_idx" ON "events" ("ledger_closed_at");
CREATE INDEX IF NOT EXISTS "token_transfers_ledger_closed_at_idx" ON "token_transfers" ("ledger_closed_at");
```

Notes:

- The issue says to backfill transfers "via their tx/ledger". Joining on `ledger` covers both cases,
  because close time is per ledger, not per transaction.
- The `created_at` fallback keeps `NOT NULL` achievable. Say in the PR how many rows took the fallback
  (run a `SELECT count(*)` before you apply it) so reviewers know how much data is approximate.
- On large tables, consider `CREATE INDEX CONCURRENTLY` in a separate, non-transactional migration.

### 2. Indexer

In `processEventsBatch`, parse once and write to both inserts:

```ts
const ledgerClosedAt = new Date(event.ledgerClosedAt);
// events insert:          ledgerClosedAt,
// token_transfers insert: ledgerClosedAt,
```

Keep `decodedData.ledgerClosedAt` as is. It's part of the public `DecodedEventData` schema.

If `event.ledgerClosedAt` is ever missing or unparseable (`isNaN(date.getTime())`), log it and
skip the event rather than failing the whole batch. Decide this explicitly; don't let a
`NOT NULL` violation roll the transaction back without a useful log line.

## Tests

In [`apps/indexer/test/events.test.ts`](../../apps/indexer/test/events.test.ts):

- An indexed event row has `ledgerClosedAt` equal to the fixture's `ledgerClosedAt`, compared as a `Date`.
- A detected transfer row has the same `ledgerClosedAt` as its event.
- Two events from different ledgers keep different close times (guards against a constant being written).

A migration test is optional, but worth it: insert a pre-migration-shaped row, run the backfill SQL,
and assert the value.

## Acceptance checklist

- [ ] `ledger_closed_at timestamptz NOT NULL` plus index on `events` and `token_transfers`, created by a migration
- [ ] Migration backfills `events` from `decoded_data->>'ledgerClosedAt'` and `token_transfers` from the event's ledger
- [ ] Indexer populates the column on both inserts
- [ ] Indexer tests assert the column is set
