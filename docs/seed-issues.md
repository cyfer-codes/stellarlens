# Seed issues — good first issue backlog

35 well-scoped issues to paste into GitHub manually, spread across the six areas of the
monorepo. Each one is grounded in the current code (file paths included) so a first-time
contributor can find their footing quickly.

**How to use this doc:** copy one issue's heading + body into a new GitHub issue, apply
`good first issue`, the listed `area:*` label, and a `complexity:*` label. Complexity maps
to Drips Wave's point tiers — assign the actual point value per whatever Drips Wave's
current tier scale is at the time you publish these; `trivial`/`medium`/`high` here just
signals relative sizing, roughly: trivial = a focused single-file change with an obvious
fix, medium = touches a few files and/or needs a migration or new test, high = a real
feature slice or something that needs a design decision along the way.

Mix across this batch: 15 trivial, 16 medium, 4 high.

---

## area:indexer

### 1. Make the poll interval configurable via env var
**Complexity:** trivial

**Scope:** `apps/indexer/src/config.ts` hardcodes `POLL_INTERVAL_MS = 5000`. Follow the
same pattern already used for `REGISTRY_PORT` (`Number(process.env.X ?? default)`) to let
it be overridden by an env var, e.g. `POLL_INTERVAL_MS`.

**Acceptance criteria:**
- [ ] Setting `POLL_INTERVAL_MS=2000` in the environment changes the indexer's actual poll
      cadence (verify by log timestamps or a quick manual run).
- [ ] Omitting the env var keeps the current default of 5000ms.
- [ ] A line is added to the indexer's env documentation (README or `.env.example`, see
      the `area:docs` issue for adding an indexer README if it doesn't exist yet).

**Files to look at:** `apps/indexer/src/config.ts`

---

### 2. Add a `GET /health` endpoint to the registry server
**Complexity:** trivial

**Scope:** `apps/indexer/src/server.ts`'s `startRegistryServer` only handles
`POST /contracts` — everything else 404s, including basic liveness probes. Add a
`GET /health` route returning `{ "status": "ok" }` with a 200, matching the shape
`apps/api/src/health.controller.ts` already uses.

**Acceptance criteria:**
- [ ] `curl localhost:<REGISTRY_PORT>/health` returns `200 {"status":"ok"}`.
- [ ] Existing `POST /contracts` behavior and its error responses are unchanged.
- [ ] Unknown routes still 404 as before.

**Files to look at:** `apps/indexer/src/server.ts`, `apps/api/src/health.controller.ts` (for the shape to match)

---

### 3. Validate contract address format before registering
**Complexity:** medium

**Scope:** `apps/indexer/src/registry.ts`'s `registerContract` (and the api's
`CreateContractDto`) currently accept any non-empty string as an address — there's no
check that it's a well-formed Stellar/Soroban strkey (`C...` or `G...`, 56 characters,
valid checksum). Add validation using `@stellar/stellar-sdk`'s `StrKey` helpers
(`StrKey.isValidContract`/`isValidEd25519PublicKey`) before the insert, rejecting
malformed addresses with a clear error message.

**Acceptance criteria:**
- [ ] Registering `"not-an-address"` is rejected with a descriptive error instead of being
      silently stored.
- [ ] A valid `C...` contract address (or `G...` account address, if both are meant to be
      accepted — check how `address` is used downstream and document the decision) still
      registers successfully.
- [ ] A unit test covers both the accept and reject paths.

**Files to look at:** `apps/indexer/src/registry.ts`

---

### 4. Don't let one malformed event crash the whole poll batch
**Complexity:** medium

**Scope:** `apps/indexer/src/decode.ts`'s `decodeScVal` throws if `xdr.ScVal.fromXdr`
fails on unexpected input. Trace where this is called per-event (`apps/indexer/src/events.ts`
and/or `transfers.ts`) and confirm whether a single bad payload currently aborts the whole
poll cycle. If so, catch decode failures per-event, log them with enough context (contract
id, ledger, tx hash) to debug later, and persist the event with a null/placeholder decoded
value instead of dropping the rest of the batch.

**Acceptance criteria:**
- [ ] A test simulating a malformed XDR payload confirms the rest of the batch still gets
      processed and persisted.
- [ ] The failure is logged with contract id, ledger, and tx hash.
- [ ] Existing successful-decode behavior is unchanged.

