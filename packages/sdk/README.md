# @stellarlens/sdk

A typed TypeScript client for the [stellarlens](https://github.com/cyfer-codes/stellarlens) API — register
Soroban contracts, and read back their indexed events, token transfers, and transfer stats.

Works anywhere the global `fetch` is available (Node.js 18+, browsers, workers) — no other runtime
dependencies.

## Install

```bash
npm install @stellarlens/sdk
# or
pnpm add @stellarlens/sdk
```

## Usage

```ts
import { StellarLensClient } from "@stellarlens/sdk";

const client = new StellarLensClient({
  baseUrl: "https://api.your-stellarlens-deployment.com",
  apiKey: process.env.STELLARLENS_API_KEY!
});

// Register a contract (idempotent — re-registering the same address updates it)
const contract = await client.registerContract({
  address: "CABC...XYZ",
  network: "testnet",
  name: "My token"
});

// One page of registered contracts (filter by name substring and/or network)
const page = await client.listContracts({ network: "testnet", limit: 50 });
console.log(page.data, page.nextCursor);

// ...or iterate every contract, with pages fetched lazily as you go
for await (const c of client.listAllContracts({ network: "testnet" })) {
  console.log(c.id, c.address);
}

// Fetch one by id
const same = await client.getContract(contract.id);
```

> **Breaking change (unreleased):** `listContracts()` now returns a `Page<Contract>` (`{ data, nextCursor }`) to
> match the api, instead of `Contract[]`. Replace `await client.listContracts()` with
> `(await client.listContracts()).data` for a single page, or use `listAllContracts()` to get every contract.
> See [CHANGELOG.md](./CHANGELOG.md).

### Paginated events and transfers

`listContracts`, `listEvents` and `listTransfers` all use cursor-based pagination, oldest first. Keep passing the previous
page's `nextCursor` until it comes back `null`:

```ts
let cursor: number | undefined;

do {
  const page = await client.listEvents(contract.id, { cursor, limit: 50 });
  for (const event of page.data) {
    console.log(event.ledger, event.decodedData?.decoded.topic, event.decodedData?.decoded.value);
  }
  cursor = page.nextCursor ?? undefined;
} while (cursor !== undefined);
```

```ts
const transfers = await client.listTransfers(contract.id, { limit: 20 });
```

### Stats

```ts
const stats = await client.getStats(contract.id, {
  from: "2026-01-01T00:00:00Z",
  to: "2026-02-01T00:00:00Z"
});

console.log(stats.transferCount, stats.uniqueSenders, stats.uniqueReceivers);
console.log(stats.volumeByAsset); // [{ asset: "CABC...XYZ", volume: "30000000" }, ...]
```

### Error handling

Any non-2xx response throws a `StellarLensApiError` with the HTTP status and the parsed response body (falls
back to raw text if the body isn't JSON):

```ts
import { StellarLensApiError } from "@stellarlens/sdk";

try {
  await client.getContract(999999);
} catch (err) {
  if (err instanceof StellarLensApiError) {
    console.error(err.status, err.body);
  }
}
```

## API reference

| Method | Description |
|---|---|
| `registerContract(input)` | Register a contract, or update name/network if the address is already registered |
| `listContracts(params?)` | One cursor-paginated page of contracts (`cursor`, `limit`, `name`, `network`) |
| `listAllContracts(params?)` | Async iterator over every matching contract, following `nextCursor` |
| `getContract(id)` | Fetch a single contract by id |
| `listEvents(contractId, params?)` | Cursor-paginated events for a contract (`cursor`, `limit`, `topic`, `from`, `to`) |
| `listTransfers(contractId, params?)` | Cursor-paginated token transfers for a contract (`cursor`, `limit`) |
| `getStats(contractId, params?)` | Transfer summary stats for a contract (`from`, `to`) |

All request/response types are exported from the package root (`Contract`, `EventRecord`, `TransferRecord`,
`ContractStats`, `Page<T>`, etc.).
