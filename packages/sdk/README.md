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

// List registered contracts (cursor-paginated, optionally filtered by `name` substring and `network`)
const { data: contracts, nextCursor } = await client.listContracts({ network: "testnet", limit: 50 });

// Fetch one by id
const same = await client.getContract(contract.id);
```

### Paginated events and transfers

`listContracts`, `listEvents` and `listTransfers` use cursor-based pagination, oldest first. Keep passing the previous
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
import { formatAmount, parseAmount } from "@stellarlens/sdk";

const transfers = await client.listTransfers(contract.id, {
  limit: 20,
  asset: "CABC...XYZ",
  from: "GSENDER...",
  minAmount: String(parseAmount("100", 7)) // base units, as a string — see "Amounts" below
});
for (const transfer of transfers.data) {
  // `amount` is a base-unit decimal string, e.g. "12345678" — see "Amounts" below
  console.log(transfer.from, "→", transfer.to, formatAmount(transfer.amount, 7));
}
```

### Stats

```ts
const stats = await client.getStats(contract.id, {
  from: "2026-01-01T00:00:00Z",
  to: "2026-02-01T00:00:00Z"
});

console.log(stats.transferCount, stats.uniqueSenders, stats.uniqueReceivers);
for (const { asset, volume } of stats.volumeByAsset) {
  console.log(asset, formatAmount(volume, 7, { maxFractionDigits: 2 })); // "CABC...XYZ 3"
}
```

### Amounts

Token amounts (`TransferRecord.amount`, `volumeByAsset[].volume`) are decimal strings in the token's base
units. Soroban amounts are `i128`, so they regularly exceed `Number.MAX_SAFE_INTEGER` — **don't convert them
with `Number(...)` or `parseFloat`**, which silently drops precision. Use the bigint-based helpers instead:

```ts
import { formatAmount, parseAmount } from "@stellarlens/sdk";

// base units -> display string (7 decimals for Stellar asset contracts)
formatAmount("12345678", 7); // "1.2345678"
formatAmount("-12345678", 7); // "-1.2345678"
formatAmount("12345678", 7, { maxFractionDigits: 2 }); // "1.23" (rounded half away from zero)
formatAmount("170141183460469231731687303715884105727", 7); // "17014118346046923173168730371588.4105727"

// display string -> base units, as a bigint
parseAmount("1.5", 7); // 15000000n
parseAmount("-0.0000001", 7); // -1n
parseAmount("1.00000001", 7); // throws RangeError: more fraction digits than the token supports

// bigint arithmetic stays exact
const total = stats.volumeByAsset.reduce((sum, { volume }) => sum + BigInt(volume), 0n);
console.log(formatAmount(total, 7));
```

`formatAmount` never adds grouping separators, so its output always parses back with `parseAmount`.

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
| `listContracts(params?)` | Cursor-paginated registered contracts (`cursor`, `limit`, `name`, `network`) |
| `getContract(id)` | Fetch a single contract by id |
| `listEvents(contractId, params?)` | Cursor-paginated events for a contract (`cursor`, `limit`, `topic`, `topics`, `from`, `to`) |
| `listTransfers(contractId, params?)` | Cursor-paginated token transfers for a contract (`cursor`, `limit`, `minAmount`, `maxAmount`, `from`, `to`, `asset`) |
| `getStats(contractId, params?)` | Transfer summary stats for a contract (`from`, `to`) |
| `formatAmount(amount, decimals, { maxFractionDigits }?)` | Format a base-unit amount for display, using `bigint` |
| `parseAmount(display, decimals)` | Parse a display amount into base units as a `bigint` |

All request/response types are exported from the package root (`Contract`, `EventRecord`, `TransferRecord`,
`ContractStats`, `ApiKey`, `Webhook`, `Page<T>`, etc.), along with the raw generated `paths`, `components` and
`operations` types.

## Contributing: generated types

The SDK's types are generated from the api's committed OpenAPI spec, [`apps/api/openapi.json`](../../apps/api/openapi.json),
into `src/generated/openapi.ts` — never edit that file or hand-write shapes in `src/types.ts`. When the api
changes, update the spec and regenerate:

```bash
pnpm --filter @stellarlens/sdk generate
```

CI regenerates the types and fails if the committed output is out of date.
