# #249: Don't record transfers from failed contract calls

## Problem

Soroban RPC returns events emitted during contract calls that later failed, with
`inSuccessfulContractCall: false`. Their state changes were rolled back, so a `transfer` event
from such a call **didn't move any tokens**.

Today, in [`apps/indexer/src/events.ts`](../../apps/indexer/src/events.ts), every event from a
registered contract:

1. is inserted into `events` (with the flag stored in `decoded_data.inSuccessfulContractCall`). **This is fine; keep it.**
2. goes through `detectTransfer`, and if it matches, a `token_transfers` row is written. **This is the bug.**
   These phantom rows inflate volume, counts, and top-sender/receiver stats.
3. is delivered to webhooks with `inSuccessfulContractCall` already in the payload.

## Changes

### 1. Gate transfer detection

```ts
// Events from a failed contract call were rolled back: the tokens never moved.
const transfer =
  event.inSuccessfulContractCall === false ? undefined : detectTransfer(decodedTopic, decodedValue);
```

Use `=== false`, not `!event.inSuccessfulContractCall`. If the field is ever missing, we keep
today's behaviour (record the transfer) instead of silently dropping real ones.

Keep the check in `events.ts`, not inside `detectTransfer`. [`transfers.ts`](../../apps/indexer/src/transfers.ts)
stays a pure topic/value pattern matcher with no RPC metadata.

### 2. Webhooks: keep delivering, flag explicitly (recommended)

Two options:

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Deliver, include the flag** (recommended) | No behaviour change for current consumers. They can see failed calls, which helps with debugging and alerting. The flag is already in the payload. | Consumers who count transfers must check the flag. |
| B. Skip delivery | Consumers can't miscount. | Silently hides data that's stored and visible in the API. Changes behaviour. Consumers lose visibility into failed calls. |

Option A matches what's stored: the event exists in `events`, so the webhook mirrors it. The work is
**documentation**. Add this to [`docs/webhooks.md`](../webhooks.md) under "The request you receive":

> `inSuccessfulContractCall` is `false` when the event was emitted during a contract call that
> ultimately failed. The call's effects were rolled back. For example, a `transfer` event with this
> flag set did **not** move tokens, and stellarlens doesn't record it as a transfer. Filter on this
> field if you only care about effects that took place.

If we choose B instead, skip the `webhookPayloads.push` for these events and document that.

### 3. Existing bad rows (optional, separate PR)

Rows already in `token_transfers` from failed calls can be removed with:

```sql
DELETE FROM token_transfers t
USING events e
WHERE e.decoded_data->>'id' = t.rpc_event_id
  AND (e.decoded_data->>'inSuccessfulContractCall')::boolean = false;
```

This only matches transfers that have `rpc_event_id`. Mention it in the PR. Decide whether to ship it
as a migration or leave it as an operator note.

## Tests

In [`apps/indexer/test/events.test.ts`](../../apps/indexer/test/events.test.ts), using the existing
`symbolXdr` / `addressXdr` / `i128Xdr` helpers:

- A valid SEP-41 transfer event with `inSuccessfulContractCall: false` creates an `events` row and
  **no** `token_transfers` row.
- The same event with `inSuccessfulContractCall: true` still creates a transfer (regression guard).
- A batch with one failed and one successful transfer creates exactly one transfer row.
- (Option A) In [`webhooks.test.ts`](../../apps/indexer/test/webhooks.test.ts), the failed-call event
  is delivered with `inSuccessfulContractCall: false` in the body.

## Acceptance checklist

- [ ] `detectTransfer` doesn't run (or its result is ignored) when `inSuccessfulContractCall === false`
- [ ] Webhook behaviour chosen and documented in `docs/webhooks.md`
- [ ] Test: no `token_transfers` row for an unsuccessful call
