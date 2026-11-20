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
  it("sends the api key header and parses a successful response", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.com/contracts/1");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
      return jsonResponse({ id: 1, address: "C123", name: null, network: "testnet" });
    }) as unknown as typeof fetch;

    const contracts = await makeClient(fetchMock).getContract(1);

    expect(contracts).toEqual({ id: 1, address: "C123", name: null, network: "testnet" });
      return jsonResponse({ data: [{ id: 1, address: "C123", name: null, network: "testnet" }], nextCursor: null });
    }) as unknown as typeof fetch;

    const page = await makeClient(fetchMock).listContracts();

    expect(contracts).toEqual({
      data: [{ id: 1, address: "C123", name: null, network: "testnet" }],
      nextCursor: null
    });
    expect(page).toEqual({ data: [{ id: 1, address: "C123", name: null, network: "testnet" }], nextCursor: null });
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

  it("paginates and filters listContracts", async () => {
    const page = { data: [{ id: 3, address: "C3", name: "token", network: "testnet" }], nextCursor: 3 };
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.example.com/contracts?cursor=2&limit=1&network=testnet");
      return jsonResponse(page);
    }) as unknown as typeof fetch;

    await expect(makeClient(fetchMock).listContracts({ cursor: 2, limit: 1, network: "testnet" })).resolves.toEqual(
      page
    );
  });

  it("sends the transfer filters", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(
        "https://api.example.com/contracts/1/transfers?minAmount=170141183460469231731687303715884105727&from=GA&to=GB&asset=native"
      );
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock).listTransfers(1, {
      minAmount: "170141183460469231731687303715884105727",
      from: "GA",
      to: "GB",
      asset: "native"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends array filters comma-separated", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(new URL(String(url)).searchParams.get("topics")).toBe("transfer,mint");
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock).listEvents(1, { topics: ["transfer", "mint"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.example.com/contracts");
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock, "https://api.example.com/").listContracts();
  });

  it("passes contract list pagination and filters as query params", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.example.com/contracts?cursor=20&limit=100&network=testnet");
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock).listContracts({ cursor: 20, limit: 100, network: "testnet" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts a json body when registering a contract", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ address: "C1", network: "testnet" }));
      return jsonResponse({ id: 1, address: "C1", name: null, network: "testnet" }, 201);
    }) as unknown as typeof fetch;

    const contract = await makeClient(fetchMock).registerContract({ address: "C1", network: "testnet" });
    expect(contract.id).toBe(1);
  });

  it("posts an items envelope to /contracts/bulk", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.com/contracts/bulk");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ items: [{ address: "C1", network: "testnet" }] }));
      return jsonResponse(
        {
          results: [
            { index: 0, address: "C1", network: "testnet", name: null, status: "created", id: 1 }
          ]
        },
        201
      );
    }) as unknown as typeof fetch;

    const response = await makeClient(fetchMock).registerContractsBulk([
      { address: "C1", network: "testnet" }
    ]);
    expect(response.results[0]).toMatchObject({ status: "created", id: 1 });
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
    const fetchMock = vi.fn(async () => new Response("internal error", { status: 500 })) as unknown as typeof fetch;

    await expect(makeClient(fetchMock).getContract(1)).rejects.toMatchObject({
      status: 500,
      body: "internal error"
    });
  });

  describe("contracts pagination", () => {
    const contract = (id: number) => ({ id, address: `C${id}`, name: null, network: "testnet" });

    it("passes cursor, limit, name and network to GET /contracts", async () => {
      const fetchMock = vi.fn(async (url: string | URL) => {
        expect(String(url)).toBe("https://api.example.com/contracts?cursor=10&limit=5&name=tok&network=testnet");
        return jsonResponse({ data: [contract(11)], nextCursor: 11 });
      }) as unknown as typeof fetch;

      const page = await makeClient(fetchMock).listContracts({
        cursor: 10,
        limit: 5,
        name: "tok",
        network: "testnet"
      });

      expect(page.nextCursor).toBe(11);
      expect(page.data).toHaveLength(1);
    });

    it("listAllContracts follows nextCursor until it is null, keeping the filters", async () => {
      const urls: string[] = [];
      const pages: Record<string, unknown> = {
        "": { data: [contract(1), contract(2)], nextCursor: 2 },
        "2": { data: [contract(3), contract(4)], nextCursor: 4 },
        "4": { data: [contract(5)], nextCursor: null }
      };
      const fetchMock = vi.fn(async (url: string | URL) => {
        const parsed = new URL(String(url));
        urls.push(parsed.search);
        return jsonResponse(pages[parsed.searchParams.get("cursor") ?? ""]);
      }) as unknown as typeof fetch;

      const ids: number[] = [];
      for await (const c of makeClient(fetchMock).listAllContracts({ limit: 2, network: "testnet" })) {
        ids.push(c.id);
      }

      expect(ids).toEqual([1, 2, 3, 4, 5]);
      expect(urls).toEqual([
        "?limit=2&network=testnet",
        "?limit=2&network=testnet&cursor=2",
        "?limit=2&network=testnet&cursor=4"
      ]);
    });

    it("listAllContracts fetches pages lazily", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ data: [contract(1), contract(2)], nextCursor: 2 })
      ) as unknown as typeof fetch;

      for await (const c of makeClient(fetchMock).listAllContracts()) {
        expect(c.id).toBe(1);
        break;
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
