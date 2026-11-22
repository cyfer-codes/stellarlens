# #264 Pause and resume webhooks through the api

**Complexity:** high · **Files:** `apps/api/src/webhooks/dto/update-webhook.dto.ts`,
`apps/api/src/webhooks/webhooks.service.ts`, `apps/api/test/webhooks.e2e-spec.ts`

## Today

- `webhooks.active` (`boolean`, default `true`, not null) exists in
  [`packages/db/src/schema/webhooks.ts`](../../packages/db/src/schema/webhooks.ts). The indexer
  loads only `active = true` rows. It sets `active = false` itself when an endpoint answers
  `410 Gone` (`pauseWebhook` in `apps/indexer/src/webhooks.ts`).
- There are **no** `paused_reason` or `paused_at` columns.
- `UpdateWebhookDto` has `url`, `eventTypes` and `filter`. The global `ValidationPipe` strips unknown
  fields, so `"active": false` is silently ignored.
- No projection includes `active`. They also disagree with each other: `findAllByContract` returns
  `filter`, but `findOne` doesn't.

## Changes

### 1. Migration: add `paused_reason` and `paused_at` (recommended)

The criteria say to include them "if they exist". They don't yet, but adding them now is cheap.
Without them, a webhook paused by the indexer's `410` handling looks the same as one a user paused,
and the user can't tell why deliveries stopped.

```ts
// packages/db/src/schema/webhooks.ts
pausedReason: text("paused_reason"),                              // null while active
pausedAt: timestamp("paused_at", { withTimezone: true }),         // null while active
```

Generate it with `pnpm --filter @stellarlens/db db:generate`.

Values:

| Who pauses | `pausedReason` | `pausedAt` |
|---|---|---|
| api `PATCH { active: false }` | `"manual"` | `now()` |
| indexer after `410 Gone` | `"gone"` | `now()` |
| any resume (`active: true`) | `null` | `null` |

Update `pauseWebhook` in the indexer to set all three columns. Keep `pausedReason` a short machine
value, not free text, so the web UI can switch on it.

If you'd rather leave the migration out of this issue, drop these two fields from the responses and
the tests below. Don't return them as always-`null`.

### 2. DTO

```ts
@ApiPropertyOptional({
  description: "Pause (false) or resume (true) deliveries. Paused webhooks skip events; they are not queued.",
  example: false,
})
@IsOptional()
@IsBoolean()
active?: boolean;
```

`@IsBoolean()` rejects `"false"` and `0` with `400`. That is intended; don't add a transform.

### 3. Service

- In `update()`, when `dto.active !== undefined`, set `active`, plus `pausedReason`/`pausedAt` as
  above.
- **Resuming an active webhook, or pausing a paused one, changes nothing.** Only write
  `pausedAt`/`pausedReason` when the value actually changes, so a repeated
  `PATCH { active: false }` doesn't reset `pausedAt` or overwrite `"gone"` with `"manual"`.
  Doing this with a conditional `UPDATE` is fine, e.g.
  `CASE WHEN active = ${dto.active} THEN paused_at ELSE ... END`.
- Define one projection constant and use it in `findAllByContract`, `findOne`, the no-op branch of
  `update` and the `update` `returning(...)`:

  ```ts
  const webhookView = {
    id: webhooks.id,
    contractId: webhooks.contractId,
    url: webhooks.url,
    eventTypes: webhooks.eventTypes,
    filter: webhooks.filter,
    active: webhooks.active,
    pausedReason: webhooks.pausedReason,
    pausedAt: webhooks.pausedAt,
    createdAt: webhooks.createdAt,
  };
  ```

  The secret stays out of it. The `register` and `rotate-secret` responses return the full row, so
  they pick up the new columns automatically.

### 4. Scope

`PATCH` is already blocked for `read` keys by `ApiKeyGuard`. Nothing new is needed beyond the test.
`GET` with a read key must still return `active`.

## Behaviour to document

- **Pausing skips events; it doesn't queue them.** Resuming doesn't backfill. To recover a specific
  missed event after #267 lands, there is nothing to redeliver either: skipped events have no
  delivery row. Say this plainly.
- The change applies from the next event the indexer processes. No restart is needed.
- `active` can be combined with other fields in one `PATCH`, e.g. fixing the `url` and resuming.

## e2e tests

- `PATCH { active: false }` → `200`, body has `active: false`, `pausedReason: "manual"` and a
  `pausedAt` timestamp. A following `GET /:id` and `GET` list both show the same values.
- `PATCH { active: true }` on a paused webhook → `active: true`, and `pausedReason`/`pausedAt` are
  `null`.
- Pausing twice keeps the first `pausedAt`.
- Resuming a webhook the indexer paused (seed `active = false, paused_reason = 'gone'` directly)
  clears the reason.
- `PATCH { active: "false" }` → `400`.
- A read-scope key: `PATCH { active: false }` → `403`, and the row is unchanged. `GET` → `200` and
  includes `active`.
- Wrong contract → `404`.
- Indexer unit test: a `410` sets `active = false, paused_reason = 'gone', paused_at`.

## Update `docs/webhooks.md`

- *Managing webhooks*: add `active` to the `PATCH` body and add `active`, `pausedReason` and
  `pausedAt` to the `GET`/`PATCH` return columns. Remove "(no secret, no `active`)".
- *Pausing a webhook*: replace "The api doesn't expose `active` yet…" and the SQL block with the
  `PATCH` examples. Keep the SQL as an operator fallback if you like.
