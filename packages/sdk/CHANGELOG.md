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

- `listContracts(params?)` accepts `cursor`, `limit`, `name` and `network` (new `ListContractsParams` type).
- `listAllContracts(params?)` async iterator that follows `nextCursor` across pages.
- `verifyWebhookSignature({ body, signatureHeader, secret, timestampHeader?, toleranceSeconds? })` — WebCrypto-based,
  constant-time verification of webhook deliveries, supporting the legacy `sha256=` format and the timestamped
  format. Also exports `WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER` and `DEFAULT_WEBHOOK_TOLERANCE_SECONDS`.
- `parseTransfer(event)` and `parseTokenMovement(event)` — typed SEP-41 transfer / mint / burn / clawback parsing
  of `EventRecord.decodedData`, matching the indexer's transfer detection (including the muxed `{ amount }` form).
