# Design notes: webhook api work (#264–#267)

Implementation notes for four open webhook issues. Each note says what the code does today, what
has to change, which decisions the implementer must make (with a recommended answer), and what the
e2e tests need. They describe **planned** behaviour. [`docs/webhooks.md`](../webhooks.md) stays the
reference for what is actually shipped; each note lists the sections of that page to update in the
PR that lands it.

| Issue | Note | Depends on |
|---|---|---|
| #265 Reject private/internal webhook URLs at registration | [265-registration-url-checks.md](265-registration-url-checks.md) | — |
| #264 Pause and resume webhooks through the api | [264-pause-resume.md](264-pause-resume.md) | — |
| #266 `POST .../webhooks/:id/test` signed test delivery | [266-test-delivery.md](266-test-delivery.md) | #265 (shared module) |
| #267 Manual redelivery of a past delivery | [267-redelivery.md](267-redelivery.md) | #265 (shared module), ideally #266 |

Suggested order: **#265 first.** It creates the shared workspace package that #266 and #267 both
need for SSRF checks and signing. #264 is independent and can land in parallel.

## Before starting: the indexer file doesn't compile on `main`

[`apps/indexer/src/webhooks.ts`](../../apps/indexer/src/webhooks.ts) has leftovers from a merge:

- `postWebhook`'s parameter list is missing a comma after `deliveryHeaders: Record<string, string>`.
- The `headers` object has both `"X-Webhook-Signature": signature` and
  `[WEBHOOK_SIGNATURE_HEADER]: signature`, with no comma between them.
- The `withRetry` options have two `shouldRetry` keys, the first without a trailing comma.

[`apps/api/src/webhooks/dto/create-webhook.dto.ts`](../../apps/api/src/webhooks/dto/create-webhook.dto.ts)
also imports from `class-validator` twice (`IsArray`, `IsOptional`, `IsString`, `IsUrl` are
declared twice).

Fix these in a separate small PR first, so the code #265 moves into the shared package is code that
builds.

## Shared conventions for all four

- **Routes** live under `@Controller("contracts/:contractId/webhooks")` in
  [`webhooks.controller.ts`](../../apps/api/src/webhooks/webhooks.controller.ts). Every new route
  checks that the webhook belongs to the contract and returns `404` with
  `webhook <id> not found for contract <contractId>` if it doesn't, matching the existing methods.
- **Scope.** `ApiKeyGuard` already returns `403` to `read`-scope keys for any
  `POST`/`PATCH`/`PUT`/`DELETE` (`MUTATING_METHODS` in
  [`api-key.guard.ts`](../../apps/api/src/auth/guards/api-key.guard.ts)). The new routes are all
  `POST` or `PATCH`, so they're covered without extra code. Add `@RequireScope("full")` anyway so
  the requirement is explicit on the handler, and test the `403` regardless.
- **Secrets.** The schema comment on `webhooks.secret` says it is AES-256-GCM encrypted, but
  `packages/db/src/crypto/` doesn't exist and the indexer signs with `webhook.secret` as stored.
  Anything in the api that signs (#266, #267) must use the secret exactly the way the indexer does.
  If encryption at rest lands first, both apps call the same decrypt helper.
