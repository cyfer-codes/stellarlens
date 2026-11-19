import { describe, expect, it, vi } from "vitest";
import { StellarLensClient, type StellarLensClientOptions } from "./client.js";
import { StellarLensApiError, StellarLensHookError } from "./errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CONTRACT = { id: 1, address: "C1", name: null, network: "testnet" };

function makeClient(fetchMock: typeof fetch, hooks: Pick<StellarLensClientOptions, "onRequest" | "onResponse">) {
  return new StellarLensClient({ baseUrl: "https://api.example.com", apiKey: "test-key", fetch: fetchMock, ...hooks });
}

describe("onRequest", () => {
  it("receives the url, method and headers before the request is sent", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT, 201)) as unknown as typeof fetch;
    const onRequest = vi.fn();

    await makeClient(fetchMock, { onRequest }).registerContract({ address: "C1", network: "testnet" });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0]).toMatchObject({
      url: "https://api.example.com/contracts",
      method: "POST",
      body: JSON.stringify({ address: "C1", network: "testnet" }),
      headers: { "x-api-key": "test-key", "Content-Type": "application/json" }
    });
  });

  it("defaults the method to GET", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;
    const onRequest = vi.fn();

    await makeClient(fetchMock, { onRequest }).getContract(1);

    expect(onRequest.mock.calls[0][0]).toMatchObject({ method: "GET", url: "https://api.example.com/contracts/1" });
  });

  it("can add headers by mutating init", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).traceparent).toBe("00-trace-span-01");
      expect(init).not.toHaveProperty("url");
      return jsonResponse(CONTRACT);
    }) as unknown as typeof fetch;

    await makeClient(fetchMock, {
      onRequest(init) {
        init.headers.traceparent = "00-trace-span-01";
      }
    }).getContract(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can return a replacement init, asynchronously", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://proxy.example.com/contracts/1");
      expect((init?.headers as Record<string, string>)["x-request-id"]).toBe("abc");
      return jsonResponse(CONTRACT);
    }) as unknown as typeof fetch;

    await makeClient(fetchMock, {
      async onRequest(init) {
        await Promise.resolve();
        return {
          ...init,
          url: init.url.replace("api.example.com", "proxy.example.com"),
          headers: { ...init.headers, "x-request-id": "abc" }
        };
      }
    }).getContract(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a throwing hook as StellarLensHookError and does not send the request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;
    const cause = new Error("tracer not initialised");

    const error = await makeClient(fetchMock, {
      onRequest() {
        throw cause;
      }
    })
      .getContract(1)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StellarLensHookError);
    expect(error).toMatchObject({
      name: "StellarLensHookError",
      hook: "onRequest",
      method: "GET",
      url: "https://api.example.com/contracts/1",
      cause,
      message: "stellarlens onRequest hook threw for GET https://api.example.com/contracts/1: tracer not initialised"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps rejected promises and non-Error throws too", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;

    await expect(
      makeClient(fetchMock, { onRequest: () => Promise.reject("nope") }).getContract(1)
    ).rejects.toMatchObject({ hook: "onRequest", cause: "nope", message: expect.stringContaining(": nope") });
  });
});

describe("onResponse", () => {
  it("receives the response and a duration for successful calls", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;
    const onResponse = vi.fn();

    const contract = await makeClient(fetchMock, { onResponse }).getContract(1);

    expect(contract).toEqual(CONTRACT);
    expect(onResponse).toHaveBeenCalledTimes(1);
    const info = onResponse.mock.calls[0][0];
    expect(info.url).toBe("https://api.example.com/contracts/1");
    expect(info.method).toBe("GET");
    expect(info.response).toBeInstanceOf(Response);
    expect(info.response.status).toBe(200);
    expect(typeof info.durationMs).toBe("number");
    expect(info.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("measures the time spent in fetch", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);
    try {
      const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;
      const onResponse = vi.fn();

      await makeClient(fetchMock, { onResponse }).getContract(1);

      expect(onResponse.mock.calls[0][0].durationMs).toBe(250);
    } finally {
      now.mockRestore();
    }
  });

  it("is called for error responses before StellarLensApiError is thrown", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 })
    ) as unknown as typeof fetch;
    const statuses: number[] = [];

    await expect(
      makeClient(fetchMock, { onResponse: ({ response }) => void statuses.push(response.status) }).getContract(9)
    ).rejects.toBeInstanceOf(StellarLensApiError);
    expect(statuses).toEqual([404]);
  });

  it("lets the hook read a clone of the body without breaking the client", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;
    let seen: unknown;

    const contract = await makeClient(fetchMock, {
      async onResponse({ response }) {
        seen = await response.clone().json();
      }
    }).getContract(1);

    expect(seen).toEqual(CONTRACT);
    expect(contract).toEqual(CONTRACT);
  });

  it("surfaces a throwing hook as StellarLensHookError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT)) as unknown as typeof fetch;
    const cause = new Error("metrics backend down");

    await expect(
      makeClient(fetchMock, {
        async onResponse() {
          throw cause;
        }
      }).getContract(1)
    ).rejects.toMatchObject({ name: "StellarLensHookError", hook: "onResponse", cause });
  });

  it("is not called when fetch itself rejects", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const onResponse = vi.fn();

    await expect(makeClient(fetchMock, { onResponse }).getContract(1)).rejects.toThrow("fetch failed");
    expect(onResponse).not.toHaveBeenCalled();
  });
});

describe("hooks together", () => {
  it("run in order around each request", async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async () => {
      order.push("fetch");
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;

    await makeClient(fetchMock, {
      onRequest: () => void order.push("onRequest"),
      onResponse: () => void order.push("onResponse")
    }).listEvents(1);

    expect(order).toEqual(["onRequest", "fetch", "onResponse"]);
  });
});
