import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMEOUT_MS, StellarLensClient, type StellarLensClientOptions } from "./client.js";
import { StellarLensTimeoutError } from "./errors.js";

const CONTRACT = { id: 1, address: "C1", name: null, network: "testnet" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeClient(fetchMock: unknown, options: Partial<StellarLensClientOptions> = {}) {
  return new StellarLensClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    fetch: fetchMock as typeof fetch,
    ...options
  });
}

/** A fetch that never settles on its own but rejects with the signal's reason once aborted, like real fetch. */
function hangingFetch() {
  const signals: Array<AbortSignal | undefined> = [];
  const fetchMock = vi.fn(
    (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        signals.push(signal);
        signal?.addEventListener("abort", () => reject(signal.reason));
      })
  );
  return { fetchMock, signals };
}

describe("request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a hung request after the default 10s and rejects with StellarLensTimeoutError", async () => {
    const { fetchMock, signals } = hangingFetch();
    const result = makeClient(fetchMock).getContract(1);
    const assertion = expect(result).rejects.toMatchObject({
      name: "StellarLensTimeoutError",
      method: "GET",
      url: "https://api.example.com/contracts/1",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      message: `stellarlens request GET https://api.example.com/contracts/1 timed out after ${DEFAULT_TIMEOUT_MS}ms`
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await assertion;
    await expect(result).rejects.toBeInstanceOf(StellarLensTimeoutError);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours a custom client timeoutMs", async () => {
    const { fetchMock } = hangingFetch();
    const result = makeClient(fetchMock, { timeoutMs: 50 }).listEvents(1);
    const assertion = expect(result).rejects.toMatchObject({ name: "StellarLensTimeoutError", timeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
  });

  it("lets a call override the client timeout", async () => {
    const { fetchMock } = hangingFetch();
    const result = makeClient(fetchMock, { timeoutMs: 60_000 }).getContract(1, { timeoutMs: 100 });
    const assertion = expect(result).rejects.toBeInstanceOf(StellarLensTimeoutError);

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
  });

  it("times out even when a custom fetch ignores the abort signal", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const result = makeClient(fetchMock, { timeoutMs: 20 }).getContract(1);
    const assertion = expect(result).rejects.toBeInstanceOf(StellarLensTimeoutError);

    await vi.advanceTimersByTimeAsync(20);

    await assertion;
  });

  it("times out while reading a response body that never finishes", async () => {
    const stalledBody = new ReadableStream<Uint8Array>({ start() {} });
    const fetchMock = vi.fn(async () => new Response(stalledBody, { status: 200 }));
    const result = makeClient(fetchMock, { timeoutMs: 30 }).getContract(1);
    const assertion = expect(result).rejects.toBeInstanceOf(StellarLensTimeoutError);

    await vi.advanceTimersByTimeAsync(30);

    await assertion;
  });

  it("can be disabled with timeoutMs: 0, leaving fetch without a signal", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => jsonResponse(CONTRACT));
    const client = makeClient(fetchMock, { timeoutMs: 0 });

    await expect(client.getContract(1)).resolves.toEqual(CONTRACT);

    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not time out a disabled-timeout request that takes a long time", async () => {
    const { fetchMock } = hangingFetch();
    let settled = false;
    void makeClient(fetchMock, { timeoutMs: 0 })
      .getContract(1)
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(10 * DEFAULT_TIMEOUT_MS);

    expect(settled).toBe(false);
  });

  it("clears the timer once a request succeeds", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT));

    await expect(makeClient(fetchMock).getContract(1)).resolves.toEqual(CONTRACT);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an invalid timeoutMs", () => {
    expect(() => makeClient(vi.fn(), { timeoutMs: -1 })).toThrow(RangeError);
    expect(() => makeClient(vi.fn(), { timeoutMs: Number.NaN })).toThrow(RangeError);
  });
});

describe("AbortSignal support", () => {
  it("does not send anything when the signal is already aborted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT));
    const onRequest = vi.fn();
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    controller.abort(reason);

    await expect(makeClient(fetchMock, { onRequest }).getContract(1, { signal: controller.signal })).rejects.toBe(
      reason
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("rejects with an AbortError for a pre-aborted signal without a custom reason", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], nextCursor: null }));

    await expect(makeClient(fetchMock).listEvents(1, undefined, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight fetch when the signal aborts", async () => {
    const { fetchMock, signals } = hangingFetch();
    const controller = new AbortController();
    const result = makeClient(fetchMock).listTransfers(1, undefined, { signal: controller.signal });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(signals[0]?.aborted).toBe(false);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("rejects mid-flight even when a custom fetch ignores the signal", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const reason = new Error("stop");
    const result = makeClient(fetchMock).getStats(1, undefined, { signal: controller.signal });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
  });

  it("aborts a mutation (deleteContract) mid-flight", async () => {
    const { fetchMock } = hangingFetch();
    const controller = new AbortController();
    const result = makeClient(fetchMock).deleteContract(1, { signal: controller.signal });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("works alongside a disabled timeout", async () => {
    const { fetchMock, signals } = hangingFetch();
    const controller = new AbortController();
    const result = makeClient(fetchMock, { timeoutMs: 0 }).getContract(1, { signal: controller.signal });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("leaves calls with a signal that never aborts unchanged", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONTRACT));
    const controller = new AbortController();

    await expect(makeClient(fetchMock).getContract(1, { signal: controller.signal })).resolves.toEqual(CONTRACT);
  });

  it("stops paging in listAllEvents once the signal aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 1 }], nextCursor: 2 }));
    const seen: number[] = [];

    const consume = (async () => {
      for await (const event of makeClient(fetchMock).listAllEvents(1, undefined, { signal: controller.signal })) {
        seen.push(event.id);
        controller.abort();
      }
    })();

    await expect(consume).rejects.toMatchObject({ name: "AbortError" });

    expect(seen).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