**Files to look at:** `apps/indexer/src/decode.ts`, `apps/indexer/src/events.ts`, `apps/indexer/src/transfers.ts`

---

### 5. Make webhook retry/timeout tuning configurable via env
**Complexity:** trivial

**Scope:** `WEBHOOK_MAX_RETRIES`, `WEBHOOK_RETRY_BASE_DELAY_MS`,
`WEBHOOK_RETRY_MAX_DELAY_MS`, and `WEBHOOK_TIMEOUT_MS` in `apps/indexer/src/config.ts` are
fixed constants. Make each one read from an env var with the current value as the default,
same pattern as issue #1.

**Acceptance criteria:**
- [ ] Overriding e.g. `WEBHOOK_TIMEOUT_MS=10000` changes the abort timeout used in
      `apps/indexer/src/webhooks.ts`'s `postWebhook`.
- [ ] Defaults are preserved when the env vars are unset.
- [ ] Documented in the indexer's env docs.

**Files to look at:** `apps/indexer/src/config.ts`, `apps/indexer/src/webhooks.ts`

---

### 6. Persist webhook delivery outcomes for observability
**Complexity:** high

**Scope:** `apps/indexer/src/webhooks.ts`'s `deliverWebhooksForEvent` only `console.error`s
when retries are exhausted — there's no persisted record of delivery attempts or
successes, so there's no way to answer "did this webhook actually fire?" after the fact.
Add a `webhook_deliveries` table via a new `packages/db` migration (columns roughly:
`webhookId`, `eventId`, `status`, `attempts`, `lastError`, `deliveredAt`), and write a row
from `deliverWebhooksForEvent` for both successful and failed outcomes.

**Acceptance criteria:**
- [ ] New Drizzle migration under `packages/db/migrations` (generated via `drizzle-kit`,
      following the existing migration file naming).
- [ ] Both successful and failed deliveries produce a row.
- [ ] The existing best-effort behavior (delivery failures never throw or stall indexing)
      is unchanged.
- [ ] A test covers both the success and failure recording paths.

**Files to look at:** `apps/indexer/src/webhooks.ts`, `packages/db/src/schema/webhooks.ts`, `packages/db/migrations/`

---

## area:api

### 7. Add `DELETE /contracts/:id`
**Complexity:** medium

**Scope:** `apps/api/src/contracts/contracts.controller.ts` and `contracts.service.ts`
have no delete/deactivate endpoint — once registered, a contract can never be removed via
the api. Add `DELETE /contracts/:id`, deciding and documenting what happens to its related
events/transfers/webhooks (check the FK constraints in `packages/db/src/schema` to see
whether a cascade delete, a block-if-related-rows-exist, or a soft-delete flag fits best).

**Acceptance criteria:**
- [ ] `DELETE /contracts/:id` on an existing contract returns 204 and it no longer appears
      in `GET /contracts`.
- [ ] Deleting a nonexistent id returns 404, matching the `NotFoundException` pattern
      already used in `webhooks.service.ts`.
- [ ] The chosen behavior for a contract with existing events/transfers/webhooks is
      documented in the PR description and covered by a test.

**Files to look at:** `apps/api/src/contracts/contracts.controller.ts`, `apps/api/src/contracts/contracts.service.ts`, `packages/db/src/schema/`

---

### 8. Add an `asset` filter to `GET /contracts/:id/transfers`
**Complexity:** medium

**Scope:** `packages/db/src/schema/tokenTransfers.ts` has an `asset` column, but
`FindTransfersQueryDto` and `TransfersController`/`TransfersService` have no way to filter
by it — callers always get every asset mixed together. Add an optional `?asset=` query
param.

**Acceptance criteria:**
- [ ] `GET /contracts/:id/transfers?asset=USDC` returns only transfers for that asset.
- [ ] Omitting `asset` preserves current (unfiltered) behavior.
- [ ] A test covers both the filtered and unfiltered cases.

**Files to look at:** `apps/api/src/transfers/dto/find-transfers-query.dto.ts`, `apps/api/src/transfers/transfers.service.ts`, `apps/api/src/transfers/transfers.controller.ts`

---

### 9. Validate that `from` is before `to` in date-range queries
**Complexity:** trivial

**Scope:** `StatsQueryDto` (and `FindEventsQueryDto`, which has the same `from`/`to`
pattern) validate each date is a valid ISO8601 string independently, but nothing checks
that `from` comes before `to`. A backwards range currently just silently returns an empty
result set instead of a clear error.

