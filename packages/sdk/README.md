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

### Watching for new events

`watchEvents` polls for you and yields each new event exactly once, oldest first, until you abort it. It handles
the cursor bookkeeping (it advances to the last *returned* event id. `nextCursor` is only set when a page
overflows, so following it once caught up would replay everything). It drains backlogs without waiting and backs
off exponentially when the api errors.

```ts
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());

for await (const event of client.watchEvents(contract.id, {
  startAt: "latest",          // "latest" = only events indexed from now on; a number = after that event id;
                              // omitted = replay from the first event
  intervalMs: 5000,           // wait between polls once caught up (default 5000)
  signal: controller.signal,  // abort → the loop simply ends
  onError: (err, { attempt, retryInMs }) => console.warn(`poll failed (#${attempt}), retrying in ${retryInMs}ms`, err)
})) {
  console.log(event.id, event.decodedData?.decoded);
}
```

Also accepts `topic` (filter), `limit` (page size, default 100) and `maxBackoffMs` (default 60000). To resume after
a restart, persist the last `event.id` you processed and pass it as `startAt`.

### Typed token movements

`event.decodedData.decoded` is `unknown`, since a contract can emit anything. For SEP-41 token events, use the
typed helpers instead of hand-written guards. They return `null` for anything that isn't a matching event.

```ts
import { parseTransfer, parseTokenMovement } from "@stellarlens/sdk";

const page = await client.listEvents(contract.id);

for (const event of page.data) {
  // Same rules the indexer uses to populate listTransfers, including muxed `{ amount, to_muxed_id }` data
  const transfer = parseTransfer(event);
  if (transfer) {
    console.log(`${transfer.from} -> ${transfer.to}: ${transfer.amount}`, transfer.toMuxedId);
  }

  // transfer | mint | burn | clawback (`from` is null for mints, `to` is null for burns/clawbacks)
  const movement = parseTokenMovement(event);
  if (movement?.kind === "mint") {
    console.log(`minted ${movement.amount} to ${movement.to}`);
  }
}
```

Amounts are i128 values as decimal strings in the token's smallest unit. Use `BigInt(movement.amount)` for math.

### Stats

```ts
const stats = await client.getStats(contract.id, {
  from: "2026-01-01T00:00:00Z",
  to: "2026-02-01T00:00:00Z"
});

console.log(stats.transferCount, stats.uniqueSenders, stats.uniqueReceivers);
console.log(stats.volumeByAsset); // [{ asset: "CABC...XYZ", volume: "30000000" }, ...]
```

### Verifying webhooks

Every webhook delivery is signed with HMAC-SHA256 using the secret returned when the webhook was registered.
`verifyWebhookSignature` checks it for you with a constant-time comparison. It's built on WebCrypto, so the same
code runs in Node.js 20+, Deno, Bun, Cloudflare Workers and Next.js/Vercel edge routes.

```ts
import { verifyWebhookSignature } from "@stellarlens/sdk";

const ok = await verifyWebhookSignature({
  body: rawBody,                                        // the raw request body: string, Uint8Array or ArrayBuffer
  signatureHeader: headers["x-webhook-signature"],      // "sha256=<hex>"
  secret: process.env.STELLARLENS_WEBHOOK_SECRET!,
  timestampHeader: headers["x-webhook-timestamp"],      // optional — see below
  toleranceSeconds: 300                                 // optional, default 300
});
```

It resolves `false` (never throws) for a missing, malformed or mismatched signature, so you can call it on any
request. **Always pass the raw body** — parsing and re-serializing the JSON can change bytes and break the check.

Two signature formats are supported:

| Format | Headers | Signed content |
|---|---|---|
| Legacy (current deliveries) | `X-Webhook-Signature: sha256=<hex>` | the raw body |
| Timestamped | `X-Webhook-Signature: sha256=<hex>` + `X-Webhook-Timestamp: <unix seconds>` | `"<timestamp>.<raw body>"` |

When `timestampHeader` is passed, the timestamped format is used and deliveries older (or further in the future)
than `toleranceSeconds` are rejected, which protects against replayed requests. Without it, the legacy format is
checked.

#### Express

```ts
import express from "express";
import { verifyWebhookSignature } from "@stellarlens/sdk";

const app = express();

// express.raw keeps the body as a Buffer, so it isn't re-serialized before verification.
app.post("/webhooks/stellarlens", express.raw({ type: "application/json" }), async (req, res) => {
  const ok = await verifyWebhookSignature({
    body: req.body as Buffer,
    signatureHeader: req.get("x-webhook-signature"),
    timestampHeader: req.get("x-webhook-timestamp"),
    secret: process.env.STELLARLENS_WEBHOOK_SECRET!
  });
  if (!ok) {
    return res.status(401).send("invalid signature");
  }

  const event = JSON.parse((req.body as Buffer).toString("utf8"));
  // ...handle event.eventId, event.topic, event.value
  res.sendStatus(204);
});
```

#### Next.js (App Router route handler — Node.js or edge runtime)

```ts
// app/api/webhooks/stellarlens/route.ts
import { verifyWebhookSignature } from "@stellarlens/sdk";

export const runtime = "edge"; // optional — works on the default Node.js runtime too

export async function POST(request: Request) {
  const body = await request.text(); // raw body; don't use request.json() before verifying

  const ok = await verifyWebhookSignature({
    body,
    signatureHeader: request.headers.get("x-webhook-signature"),
    timestampHeader: request.headers.get("x-webhook-timestamp"),
    secret: process.env.STELLARLENS_WEBHOOK_SECRET!
  });
  if (!ok) {
    return new Response("invalid signature", { status: 401 });
  }

  const event = JSON.parse(body);
  // ...handle the event
  return new Response(null, { status: 204 });
}
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
| `watchEvents(contractId, options?)` | Async iterator yielding new events as they're indexed, until `signal` aborts |
| `listTransfers(contractId, params?)` | Cursor-paginated token transfers for a contract (`cursor`, `limit`) |
| `getStats(contractId, params?)` | Transfer summary stats for a contract (`from`, `to`) |

Standalone helpers:

| Function | Description |
|---|---|
| `parseTransfer(event)` | Typed SEP-41 transfer (`from`, `to`, `amount`, `toMuxedId`) or `null` |
| `parseTokenMovement(event)` | Typed SEP-41 transfer/mint/burn/clawback or `null` |
| `verifyWebhookSignature(options)` | Constant-time HMAC check of a webhook delivery (legacy and timestamped formats) |

All request/response types are exported from the package root (`Contract`, `EventRecord`, `TransferRecord`,
`ContractStats`, `Page<T>`, etc.).
