# #267 Manual redelivery of a past webhook delivery

**Complexity:** high · **Files:** `apps/api/src/webhooks/webhooks.controller.ts`,
`apps/api/src/webhooks/webhooks.service.ts` · **Depends on:** #265 (`@stellarlens/webhook-security`).
#266's shared `postWebhook` helps a lot.

## Goal

After fixing a receiver, a user can resend a delivery they saw fail in
`GET .../webhooks/:id/deliveries`.

## Endpoint

```http
POST /contracts/:contractId/webhooks/:id/deliveries/:deliveryId/redeliver
x-api-key: <full-scope key>
```

No body. Returns `201` with the **new** delivery record, in the same shape as an item from
`GET .../deliveries`:

```json
{
  "id": 131,
  "eventId": 4183,
  "idempotencyKey": "wh_12_evt_4183",
  "status": "success",
  "attempts": 1,
  "lastError": null,
  "deliveredAt": "2026-11-22T10:04:00.120Z",
  "createdAt": "2026-11-22T10:04:00.125Z"
}
```

The original row is never modified.

| Case | Status |
|---|---|
| Contract, webhook and delivery match | `201` + new record (even if the redelivery itself failed: `status: "failed"`) |
| Unknown `deliveryId` | `404 delivery <deliveryId> not found for webhook <id>` |
| `deliveryId` exists but belongs to another webhook | `404`, same message. Don't reveal that it exists. |
| Webhook not on that contract | `404 webhook <id> not found for contract <contractId>` |
| Read-scope key | `403` |

Look the delivery up with
`WHERE webhook_deliveries.id = :deliveryId AND webhook_id = :id` after the webhook/contract check.
Never by `deliveryId` alone.

## Rebuilding the payload

The payload isn't stored on the delivery. Rebuild it from `events` via `webhook_deliveries.event_id`.
The row has everything the indexer used (see `apps/indexer/src/events.ts`):

| Payload field | Source |
|---|---|
| `version` | constant `1` |
| `eventId` | `events.id` |
| `contractId` | `events.contract_id` |
| `ledger` | `events.ledger` |
| `txHash` | `events.tx_hash` |
| `rpcEventId` | `events.decoded_data.id` |
| `ledgerClosedAt` | `events.decoded_data.ledgerClosedAt` |
| `inSuccessfulContractCall` | `events.decoded_data.inSuccessfulContractCall` |
| `topic` | `events.decoded_data.decoded.topic` |
| `value` | `events.decoded_data.decoded.value` |

(`contractAddress` is on the in-memory payload but stripped before sending, so it isn't needed.)

**Don't hand-copy this mapping into the api.** Add `buildWebhookPayload(eventRow)` to the shared
package and switch the indexer to it, so it builds the body the same way for live deliveries. A
unit test should assert that, for one event, the indexer's live body and the rebuilt body are
byte-identical. Otherwise receivers that verify signatures over a canonical body will see
mismatches. Note that `JSON.stringify` key order must match too.

`events` rows are deleted with `ON DELETE CASCADE` on the delivery, so a delivery whose event is
gone can't exist. No special case is needed.

## Sending: inline, because there is no outbox (decision)

The criteria say "or enqueue it if the outbox exists". There is no outbox today: `docs/webhooks.md`
says so, and the indexer delivers inline after each commit. So the api delivers synchronously:

1. `assertPublicWebhookUrl` + pinned agent + `redirect: "manual"` + `WEBHOOK_TIMEOUT_MS`, exactly
   as in #266.
2. Sign with `signWebhookPayload(webhook.secret, body)`, using the **current** secret. If the secret
   was rotated since the original delivery, the redelivery is signed with the new one. That is the
   one receivers have.
3. **A single attempt (recommendation).** The caller is waiting. Reusing the full retry policy
   would make the request take up to ~23.5s. A user can simply call redeliver again. If you do want
   retries, reuse `withRetry` and `shouldRetryWebhookDelivery` unchanged, and put the latency in the
   API docs.
4. Insert a new `webhook_deliveries` row with `status`, `attempts`, `lastError` and `deliveredAt`
   set the way the indexer's `recordDelivery` sets them, and return it. Unlike the indexer, a
   failure to insert the row is an error here (`500`), because the row is the response.

When an outbox lands later, this changes to "insert an outbox row and return `202` with the pending
delivery". Keep the response shape compatible: `status` gains a `"pending"` value.

### Headers and idempotency

- `X-Webhook-Id`: the **same** `wh_<webhookId>_evt_<eventId>` as the original (use
  `webhookDeliveryId`). It identifies the event, not the attempt. A receiver that already processed
  it (e.g. a success that was redelivered by mistake) deduplicates it, which is the safe outcome.
  Document this: "redelivering a delivery your endpoint already accepted is a no-op if you
  deduplicate on `X-Webhook-Id` or `eventId`".
- `X-Webhook-Attempt: 1`, because a redelivery is a fresh delivery.
- Optional: `X-Webhook-Redelivery: true`, so receivers can log it. If you add it, document it.

### Paused webhooks and filters

- **Paused (`active = false`):** allow it. Redelivery is an explicit, single action, and checking a
  fixed receiver before resuming is useful. It doesn't change `active`. A `410` response doesn't
  re-pause or otherwise touch the webhook, but it is recorded as `failed`.
- **`eventTypes`/`filter` changed since:** redeliver anyway. The user picked this specific delivery.
- **Redelivering a `success` row:** allowed (see idempotency above).

### Optional: link the new row to the original

A nullable `redelivery_of integer references webhook_deliveries(id) on delete set null` column lets
the UI show "redelivered from #125". It's not required by the criteria. If you add it, include it
in the deliveries list projection.

## Stats impact

`getStats` counts every row. Redeliveries are real deliveries, so counting them is correct, and a
successful redelivery resets `consecutiveFailures`, which is the desired signal. (Separately,
`getStats` filters on `status = 'delivered'`, but the indexer writes `'success'`, so `success` and
`lastSuccessAt` are always `0`/`null`. Fix that while you're there, or file it.)

## e2e tests

Seed a contract, an `events` row with realistic `decoded_data`, a webhook (with the #265 resolver
override), and a `failed` delivery row. Use a local `node:http` receiver as in #266.

- **Successful redelivery:** receiver answers `200` → `201`, the body is a new record
  (`id` ≠ original, same `eventId` and `idempotencyKey`, `status: "success"`, `attempts: 1`,
  `deliveredAt` set). The receiver got the rebuilt body with the original `eventId`, `topic` and
  `value`. The signature verifies with the webhook's secret. `X-Webhook-Id` is
  `wh_<id>_evt_<eventId>`. The original row is unchanged, and `GET .../deliveries` now lists both,
  newest first.
- Receiver answers `500` → `201` with `status: "failed"`, `lastError: "webhook responded with status 500"`.
- **404s:** unknown `deliveryId`. A `deliveryId` belonging to another webhook on the same contract.
  A webhook on another contract.
- Read-scope key → `403`, and no request reaches the receiver.
- Private destination (resolver maps to `10.0.0.1`) → `201` with `status: "failed"`, the non-public
  error, and no request received.

## Update `docs/webhooks.md`

- *Managing webhooks*: add the route.
- *Delivery semantics*: amend "the event is not retried later" to mention manual redelivery. Skipped
  (paused or filtered) events still can't be redelivered, because they have no delivery row.
- *Delivery history api*: note that redeliveries appear as new rows.
