import { beforeEach, describe, expect, it, vi } from "vitest";
import { listContracts } from "./api";

describe("listContracts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [], nextCursor: null }), { status: 200 }))
    );
  });

  it("hits /contracts with no query string when called with no params", async () => {
    await listContracts();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/contracts", expect.any(Object));
  });

  it("forwards cursor, limit, name and network as query params", async () => {
    await listContracts({ cursor: 21, limit: 20, name: "usdc", network: "testnet" });
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "http://localhost:3000/contracts?cursor=21&limit=20&name=usdc&network=testnet"
    );
  });

  it("returns the { data, nextCursor } page shape", async () => {
    const result = await listContracts();
    expect(result).toEqual({ data: [], nextCursor: null });
  });
});