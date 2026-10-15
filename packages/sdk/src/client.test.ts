import { describe, expect, it, vi } from "vitest";
import { StellarLensClient } from "./client.js";
import { StellarLensApiError } from "./errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeClient(fetchMock: typeof fetch, baseUrl = "https://api.example.com") {
  return new StellarLensClient({ baseUrl, apiKey: "test-key", fetch: fetchMock });
}

describe("StellarLensClient", () => {
  describe.each(["listEvents", "listTransfers"] as const)("%s pagination", (method) => {
    it.each([0, -1, 101, 1.5, NaN, Infinity, -Infinity])(
      "rejects invalid limit %s without making a request",
      async (limit) => {
        const fetchMock = vi.fn(async () =>
          jsonResponse({ data: [], nextCursor: null })
        ) as unknown as typeof fetch;

        await expect(makeClient(fetchMock)[method](1, { limit })).rejects.toThrow(
          "limit must be an integer between 1 and 100"
        );

        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it.each([1, 20, 100])("passes valid limit %s through unchanged", async (limit) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ data: [], nextCursor: null })
      ) as unknown as typeof fetch;

      await makeClient(fetchMock)[method](1, { limit });

      const path = method === "listEvents" ? "events" : "transfers";
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.example.com/contracts/1/${path}?limit=${limit}`,
        expect.any(Object)
      );
    });

    it.each([undefined, {}, { limit: undefined }])(
      "omits an unspecified limit (%j)",
      async (params) => {
        const fetchMock = vi.fn(async () =>
          jsonResponse({ data: [], nextCursor: null })
        ) as unknown as typeof fetch;

        await makeClient(fetchMock)[method](1, params);

        const path = method === "listEvents" ? "events" : "transfers";
        expect(fetchMock).toHaveBeenCalledWith(
          `https://api.example.com/contracts/1/${path}`,
          expect.any(Object)
        );
      }
    );
  });

  it("sends the api key header and parses a successful response", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.com/contracts");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
      return jsonResponse([{ id: 1, address: "C123", name: null, network: "testnet" }]);
    }) as unknown as typeof fetch;

    const contracts = await makeClient(fetchMock).listContracts();

    expect(contracts).toEqual([{ id: 1, address: "C123", name: null, network: "testnet" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds query strings from list params, omitting undefined values", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.example.com/contracts/1/events?limit=5&topic=transfer");
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock).listEvents(1, { limit: 5, topic: "transfer" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.example.com/contracts");
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    await makeClient(fetchMock, "https://api.example.com/").listContracts();
  });

  it("posts a json body when registering a contract", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ address: "C1", network: "testnet" }));
      return jsonResponse({ id: 1, address: "C1", name: null, network: "testnet" }, 201);
    }) as unknown as typeof fetch;

    const contract = await makeClient(fetchMock).registerContract({
      address: "C1",
      network: "testnet"
    });
    expect(contract.id).toBe(1);
  });

  it("throws StellarLensApiError with the parsed json body on failure", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 })
    ) as unknown as typeof fetch;

    const error = await makeClient(fetchMock)
      .getContract(999)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StellarLensApiError);
    expect(error).toMatchObject({ status: 404, body: { message: "not found" } });
  });

  it("throws StellarLensApiError with raw text when the error body isn't json", async () => {
    const fetchMock = vi.fn(
      async () => new Response("internal error", { status: 500 })
    ) as unknown as typeof fetch;

    await expect(makeClient(fetchMock).getContract(1)).rejects.toMatchObject({
      status: 500,
      body: "internal error"
    });
  });
});