**Acceptance criteria:**
- [ ] A request with `from` after `to` returns a 400 with a clear validation message.
- [ ] Valid ranges (or either field alone) continue to work unchanged.
- [ ] A test covers the new validation.

**Files to look at:** `apps/api/src/transfers/dto/stats-query.dto.ts`, `apps/api/src/events/dto/find-events-query.dto.ts`

---

### 10. Add `GET /contracts/:contractId/webhooks/:id`
**Complexity:** trivial

**Scope:** `WebhooksController` supports register/list/delete but has no way to fetch a
single webhook by id. Add a `GET :id` route mirroring the list endpoint's field selection
(no `secret` in the response — see how `findAllByContract` already excludes it).

**Acceptance criteria:**
- [ ] `GET /contracts/:contractId/webhooks/:id` returns the webhook's `id`, `url`, and
      `createdAt` (never `secret`).
- [ ] A nonexistent webhook id (or one belonging to a different contract) returns 404.
- [ ] A test covers both cases.

**Files to look at:** `apps/api/src/webhooks/webhooks.controller.ts`, `apps/api/src/webhooks/webhooks.service.ts`

---

### 11. Restrict webhook URLs to https
**Complexity:** medium

**Scope:** `CreateWebhookDto` uses `@IsUrl({ require_tld: false })`, which accepts plain
`http://` URLs. Since webhook payloads carry an HMAC signature over potentially sensitive
event data, plaintext delivery undermines that. Restrict registration to `https://` (with
a documented, explicit escape hatch for local development if needed — check how other
local-dev exceptions are handled elsewhere in the codebase, e.g. env-gated behavior).

**Acceptance criteria:**
- [ ] Registering a webhook with an `http://` URL is rejected with a clear error message
      (outside of whatever local-dev exception is agreed on).
- [ ] Registering an `https://` URL continues to work.
- [ ] A test covers the rejection and acceptance paths.

**Files to look at:** `apps/api/src/webhooks/dto/create-webhook.dto.ts`

---

### 12. Track api key last-used timestamps
**Complexity:** high

