# #265 Reject private or internal webhook URLs at registration

**Complexity:** high · **Files:** `apps/indexer/src/webhooks.ts`,
`apps/api/src/webhooks/webhooks.service.ts`, `apps/api/src/webhooks/dto/create-webhook.dto.ts`

## Today

- The SSRF check only runs in the indexer, once per delivery attempt:
  `assertPublicWebhookUrl(url, resolve)` resolves every `A`/`AAAA` record and throws
  `NonPublicWebhookUrlError` if any address fails `ipIsPublic` (or there are none). The helpers
  `ipv4IsPublic`, `ipv6ToBigInt`, `ipIsPublic`, `createPublicOnlyLookup` and `createWebhookAgent`
  all sit in [`apps/indexer/src/webhooks.ts`](../../apps/indexer/src/webhooks.ts).
- The api validates only syntax (`@IsUrl({ require_tld: false })`) and, on create, the protocol
  (`@IsSecureWebhookUrl`, `https://` unless `ALLOW_INSECURE_WEBHOOK_URLS=true`). It stores
  `http://10.0.0.5/` or `http://localhost:6379/` without complaint. Every later delivery is then
  recorded as `failed` with `webhook URL resolves to a non-public IP address`.
- `UpdateWebhookDto.url` doesn't have the `https://` check either, so `PATCH` can store a plain
  `http://` URL that `POST` would reject. Fix this in the same PR.

## Proposed shared location: `packages/webhook-security` (`@stellarlens/webhook-security`)

A new workspace package next to `db`, `decode`, `sdk` and `cli`:

```
packages/webhook-security/
  package.json        # "name": "@stellarlens/webhook-security", same build setup as packages/db
  src/
    index.ts
    ip.ts             # ipv4IsPublic, ipv6ToBigInt, ipIsPublic
    url.ts            # assertPublicWebhookUrl, NonPublicWebhookUrlError, DnsResolver, defaultResolve
    agent.ts          # createPublicOnlyLookup, createWebhookAgent
    signature.ts      # signWebhookPayload, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER
    ip.test.ts        # move the existing IP-range tests here
```

Why a new package rather than an existing one:

- **Not `@stellarlens/db`.** These helpers have nothing to do with the database, and the agent code
  pulls in `undici`, which the db package shouldn't depend on.
- **Not `@stellarlens/sdk`.** The sdk is published for end users. The SSRF policy is
  server-internal, and the signing side the sdk needs (`verifyWebhookSignature`) is already there.
- **Signing goes in too.** #266 and #267 have to sign "using the same signing code as the indexer".
  Moving `apps/indexer/src/webhook-signature.ts` here now means the api never keeps a copy.
  The shared fixtures in `test/fixtures/webhook-signatures.json` keep checking it.

Module format: the indexer is ESM (`"type": "module"`) and the api compiles to CommonJS. Build the
package the same way `packages/db` is built, since both apps already consume that one.

The indexer then imports from `@stellarlens/webhook-security` and keeps only delivery logic
(retries, `postWebhook`, `recordDelivery`, pausing). Keep the existing names re-exported from
`apps/indexer/src/webhooks.ts` for one release if any test imports them from there.

## api changes

1. **An injectable resolver.** Add a provider, e.g. `WEBHOOK_DNS_RESOLVER`, in `WebhooksModule`.
   Its default is the package's `defaultResolve` (`dns.lookup` with `all: true, verbatim: true`).
   Inject it into `WebhooksService`. Tests override it with `Test.createTestingModule(...)
   .overrideProvider(WEBHOOK_DNS_RESOLVER).useValue(fakeResolver)`.
2. **Check in the service, not the DTO.** class-validator decorators can't take Nest-injected
   dependencies, and resolution is async I/O. In `register()` and in `update()` (only when
   `dto.url !== undefined`), call `assertPublicWebhookUrl(url, this.resolve)` **before** the
   duplicate-URL query, and map errors like this:

   | Error | Status | Message |
   |---|---|---|
   | `NonPublicWebhookUrlError` from an IP literal | `400` | `url must not point to a private, loopback or link-local address (10.0.0.5)` |
   | `NonPublicWebhookUrlError` after DNS | `400` | `url host internal.example resolves to a private, loopback or link-local address (10.0.0.5)` |
   | DNS failure (`ENOTFOUND`, `EAI_NONAME`, `ENODATA`, `EAI_FAIL`) | `400` | `url host could not be resolved: internal.example` |
   | Resolver returns no addresses | `400` | same as DNS failure |

   To name the offending address, have `NonPublicWebhookUrlError` carry it (e.g. an optional
   `address` property). Its `message` must not change: the indexer stores that message as
   `lastError`, and `docs/webhooks.md` quotes it.
3. **Unresolvable hosts are rejected (decision).** A host that doesn't resolve now can't receive
   deliveries, and the indexer treats DNS failure as final. Rejecting it at registration gives the
   feedback the issue asks for. The downside is that you can't register a hostname before its DNS
   record exists. That's acceptable; note it in the docs.
4. **The delivery-time check stays.** The registration check is a fast-feedback layer. DNS can
   change after registration, and the pinned lookup (`createPublicOnlyLookup`) is what actually
   stops rebinding. Don't remove or weaken either indexer check.
5. **No override for private targets.** `ALLOW_INSECURE_WEBHOOK_URLS` still only relaxes the
   `https://` requirement. Like the indexer, which has no allow-list, the api rejects
   `http://localhost:4000/hook` even when that flag is `true`. Local development still goes through
   a public tunnel, as `docs/webhooks.md` already says.

## Existing tests this breaks

- `webhooks.e2e-spec.ts` registers `https://example.com/...` in many places. Without an injected
  resolver those tests would hit real DNS. Override the resolver in the shared test setup so it
  returns a public address (e.g. `93.184.215.14`) for any hostname by default.
- `accepts an http:// url when ALLOW_INSECURE_WEBHOOK_URLS=true for local development` (around
  line 489) uses a loopback URL, which will now get `400`. Change it to an `http://` URL on a host
  the fake resolver maps to a public address. The test is about the protocol, not the destination.

## e2e tests to add

All in [`apps/api/test/webhooks.e2e-spec.ts`](../../apps/api/test/webhooks.e2e-spec.ts), for both
`POST` and `PATCH`:

- IP literals return `400`: `http://10.0.0.5/`, `http://127.0.0.1/`, `http://localhost:6379/`
  (via the resolver), `http://169.254.169.254/latest/meta-data`, `http://[::1]/`,
  `http://[fe80::1]/`, `http://[::ffff:10.0.0.1]/`.
- A hostname resolving to a private address returns `400`: the fake resolver maps
  `internal.example` to `10.1.2.3`.
- A mixed answer returns `400`: `mixed.example` resolves to `[93.184.215.14, 10.0.0.1]`. Any private
  address blocks it.
- A DNS failure returns `400`: the resolver throws an error with `code: "ENOTFOUND"`.
- A public hostname or literal returns `201`/`200` (regression).
- `PATCH` with no `url` doesn't call the resolver (spy on it).
- A rejected `PATCH` leaves the stored URL unchanged.

## Update `docs/webhooks.md`

- *Managing webhooks*: replace "It is **not** checked against the blocked destinations at
  registration time" with the new `400` behaviour.
- *Blocked destinations → Known limits*: remove "Registration doesn't check the destination".
  Add that the registration check is advisory and the delivery-time check is the one enforced.
