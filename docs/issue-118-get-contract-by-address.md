# Issue #118 — Add a `getContractByAddress` convenience lookup

**Complexity:** medium  
**File:** `packages/sdk/src/client.ts`

## Background

Callers usually know a contract by its on-chain Stellar address. The only way to look one up today
is `listContracts()` and filter client-side, which is awkward and wastes a network round-trip when
all you need is one contract. `getContractByAddress` wraps that pattern into a single method.

## Implementation

The method is a thin convenience layer over `listContracts`. It is not a new API endpoint.

Add `getContractByAddress` to `StellarLensClient` in `packages/sdk/src/client.ts`:

```ts
/**
 * Returns the contract registered at `address`, or throws a {@link StellarLensApiError}
 * (status 404) when no contract with that address exists.
 *
 * This is a convenience wrapper over {@link listContracts} with an exact-match filter.
 * It makes one API request.
 */
async getContractByAddress(address: string, options?: RequestOptions): Promise<Contract> {
  const page = await this.listContracts({ address }, options);
  const match = page.data.find((c) => c.address === address);
  if (!match) {
    throw new StellarLensApiError(404, { message: `No contract found with address ${address}` });
  }
  return match;
}
```

### Placement

Add this method directly after `getContract` (the existing numeric-id lookup), so the two
lookups sit together in the file.

### Filter parameter

`listContracts` accepts a `name` substring filter today. The `address` filter must be supported
by the API for this implementation to avoid false matches. Check the generated OpenAPI types in
`src/generated/openapi.ts` and `ListContractsParams` in `src/types.ts`:

- If `address` is already a recognised query parameter, the implementation above is complete.
- If it is not, the method still works correctly — it fetches the first page and scans it —
  but add a comment noting that a full scan via `listAllContracts` may be needed for large
  registries until an `address` filter is added server-side.

## Tests

Add a test file (or extend the existing SDK test suite) covering both cases:

```ts
import { describe, it, expect, vi } from "vitest";
import { StellarLensClient } from "../src/client.js";

const ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function makeClient(fetchMock: typeof fetch) {
  return new StellarLensClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    fetch: fetchMock,
  });
}

describe("getContractByAddress", () => {
  it("returns the matching contract", async () => {
    const contract = { id: 1, address: ADDRESS, name: "MyToken", network: "mainnet" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [contract], nextCursor: null }), { status: 200 })
    );
    const client = makeClient(fetchMock);
    await expect(client.getContractByAddress(ADDRESS)).resolves.toEqual(contract);
  });

  it("throws a 404 StellarLensApiError when the address is not registered", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [], nextCursor: null }), { status: 200 })
    );
    const client = makeClient(fetchMock);
    const err = await client.getContractByAddress(ADDRESS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StellarLensApiError);  // import from ../src/errors.js
    expect((err as StellarLensApiError).status).toBe(404);
  });
});
```

## Acceptance criteria checklist

- [ ] `client.getContractByAddress(address)` returns the matching `Contract`.
- [ ] It throws a `StellarLensApiError` with status `404` when no contract with that address is registered.
- [ ] The implementation calls `listContracts` (or `listAllContracts`) — it does not introduce a new API endpoint.
- [ ] A test covers the found case.
- [ ] A test covers the not-found case.
