# #255: Prevent two indexer instances from processing the same network concurrently

## Problem

[`apps/indexer/src/index.ts`](../../apps/indexer/src/index.ts) runs `processEventsBatch` in a loop
with nothing coordinating instances. During a rolling deploy, or with `replicas: 2`, two processes:

1. read the same cursor from `indexer_checkpoints`,
2. fetch the same RPC page,
3. both insert. `token_transfers` is protected by the unique `rpc_event_id` index, but **`events` has no
   unique key, so events are duplicated**,
4. both call `deliverWebhooksForEvent`, so **every webhook fires twice**.

## Design

Use a Postgres advisory lock keyed on the network. Hold it for one whole cycle:
read cursor → RPC fetch → commit → webhook delivery.

### Why not `pg_advisory_xact_lock` inside the existing transaction?

In `processEventsBatch`, the cursor is read and the RPC call made **before** `db.transaction(...)`,
and webhooks are delivered **after** it commits. A transaction-scoped lock would cover neither. Two
instances could still read the same cursor and fetch the same page. Moving all of that into the
transaction would hold a DB transaction open across network I/O and webhook retries, which is worse.

### Why a reserved connection?

[`createDb`](../../packages/db/src/client.ts) uses a `postgres-js` **pool** (`DATABASE_POOL_MAX`,
default 10). Session advisory locks belong to a connection. If you lock on one pooled connection
and unlock on another, the unlock is a no-op and the lock leaks. `postgres-js` supports
`sql.reserve()`, which pins one connection. Take and release the lock on that connection.

### Sketch

```ts
// apps/indexer/src/lock.ts
import type { Database } from "@stellarlens/db";

export async function withNetworkLock<T>(
  db: Database,
  network: string,
  fn: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const conn = await db.$client.reserve();
  try {
    const [{ locked }] = await conn<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext('stellarlens-indexer'), hashtext(${network})) AS locked`;
    if (!locked) return { acquired: false };
    try {
      return { acquired: true, result: await fn() };
    } finally {
      await conn`SELECT pg_advisory_unlock(hashtext('stellarlens-indexer'), hashtext(${network}))`;
    }
  } finally {
    conn.release();
  }
}
```

- Use the **two-int form**. The first key namespaces stellarlens, so it can't collide with other
  advisory locks on a shared database.
- Use `pg_try_advisory_lock`, not the blocking form, so the instance without the lock logs and keeps
  polling instead of hanging on a connection.
- If the process dies, Postgres releases the lock when the connection closes. No stale-lock cleanup needed.

In the loop (both the `POLL_ONCE` branch and the `for (;;)` branch):

```ts
const outcome = await withNetworkLock(db, STELLAR_NETWORK, () => processEventsBatch(db, server));
if (!outcome.acquired) {
  console.log(`poll cycle: another indexer holds the lock for network=${STELLAR_NETWORK}; waiting`);
} else {
  console.log(`poll cycle: indexed ${outcome.result.indexedCount} event(s), cursor=${outcome.result.cursor}`);
}
```

### Per cycle vs. whole process

Lock **per cycle**. During a rolling deploy, the new pod takes over at the next cycle boundary
after the old one stops, instead of waiting for the old process to exit. The cost is one extra round
trip per poll, which is negligible at `POLL_INTERVAL_MS`.

To avoid noisy logs, log the "waiting" line when the state changes (acquired → not acquired), or
at most once a minute, not every poll.

### Edge cases

- **Connection drop mid-cycle:** the lock is released server-side and another instance may start.
  The in-flight cycle's transaction will also fail on the dead connection pool (or commit independently).
  Worst case is one overlapping batch, and that is the same as today. Note it in the code; don't build
  fencing for it.
- **Different networks** use different keys, so one DB can serve a testnet and a mainnet indexer
  at the same time.
- The registry HTTP server (`startRegistryServer`) isn't covered by the lock. It's safe to run on every replica.

## Tests

New `apps/indexer/test/lock.test.ts` (needs a real Postgres, like the existing suite):

1. **Mutual exclusion:** create two `Database` clients (two `createDb()` calls, so two pools, like
   two processes). Call `withNetworkLock` on client A with a `fn` that waits on a deferred promise.
   While it's held, client B's call returns `{ acquired: false }`. Resolve A, and B's next call acquires it.
2. **Two loops, one batch:** mock the RPC with `mockJsonRpc` so it returns a single batch of N events.
   Run one cycle from each client concurrently (`Promise.all`). Assert `events` has exactly N rows, the
   mock webhook endpoint got N deliveries (not 2N), and exactly one cycle reported `acquired: true`.
3. **Different networks don't block each other.**
4. **Release on throw:** if `fn` throws, a later call can still acquire the lock.

Close the second client in `afterAll`. The shared `setup.ts` only manages one.

## Acceptance checklist

- [ ] Each cycle holds a Postgres advisory lock keyed on the network
- [ ] An instance that doesn't get the lock logs and skips the cycle without processing
- [ ] Integration test runs two loops and asserts only one indexes each batch
