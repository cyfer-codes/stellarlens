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

// List all registered contracts
const contracts = await client.listContracts();

// Fetch one by id
const same = await client.getContract(contract.id);
```

### Paginated events and transfers

Both `listEvents` and `listTransfers` use cursor-based pagination, oldest first. Keep passing the previous
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

### Verifying webhook signatures

Incoming webhooks sent by the indexer are signed with HMAC-SHA256 using the per-webhook secret returned at
registration time. Use `verifyWebhookSignature` to verify authenticity, guard against replay attacks, and
prevent timing attacks via constant-time comparison.

The helper works in Node.js 18+ and edge runtimes (Cloudflare Workers, Vercel Edge) using WebCrypto:

```ts
import { verifyWebhookSignature } from "@stellarlens/sdk";
```

#### Express example

In Express, ensure the raw request body is captured before JSON parsing:

```ts
import express from "express";
import { verifyWebhookSignature } from "@stellarlens/sdk";

const app = express();

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signatureHeader = req.headers["x-webhook-signature"] as string;
    const timestampHeader = req.headers["x-webhook-timestamp"] as string | undefined;

    const isValid = await verifyWebhookSignature({
      body: req.body.toString(),
      signatureHeader,
      timestampHeader,
      secret: process.env.STELLARLENS_WEBHOOK_SECRET!,
      toleranceSeconds: 300 // Reject webhooks older than 5 minutes (default: 300)
    });

    if (!isValid) {
      return res.status(400).send("Invalid webhook signature");
    }

    const payload = JSON.parse(req.body.toString());
    console.log("Received verified webhook:", payload.topic, payload.txHash);

    res.status(200).json({ received: true });
  }
);
```

#### Next.js (App Router) example

In Next.js route handlers (`app/api/webhook/route.ts`), read the raw body using `req.text()`:

```ts
import { verifyWebhookSignature } from "@stellarlens/sdk";

export async function POST(req: Request) {
  const body = await req.text();
  const signatureHeader = req.headers.get("x-webhook-signature") ?? "";
  const timestampHeader = req.headers.get("x-webhook-timestamp") ?? undefined;

  const isValid = await verifyWebhookSignature({
    body,
    signatureHeader,
    timestampHeader,
    secret: process.env.STELLARLENS_WEBHOOK_SECRET!,
    toleranceSeconds: 300
  });

  if (!isValid) {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  const payload = JSON.parse(body);
  console.log("Received verified webhook:", payload);

  return Response.json({ received: true });
}
```

## API reference

| Method / Helper | Description |
|---|---|
| `registerContract(input)` | Register a contract, or update name/network if the address is already registered |
| `listContracts()` | List all registered contracts |
| `getContract(id)` | Fetch a single contract by id |
| `listEvents(contractId, params?)` | Cursor-paginated events for a contract (`cursor`, `limit`, `topic`, `from`, `to`) |
| `listTransfers(contractId, params?)` | Cursor-paginated token transfers for a contract (`cursor`, `limit`) |
| `getStats(contractId, params?)` | Transfer summary stats for a contract (`from`, `to`) |
| `verifyWebhookSignature(params)` | Verify HMAC-SHA256 webhook signatures (legacy & timestamped) using constant-time WebCrypto |
| `timingSafeEqual(a, b)` | Constant-time comparison between two `Uint8Array` buffers |

All request/response types are exported from the package root (`Contract`, `EventRecord`, `TransferRecord`,
`ContractStats`, `Page<T>`, `VerifyWebhookSignatureParams`, etc.).
