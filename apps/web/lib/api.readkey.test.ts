import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubFetchOk(body: unknown = {}) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }));
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("api read-key selection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("uses API_READ_KEY for GET requests when it's configured", async () => {
    process.env.API_KEY = "full-key";
    process.env.API_READ_KEY = "read-key";
    const fetchMock = stubFetchOk({ data: [] });
    vi.stubGlobal("fetch", fetchMock);

    const { listContracts } = await import("./api.js");
    await listContracts();

    const [, init] = fetchMock.mock.calls[0];
    expect(headersOf(init)["x-api-key"]).toBe("read-key");
  });

  it("always uses the full API_KEY for mutating requests, never the read key", async () => {
    process.env.API_KEY = "full-key";
    process.env.API_READ_KEY = "read-key";
    const fetchMock = stubFetchOk({ id: 1, address: "C...", name: null, network: "testnet" });
    vi.stubGlobal("fetch", fetchMock);

    const { createContract } = await import("./api.js");
    await createContract({ address: "C...", network: "testnet" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(headersOf(init)["x-api-key"]).toBe("full-key");
  });

  it("falls back to the full key for GET requests when API_READ_KEY is unset", async () => {
    process.env.API_KEY = "full-key";
    delete process.env.API_READ_KEY;
    const fetchMock = stubFetchOk({ data: [] });
    vi.stubGlobal("fetch", fetchMock);

    const { listContracts } = await import("./api.js");
    await listContracts();

    const [, init] = fetchMock.mock.calls[0];
    expect(headersOf(init)["x-api-key"]).toBe("full-key");
  });

  it("never sends the full key for any of the read-only list/get helpers", async () => {
    process.env.API_KEY = "full-key";
    process.env.API_READ_KEY = "read-key";
    const fetchMock = stubFetchOk({ data: [] });
    vi.stubGlobal("fetch", fetchMock);

    const api = await import("./api.js");
    await api.listContracts();
    await api.getContract(1).catch(() => undefined);
    await api.getContractStats(1).catch(() => undefined);
    await api.listEvents(1);
    await api.listTransfers(1);
    await api.listWebhooks(1);

    for (const [, init] of fetchMock.mock.calls) {
      expect(headersOf(init)["x-api-key"]).toBe("read-key");
    }
  });
});
