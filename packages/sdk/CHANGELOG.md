# Changelog

All notable changes to `@stellarlens/sdk` are documented here.

## Unreleased

### Breaking changes

- `listContracts()` now returns `Page<Contract>` (`{ data, nextCursor }`) instead of `Contract[]`, matching
  the paginated `GET /contracts` response. It previously typed the response as an array, so `.length` /
  `.map` silently operated on an object at runtime.

  ```ts
  // before
  const contracts = await client.listContracts();
  // after — a single page
  const { data: contracts, nextCursor } = await client.listContracts();
  // after — every contract
  for await (const contract of client.listAllContracts()) { /* ... */ }
  ```

### Added

- `timeoutMs` client option (default `10000`, `0` disables). Hung requests are aborted and reject with the new
  `StellarLensTimeoutError` (exported along with `DEFAULT_TIMEOUT_MS`).
- Every request-making method accepts an optional final `options: RequestOptions` (`{ signal?, timeoutMs? }`) for
  cancellation with an `AbortSignal` and per-call timeouts. `watchEvents` requests now also use the client timeout;
  a timed-out poll is reported to `onError` and retried like any other failure.
- `deleteContract(id)` sends `DELETE /contracts/:id`. It resolves on `204` and throws `StellarLensApiError` otherwise.
- `listAllEvents(contractId, params?)` and `listAllTransfers(contractId, params?)` async iterators that follow
  `nextCursor` across pages.

- `listContracts(params?)` accepts `cursor`, `limit`, `name` and `network` (new `ListContractsParams` type).
- `listAllContracts(params?)` async iterator that follows `nextCursor` across pages.
- `verifyWebhookSignature({ body, signatureHeader, secret, timestampHeader?, toleranceSeconds? })` — WebCrypto-based,
  constant-time verification of webhook deliveries, supporting the legacy `sha256=` format and the timestamped
  format. Also exports `WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER` and `DEFAULT_WEBHOOK_TOLERANCE_SECONDS`.
- `parseTransfer(event)` and `parseTokenMovement(event)` — typed SEP-41 transfer / mint / burn / clawback parsing
  of `EventRecord.decodedData`, matching the indexer's transfer detection (including the muxed `{ amount }` form).
- `watchEvents(contractId, { intervalMs, signal, startAt, topic, limit, maxBackoffMs, onError })` async iterator that
  tails a contract's events with correct cursor handling, backlog draining and exponential error backoff
  (new `WatchEventsOptions` type).

### Fixed

- `StellarLensClient` now validates `baseUrl` in its constructor and throws immediately for malformed or
  non-http(s) values, instead of failing confusingly on the first request.
- Paginated list methods now reject `limit` values outside the api's supported 1–100 range before sending a
  request, with a clear `RangeError` instead of waiting for the api to reject the call.
