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