**Scope:** `packages/db/src/schema/apiKeys.ts` has no `lastUsedAt` column, so there's
currently no way to tell whether a given key is actually still in use before revoking it.
Add the column via a migration, and update it from `ApiKeyGuard.canActivate` on every
successful authentication (consider whether to do this synchronously or fire-and-forget,
and whether to throttle the write so it isn't a write on every single request).

**Acceptance criteria:**
- [ ] New migration adding `last_used_at` (nullable timestamp) to `api_keys`.
- [ ] `ApiKeyGuard` updates it on successful auth.
- [ ] `GET /api-keys` includes the new field.
- [ ] The write strategy (sync vs. fire-and-forget/throttled) is explained in the PR and
      doesn't measurably slow down authenticated requests.

**Files to look at:** `packages/db/src/schema/apiKeys.ts`, `apps/api/src/auth/guards/api-key.guard.ts`, `apps/api/src/api-keys/api-keys.service.ts`

---

## area:web

### 13. Give each dashboard route its own page title
**Complexity:** trivial

**Scope:** `apps/web/app/layout.tsx` sets a single static `title: "stellarlens"` in its
`Metadata` export, so every route shows the same browser tab title. Add per-route
`metadata`/`generateMetadata` exports (e.g. `"Contracts · stellarlens"`,
`"Settings · stellarlens"`) to the relevant `page.tsx` files under `app/(dashboard)/`.

**Acceptance criteria:**
- [ ] Contracts, Events, Transfers, and Settings pages each show a distinct browser tab
      title reflecting the current page.
- [ ] The root layout's title remains as a sensible fallback for routes not explicitly
      updated.

**Files to look at:** `apps/web/app/layout.tsx`, `apps/web/app/(dashboard)/*/page.tsx`

---

### 14. Add a show/hide toggle to the login password field
**Complexity:** trivial

**Scope:** `apps/web/components/LoginForm.tsx`'s password `<input>` is always
`type="password"` with no way to reveal what was typed, which makes it easy to mistype on
first login. Add a small toggle button (plain SVG icon or text, no new dependency) that
flips the input between `type="password"` and `type="text"`.

**Acceptance criteria:**
- [ ] A visible control toggles the password field's visibility.
- [ ] The toggle has an accessible label (`aria-label`) that reflects its current state.
- [ ] No new npm dependency introduced.

**Files to look at:** `apps/web/components/LoginForm.tsx`

---

### 15. Add copy-to-clipboard buttons for addresses and generated api keys
**Complexity:** trivial

**Scope:** Contract addresses in `apps/web/app/(dashboard)/contracts/page.tsx` and the
one-time generated api key shown in `apps/web/components/ApiKeysManager.tsx` are both
long, `font-mono` strings meant to be copied — but there's no copy button, only manual
select-and-copy. Add a small "Copy" button next to each using `navigator.clipboard.writeText`.

**Acceptance criteria:**
- [ ] Clicking "Copy" next to a contract address or a freshly generated api key copies the
      full value to the clipboard.
- [ ] Brief visual feedback confirms the copy happened (e.g. button label flips to
      "Copied!" for a moment).
- [ ] No new npm dependency introduced.

**Files to look at:** `apps/web/app/(dashboard)/contracts/page.tsx`, `apps/web/components/ApiKeysManager.tsx`

---

### 16. Add Previous/page-size controls to the transfers table pagination
**Complexity:** medium

**Scope:** `apps/web/app/(dashboard)/contracts/[id]/transfers/page.tsx` only renders a
"Next page →" link when `nextCursor` is present — there's no way to go back to a previous
page without using browser back navigation, and no control over page size. Add a way to
navigate backward (e.g. keep a stack of prior cursors in the URL's search params) and a
simple page-size selector.

**Acceptance criteria:**
- [ ] A "Previous" control is available and works correctly once past the first page.
- [ ] A page-size control (e.g. 10/20/50) changes how many rows are requested from the api.
- [ ] Deep-linking to a specific page via URL (as today) still works.

**Files to look at:** `apps/web/app/(dashboard)/contracts/[id]/transfers/page.tsx`, `apps/web/lib/api.ts`

---

### 17. Build a webhooks management UI
**Complexity:** high

**Scope:** `apps/api` already exposes register/list/delete endpoints for webhooks
(`apps/api/src/webhooks/webhooks.controller.ts`), but there's no dashboard UI for them at
all. Add a section (e.g. on the contract detail page, `apps/web/app/(dashboard)/contracts/[id]/page.tsx`)
to list a contract's webhooks, register a new one (URL input), and remove one — following
the existing client-component + fetch pattern used by `ApiKeysManager.tsx`.

**Acceptance criteria:**
- [ ] A contract's registered webhooks are listed (URL + created date).
- [ ] A form registers a new webhook and shows the one-time-visible signing secret,
      mirroring how `ApiKeysManager.tsx` handles the one-time api key reveal.
- [ ] A remove/revoke action deletes a webhook and updates the list.
- [ ] Basic loading/error/empty states, matching `components/ui/`'s existing patterns.

**Files to look at:** `apps/web/components/ApiKeysManager.tsx` (pattern to follow), `apps/web/app/(dashboard)/contracts/[id]/page.tsx`, `apps/api/src/webhooks/webhooks.controller.ts`

---

### 18. Add dark mode support
**Complexity:** high

**Scope:** The dashboard is light-mode only today (explicitly called out in
`docs/screenshots.md`: "the app doesn't have a dark theme"). Add a dark theme using
Tailwind's `dark:` variant, respecting `prefers-color-scheme` at minimum (a manual toggle
persisted to `localStorage` is a reasonable stretch goal, not required for this issue).

**Acceptance criteria:**
- [ ] All dashboard pages (Contracts, Events, Transfers, Settings, login) remain fully
      readable and usable with a dark OS/browser theme active.
- [ ] No regression to the existing light-mode appearance.
- [ ] `docs/screenshots.md`'s note about no dark theme is updated or removed.

**Files to look at:** `apps/web/app/globals.css`, `apps/web/tailwind.config.*`, every component under `apps/web/components/`

---

## area:sdk

### 19. Add a `ping()` health-check method
**Complexity:** trivial

**Scope:** `packages/sdk/src/client.ts`'s `StellarLensClient` has no method wrapping the
api's `GET /health`, which is otherwise the simplest possible way to verify a configured
`baseUrl`/`apiKey` actually work before doing anything else.

**Acceptance criteria:**
- [ ] `client.ping()` (or similarly named) calls `GET /health` and resolves on success.
- [ ] A test using a mocked `fetch` covers the success case (see `client.test.ts` for the
      existing mocking pattern).
- [ ] Exported from `packages/sdk/src/index.ts` if needed.

**Files to look at:** `packages/sdk/src/client.ts`, `packages/sdk/src/client.test.ts`

---

### 20. Add webhook methods to the SDK
**Complexity:** medium

**Scope:** `apps/api` exposes register/list/delete endpoints for webhooks, but
`StellarLensClient` has no corresponding methods — SDK consumers currently have to hand-roll
raw `fetch` calls to manage webhooks. Add `registerWebhook`, `listWebhooks`, and
`removeWebhook`, following the existing method style (see `registerContract`/`listContracts`).

**Acceptance criteria:**
- [ ] New methods exist for register/list/remove, with types added to `packages/sdk/src/types.ts`.
- [ ] Each is covered by a test using the existing mocked-`fetch` pattern in `client.test.ts`.
- [ ] Documented with a short usage example in the sdk's README.

**Files to look at:** `packages/sdk/src/client.ts`, `packages/sdk/src/types.ts`, `packages/sdk/src/client.test.ts`, `apps/api/src/webhooks/webhooks.controller.ts`

---

### 21. Add a `deleteContract` method
**Complexity:** medium

**Scope:** Depends on `area:api` issue #7 (`DELETE /contracts/:id`) landing first. Once
that endpoint exists, add a corresponding `deleteContract(id)` method to
`StellarLensClient`.

**Acceptance criteria:**
- [ ] `client.deleteContract(id)` calls `DELETE /contracts/:id` and resolves on 204.
- [ ] A test covers both success and a 404 error case (see `StellarLensApiError` handling
      already in `client.ts`'s `request` method).

**Files to look at:** `packages/sdk/src/client.ts`, `packages/sdk/src/errors.ts`

---

### 22. Support an `AbortSignal` on requests
**Complexity:** trivial

**Scope:** `StellarLensClient`'s private `request` method builds its own `fetch` call with
no way for a caller to cancel an in-flight request. Accept an optional `signal` param on
each public method (or a second options argument) and pass it through to `fetch`.

**Acceptance criteria:**
- [ ] Passing an already-aborted (or later-aborted) `AbortSignal` to e.g. `listEvents`
      causes the underlying fetch to abort and the promise to reject accordingly.
- [ ] Existing calls without a signal are unaffected.
- [ ] A test covers the abort behavior.

**Files to look at:** `packages/sdk/src/client.ts`

---

### 23. Add a configurable request timeout
**Complexity:** medium

**Scope:** Unlike the indexer's webhook delivery code (`apps/indexer/src/webhooks.ts`,
which uses `AbortController` + `setTimeout` for a hard timeout), `StellarLensClient` has no
timeout at all — a hung connection to the api would hang forever. Add a `timeoutMs` option
to `StellarLensClientOptions`, defaulting to something reasonable (e.g. 10000), implemented
similarly to the indexer's pattern.

**Acceptance criteria:**
- [ ] A request that doesn't resolve within `timeoutMs` is aborted and rejects with a
      clear timeout error.
- [ ] The default timeout is documented; it can be overridden or disabled via the option.
- [ ] A test simulates a slow/hanging mocked `fetch` and confirms the timeout fires.

**Files to look at:** `packages/sdk/src/client.ts`, `apps/indexer/src/webhooks.ts` (pattern to follow)

---

### 24. Add an async-iterator helper for paging through all results
**Complexity:** medium

**Scope:** `listEvents`/`listTransfers` return one cursor-paginated `Page<T>` at a time —
consumers who want "every event/transfer" have to hand-write their own cursor loop. Add a
helper (e.g. `listAllEvents(contractId, params)` returning an `AsyncGenerator<EventRecord>`)
that walks pages automatically using the existing cursor field.

**Acceptance criteria:**
- [ ] `for await (const event of client.listAllEvents(contractId)) { ... }` yields every
      event across all pages, in order.
- [ ] Stops correctly when there's no `nextCursor`.
- [ ] A test with a mocked multi-page `fetch` sequence covers pagination termination.

**Files to look at:** `packages/sdk/src/client.ts`, `packages/sdk/src/types.ts`

---

## area:cli

### 25. Add `stellarlens contracts get <id>`
**Complexity:** trivial

**Scope:** `packages/cli/src/commands/contracts.ts` has `addContract` and `listContracts`
but nothing to fetch a single contract by id, even though `StellarLensClient.getContract`
already exists in the sdk. Add a `contracts get <id>` subcommand.

**Acceptance criteria:**
- [ ] `stellarlens contracts get 1` prints that contract's details.
- [ ] A nonexistent id produces a clear error message and non-zero exit code.
- [ ] A test covers both cases, following the pattern in `contracts.test.ts`.

**Files to look at:** `packages/cli/src/commands/contracts.ts`, `packages/cli/src/index.ts`, `packages/cli/src/commands/contracts.test.ts`

---

### 26. Add a global `--json` output flag
**Complexity:** trivial

**Scope:** Every CLI command formats output for humans (`console.table`, template
strings) — there's no way to get machine-readable output for scripting. Add a `--json`
flag at the top-level `program` in `packages/cli/src/index.ts` and thread it through to
`listContracts`/`addContract`/`tailEvents`, printing `JSON.stringify(...)` instead of the
formatted output when set.

**Acceptance criteria:**
- [ ] `stellarlens contracts list --json` prints a JSON array instead of a table.
- [ ] Behavior without the flag is unchanged.
- [ ] At least one command's json-mode output is covered by a test.

**Files to look at:** `packages/cli/src/index.ts`, `packages/cli/src/commands/contracts.ts`, `packages/cli/src/commands/events.ts`

---

### 27. Add `stellarlens transfers list <contractId>`
**Complexity:** medium

**Scope:** The cli has `events tail` but nothing for transfers, even though
`StellarLensClient.listTransfers` already exists. Add a `transfers list <contractId>`
subcommand printing a table (ledger, from, to, amount, asset, tx hash), with `--cursor`
and `--limit` options mirroring the api's query params.

**Acceptance criteria:**
- [ ] `stellarlens transfers list 1` prints a table of transfers for contract 1.
- [ ] `--cursor`/`--limit` options are supported and passed through correctly.
- [ ] A test covers the command, following `events.test.ts`'s pattern.

**Files to look at:** `packages/cli/src/commands/events.ts` (pattern to follow), `packages/cli/src/index.ts`

---

### 28. Add `stellarlens stats <contractId>`
**Complexity:** medium

**Scope:** No cli command surfaces `StellarLensClient.getStats`. Add a `stats <contractId>`
command printing transfer count, unique senders/receivers, and volume by asset, with
optional `--from`/`--to` date-range flags matching the api's `StatsQueryDto`.

**Acceptance criteria:**
- [ ] `stellarlens stats 1` prints the contract's stats in a readable format.
- [ ] `--from`/`--to` flags are passed through and affect the result.
- [ ] A test covers the command.

**Files to look at:** `packages/cli/src/index.ts`, `packages/sdk/src/client.ts` (`getStats`)

---

### 29. Add webhook commands
**Complexity:** medium

**Scope:** Depends on `area:sdk` issue #20 (SDK webhook methods) landing first. Add
`webhooks add <contractId> <url>`, `webhooks list <contractId>`, and
`webhooks remove <contractId> <id>` subcommands.

**Acceptance criteria:**
- [ ] All three subcommands work against a running api instance.
- [ ] `webhooks add` prints the one-time signing secret clearly, with a warning that it
      won't be shown again (mirroring how the web dashboard handles this for api keys).
- [ ] Tests cover each subcommand.

**Files to look at:** `packages/cli/src/index.ts`, `packages/cli/src/commands/contracts.ts` (pattern to follow)

---

### 30. Support a config file as a fallback to env vars
**Complexity:** medium

**Scope:** `createClientFromEnv` (in `packages/cli/src/client.ts`) requires
`STELLARLENS_API_URL`/`STELLARLENS_API_KEY` to be set as environment variables on every
invocation. Add support for reading them from a config file (e.g. `~/.stellarlensrc` or
`.stellarlensrc.json` in the cwd) as a fallback when the env vars aren't set, so users
don't have to export them in every shell session.

**Acceptance criteria:**
- [ ] With no env vars set but a valid config file present, cli commands work normally.
- [ ] Env vars still take precedence over the config file when both are present.
- [ ] Missing both produces the current clear error message, unchanged.
- [ ] Documented in `packages/cli`'s README.

**Files to look at:** `packages/cli/src/client.ts`

---

## area:docs

### 31. Capture and publish the README screenshots
**Complexity:** trivial

**Scope:** `docs/screenshots.md` already lists exactly what to capture (login, onboarding,
contracts list, contract detail, transfers, settings) and where they should live — nobody's
done it yet. Follow the checklist, seed a bit of real local data first, capture each shot,
and wire them into `README.md` under a new "Screenshots" section.

**Acceptance criteria:**
- [ ] All six screenshots listed in `docs/screenshots.md` exist under `docs/screenshots/`.
- [ ] `README.md` references them under a "Screenshots" section.
- [ ] The redaction checklist in `docs/screenshots.md` (no real addresses/tx
      hashes/live api keys) is followed — the api key screenshot uses a throwaway key that
      gets revoked immediately after.

**Files to look at:** `docs/screenshots.md`, `README.md`

---

### 32. Add a README to `apps/api`
**Complexity:** trivial

**Scope:** The root `README.md` covers the monorepo at a high level, but `apps/api` has no
README of its own — a contributor working only on the api has to piece together its env
vars and available endpoints from source. Add `apps/api/README.md` covering required env
vars (see `apps/api/src/*.ts` for what's actually read), how to run it locally, and a table
of its endpoints (controllers under `apps/api/src/*/`).

**Acceptance criteria:**
- [ ] `apps/api/README.md` lists every required/optional env var.
- [ ] Lists every route (method + path) across all controllers, with a one-line
      description each.
- [ ] Cross-linked from the root `README.md`'s monorepo layout section.

**Files to look at:** `apps/api/src/**/*.controller.ts`, root `README.md`

---

### 33. Add a README to `apps/indexer`
**Complexity:** trivial

**Scope:** Same gap as #32 but for the indexer — `apps/indexer/src/config.ts` has several
env vars and tunable constants (poll interval, retry/backoff settings, webhook timeout)
with no single place documenting what they do or their defaults.

**Acceptance criteria:**
- [ ] `apps/indexer/README.md` documents every env var and constant in `config.ts`,
      including defaults and what happens if it's misconfigured.
- [ ] Briefly explains the indexer's overall loop (poll → decode → persist → webhook
      deliver) for someone new to the codebase.
- [ ] Cross-linked from the root `README.md`.

**Files to look at:** `apps/indexer/src/config.ts`, `apps/indexer/src/index.ts`, root `README.md`

---

### 34. Document the webhook signature verification format
**Complexity:** medium

**Scope:** `apps/indexer/src/webhooks.ts` signs every webhook payload with
`X-Webhook-Signature: sha256=<hmac>` (HMAC-SHA256 over the raw JSON body, using the
per-webhook secret returned once at registration time), but nothing documents this for
someone building a receiving endpoint. Add a doc (e.g. `docs/webhooks.md`) explaining the
payload shape, the header format, and how to verify it, with a copy-pasteable verification
snippet in at least one language (Node.js is the natural first choice given the stack).

**Acceptance criteria:**
- [ ] `docs/webhooks.md` documents the payload JSON shape (see
      `WebhookEventPayload` in `apps/indexer/src/webhooks.ts`) and the signature header format.
- [ ] Includes a working verification code snippet.
- [ ] Linked from the root `README.md`.

**Files to look at:** `apps/indexer/src/webhooks.ts`, `apps/api/src/webhooks/webhooks.controller.ts`

---

### 35. Add an API reference doc for `apps/api`
**Complexity:** medium

**Scope:** There's no single reference listing every endpoint, its request/response shape,
and auth requirements — `apps/api`'s DTOs and controllers are the only source of truth
today. Add `docs/api.md` (hand-written is fine; a generated OpenAPI spec via
`@nestjs/swagger` is a reasonable stretch goal if you'd rather go that route — flag which
approach you're taking in the PR description before investing time) covering every route
across all controllers, required headers (`x-api-key`), and example request/response
bodies.

**Acceptance criteria:**
- [ ] Every controller's routes are documented with method, path, auth requirement, query/body
      params, and an example response.
- [ ] Linked from the root `README.md`.
- [ ] If going the `@nestjs/swagger` route instead: it's wired up, served locally, and the
      doc explains how to reach it.

**Files to look at:** `apps/api/src/**/*.controller.ts`, `apps/api/src/**/dto/*.ts`
