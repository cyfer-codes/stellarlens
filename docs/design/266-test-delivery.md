# #266 `POST .../webhooks/:id/test`: send a signed test delivery

**Complexity:** high · **Files:** `apps/api/src/webhooks/webhooks.controller.ts`,
`apps/api/src/webhooks/webhooks.service.ts` · **Depends on:** #265 (`@stellarlens/webhook-security`)

## Goal

Let a user check, on demand, that their endpoint is reachable and verifies signatures, without
waiting for an on-chain event.

## Endpoint

```http
POST /contracts/:contractId/webhooks/:id/test
x-api-key: <full-scope key>
```

No request body. The response is always `200` once the attempt has been made. Whether the endpoint
accepted it is reported in the body, not as the HTTP status:

```json
{ "ok": false, "status": 401, "durationMs": 182, "error": "webhook responded with status 401" }
```

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | `true` only for a `2xx` response |
| `status` | number \| null | Receiver's HTTP status; `null` if no response (timeout, DNS, blocked, connection error) |
| `durationMs` | number | Wall-clock time from just before the SSRF check to the response or error |
| `error` | string \| null | `null` when `ok`; otherwise the same message the indexer would record as `lastError` |

Error responses from the api itself: `404` for an unknown webhook or one on a different contract,
`403` for a read-scope key, `429` from the existing throttler.

## Request sent to the receiver

```http
POST <webhook.url>
Content-Type: application/json
X-Webhook-Signature: sha256=<hmac>
X-Webhook-Id: wh_<webhookId>_test_<uuid>
X-Webhook-Event: ping
X-Webhook-Attempt: 1

{"type":"ping","webhookId":12,"contractId":7,"sentAt":"2026-11-22T10:00:00.000Z"}
```

- **Signing:** `signWebhookPayload(secret, body)` from `@stellarlens/webhook-security`, the same
  function the indexer uses. If the indexer has switched to timestamped signatures
  (`X-Webhook-Timestamp`), the ping must use the same mode. The point of the test is that it fails
  exactly when a real delivery would.
- **Body shape:** `type: "ping"` is the discriminator. Real event payloads have no `type` field
  today (they're keyed by `eventId`), so receivers can tell the two apart. Document that handlers
  should accept a ping with `2xx` and ignore it.
- **`X-Webhook-Id`** uses a `_test_` infix and a random UUID, so it can never collide with a real
  `wh_<id>_evt_<eventId>` key in a receiver's dedupe store.

## Same protections as real deliveries

Reuse, don't reimplement:

1. `assertPublicWebhookUrl(url, resolver)` before sending, using the resolver provider from #265.
2. Send through `createWebhookAgent(resolver)`, the pinned public-only lookup, so DNS rebinding
   between the check and the connection is blocked.
3. `redirect: "manual"`. A `3xx` gives `ok: false`, the `3xx` as `status`, and the indexer's
   redirect message as `error`.
4. A timeout equal to the indexer's `WEBHOOK_TIMEOUT_MS`. The api has no webhook settings today. Add
   `WEBHOOK_TIMEOUT_MS` (default `5000`) to the api's config validation, or export the default from
   the shared package and read the env var in both apps.
5. **One attempt, no retries (decision).** The user is waiting on the response, and retries would
   make it take up to ~23.5s. A single attempt still answers "is it reachable and does it verify".

The cleanest way to get 1–3 is to move `postWebhook` and its error classes (`WebhookResponseError`,
`WebhookRedirectError`) into `@stellarlens/webhook-security` as well, so the api and indexer share
the HTTP call too.

## Paused webhooks

Allow the test on a paused webhook (`active = false`). Checking the receiver before resuming it is
the main use case after a `410` auto-pause. Testing doesn't change `active`. A `410` on a test ping
does **not** pause the webhook.

## Recording: not recorded (decision, document it)

`webhook_deliveries.event_id` is `NOT NULL` with a foreign key to `events`, and a ping has no event.
Recording it would need a migration (nullable `event_id` plus a `kind` column), and every consumer
would then have to filter pings out: `GET .../deliveries`, `GET .../stats` (success rate,
`consecutiveFailures`), and the web UI.

**Recommendation: don't record test deliveries.** The result is returned synchronously, so nothing
is lost. Log a line at `info` level (`webhook <id> test delivery: ok=<ok> status=<status>`). State
in `docs/webhooks.md` that test deliveries don't appear in delivery history or stats.

If the project prefers recording them, the alternative is: make `event_id` nullable, add
`kind text not null default 'event'` (`'event' | 'test'`), write `kind = 'test'`, and exclude
`kind = 'test'` from `getStats`. Pick one and say which in the PR.

## e2e test (local HTTP receiver)

Start a `node:http` server on `127.0.0.1:0` in `beforeAll`. It records the raw body and headers,
and returns a status the test sets. That loopback address is blocked by the SSRF check, so the test
module must override the resolver/IP policy provider from #265 to allow it. For example, register
the webhook as `http://receiver.test:<port>/hook` (with `ALLOW_INSECURE_WEBHOOK_URLS=true`) and map
`receiver.test` to `127.0.0.1` with a policy override that treats it as public. Put the override in
the test only; never in the production code path.

Cases:

- Receiver answers `204` → `{ ok: true, status: 204, error: null }`, `durationMs >= 0`. The received
  body parses to `type: "ping"`, and `verifyWebhookSignature` from `@stellarlens/sdk` accepts the
  signature for the raw body using the webhook's secret from the create response.
- Receiver answers `401` → `ok: false, status: 401`.
- Receiver never answers (with the timeout lowered for the test) → `ok: false, status: null`, and
  `error` mentions the abort or timeout.
- Receiver answers `302` → `ok: false`, redirect error, and the `Location` target is never hit.
- Without the override, the resolver maps the host to `10.0.0.1` → `ok: false, status: null`,
  `error: "webhook URL resolves to a non-public IP address"`, and the receiver sees no request.
- Read-scope key → `403`. Wrong contract → `404`.
- `GET .../deliveries` row count is unchanged after a test (if not recording).

## Update `docs/webhooks.md`

Add the route to *Managing webhooks*. Add a short "Testing an endpoint" section with the ping body,
the headers, the response fields, the one-attempt rule and the recording decision.
