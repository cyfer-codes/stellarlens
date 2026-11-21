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

  describe("limit validation", () => {
    it("passes an in-range limit through unchanged", async () => {
      const eventFetch = vi.fn(async (url: string | URL) => {
        expect(String(url)).toBe("https://api.example.com/contracts/1/events?limit=100");
        return jsonResponse({ data: [], nextCursor: null });
      }) as unknown as typeof fetch;
      const transferFetch = vi.fn(async (url: string | URL) => {
        expect(String(url)).toBe("https://api.example.com/contracts/1/transfers?limit=1");
        return jsonResponse({ data: [], nextCursor: null });
      }) as unknown as typeof fetch;

      await makeClient(eventFetch).listEvents(1, { limit: 100 });
      await makeClient(transferFetch).listTransfers(1, { limit: 1 });

      expect(eventFetch).toHaveBeenCalledTimes(1);
      expect(transferFetch).toHaveBeenCalledTimes(1);
    });

    it("rejects limits outside 1-100 before making a request", async () => {
      const fetchMock = vi.fn() as unknown as typeof fetch;
      const client = makeClient(fetchMock);

      await expect(client.listEvents(1, { limit: 0 })).rejects.toThrow(RangeError);
      await expect(client.listEvents(1, { limit: 101 })).rejects.toThrow(
        /limit must be an integer between 1 and 100/
      );
      await expect(client.listTransfers(1, { limit: 0 })).rejects.toThrow(RangeError);
      await expect(client.listTransfers(1, { limit: 101 })).rejects.toThrow(
        /limit must be an integer between 1 and 100/
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.example.com/contracts");
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock, "https://api.example.com/").listContracts();
  });

  it("accepts a well-formed baseUrl with or without a trailing slash", () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;

    expect(() => makeClient(fetchMock, "https://api.example.com")).not.toThrow();
    expect(() => makeClient(fetchMock, "https://api.example.com/")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws immediately when baseUrl is malformed", () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;

    expect(() => makeClient(fetchMock, "not a url")).toThrow(TypeError);
    expect(() => makeClient(fetchMock, "not a url")).toThrow(/Invalid baseUrl/);
    expect(() => makeClient(fetchMock, "ftp://api.example.com")).toThrow(/http\(s\)/);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("ping calls GET /health and resolves with its status", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.com/health");
      expect(init?.method).toBe("GET");
      return jsonResponse({ status: "ok" });
    }) as unknown as typeof fetch;

    await expect(makeClient(fetchMock).ping()).resolves.toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ping rejects with StellarLensApiError when the api is unhealthy", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: "error" }), { status: 503 })
    ) as unknown as typeof fetch;

    await expect(makeClient(fetchMock).ping()).rejects.toBeInstanceOf(StellarLensApiError);
  });

  describe("webhooks", () => {
    const webhook = {
      id: 7,
      contractId: 1,
      url: "https://example.com/hook",
      secret: "whsec_test",
      eventTypes: ["transfer"],
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z"
    };

    it("registerWebhook posts the url and event types and returns the webhook with its secret", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.example.com/contracts/1/webhooks");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ url: "https://example.com/hook", eventTypes: ["transfer"] }));
        return jsonResponse(webhook, 201);
      }) as unknown as typeof fetch;

      const created = await makeClient(fetchMock).registerWebhook(1, {
        url: "https://example.com/hook",
        eventTypes: ["transfer"]
      });

      expect(created).toEqual(webhook);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("listWebhooks gets the contract's webhooks", async () => {
      const summaries = [
        { id: 7, url: "https://example.com/hook", eventTypes: null, createdAt: "2026-01-01T00:00:00.000Z" }
      ];
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.example.com/contracts/1/webhooks");
        expect(init?.method).toBe("GET");
        return jsonResponse(summaries);
      }) as unknown as typeof fetch;

      await expect(makeClient(fetchMock).listWebhooks(1)).resolves.toEqual(summaries);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("removeWebhook deletes the webhook and resolves on 204", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.example.com/contracts/1/webhooks/7");
        expect(init?.method).toBe("DELETE");
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch;

      await expect(makeClient(fetchMock).removeWebhook(1, 7)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("removeWebhook rejects with StellarLensApiError when the webhook doesn't exist", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ message: "webhook 99 not found" }), { status: 404 })
      ) as unknown as typeof fetch;

      await expect(makeClient(fetchMock).removeWebhook(1, 99)).rejects.toMatchObject({
        status: 404,
        body: { message: "webhook 99 not found" }
      });
    });
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
