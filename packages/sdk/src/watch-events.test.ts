import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StellarLensClient } from "./client.js";
import type { EventRecord } from "./types.js";

function event(id: number): EventRecord {
  return {
    id,
    contractId: 1,
    ledger: 1000 + id,
    txHash: "a".repeat(64),
    topic: "[]",
    decodedData: null,
    createdAt: "2026-01-01T00:00:00Z"
  };
}

function page(ids: number[], nextCursor: number | null = null) {
  return { data: ids.map(event), nextCursor };
}

type Responder = (url: URL, init?: RequestInit) => unknown;

/** A fetch mock that answers each call with the next responder; the last responder repeats. */
function scriptedFetch(responders: Responder[]) {
  const urls: string[] = [];
  let call = 0;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url.search);
    const responder = responders[Math.min(call++, responders.length - 1)];
    const body = responder(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { fetchMock, urls };
}

function client(fetchMock: unknown) {
  return new StellarLensClient({
    baseUrl: "https://api.example.com",
    apiKey: "k",
    fetch: fetchMock as typeof fetch
  });
}

/** Pulls `count` events from the iterator, advancing fake timers whenever it is waiting. */
async function take(iterator: AsyncIterator<EventRecord>, count: number, stepMs = 100, maxMs = 600_000) {
  const out: number[] = [];
  let elapsed = 0;
  while (out.length < count) {
    let settled = false;
    const next = iterator.next().then((r) => {
      settled = true;
      return r;
    });
    while (!settled) {
      if (elapsed > maxMs) throw new Error(`timed out after ${out.length} events`);
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    const result = await next;
    if (result.done) break;
    out.push(result.value.id);
  }
  return out;
}

describe("StellarLensClient.watchEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("yields events and advances the cursor to the last returned id, not nextCursor", async () => {
    const { fetchMock, urls } = scriptedFetch([
      () => page([1, 2]),
      () => page([]),
      () => page([3]),
      () => page([])
    ]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { intervalMs: 1000, signal: controller.signal });

    expect(await take(watch, 3)).toEqual([1, 2, 3]);
    controller.abort();

    expect(urls.slice(0, 3)).toEqual(["?limit=100", "?cursor=2&limit=100", "?cursor=2&limit=100"]);
  });

  it("waits intervalMs between polls once caught up", async () => {
    const { fetchMock } = scriptedFetch([() => page([1]), () => page([])]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { intervalMs: 5000, signal: controller.signal });

    await watch.next();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const pending = watch.next();
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    controller.abort();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });

  it("drains a backlog immediately while pages are full (nextCursor set)", async () => {
    const { fetchMock, urls } = scriptedFetch([() => page([1, 2], 2), () => page([3, 4], 4), () => page([5])]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { intervalMs: 60_000, limit: 2, signal: controller.signal });

    // No timer advancement needed: all three pages come back-to-back.
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(((await watch.next()).value as EventRecord).id);
    }
    controller.abort();

    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(urls).toEqual(["?limit=2", "?cursor=2&limit=2", "?cursor=4&limit=2"]);
  });

  it("starts after a numeric startAt cursor and forwards the topic filter", async () => {
    const { fetchMock, urls } = scriptedFetch([() => page([43])]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(7, {
      startAt: 42,
      topic: "transfer",
      signal: controller.signal
    });

    expect((await watch.next()).value?.id).toBe(43);
    controller.abort();
    expect(urls[0]).toBe("?cursor=42&limit=100&topic=transfer");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/contracts/7/events");
  });

  it('startAt: "latest" skips existing events and yields only new ones', async () => {
    const { fetchMock, urls } = scriptedFetch([
      () => page([1, 2], 2), // existing backlog, skipped
      () => page([3]), // last existing page, skipped
      () => page([]), // first real poll: nothing new
      () => page([4]) // a new event
    ]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, {
      startAt: "latest",
      intervalMs: 1000,
      limit: 2,
      signal: controller.signal
    });

    expect(await take(watch, 1)).toEqual([4]);
    controller.abort();
    expect(urls).toEqual(["?limit=2", "?cursor=2&limit=2", "?cursor=3&limit=2", "?cursor=3&limit=2"]);
  });

  it('startAt: "latest" on a contract with no events yields from the first new event', async () => {
    const { fetchMock } = scriptedFetch([() => page([]), () => page([1])]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { startAt: "latest", intervalMs: 1000, signal: controller.signal });

    expect(await take(watch, 1)).toEqual([1]);
    controller.abort();
  });

  it("backs off exponentially on errors, capped at maxBackoffMs, and resets after a success", async () => {
    const fail = () => new Response("boom", { status: 503 });
    const { fetchMock } = scriptedFetch([fail, fail, fail, fail, () => page([1]), fail, () => page([2])]);
    const onError = vi.fn();
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, {
      intervalMs: 1000,
      maxBackoffMs: 10_000,
      onError,
      signal: controller.signal
    });

    expect(await take(watch, 2)).toEqual([1, 2]);
    controller.abort();

    expect(onError.mock.calls.map(([, info]) => info)).toEqual([
      { attempt: 1, retryInMs: 2000 },
      { attempt: 2, retryInMs: 4000 },
      { attempt: 3, retryInMs: 8000 },
      { attempt: 4, retryInMs: 10_000 },
      // reset after the success
      { attempt: 1, retryInMs: 2000 }
    ]);
    expect(onError.mock.calls[0][0]).toMatchObject({ status: 503 });
  });

  it("does not hit the api again until the backoff delay has elapsed", async () => {
    const { fetchMock } = scriptedFetch([() => new Response("down", { status: 500 }), () => page([1])]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { intervalMs: 1000, signal: controller.signal });

    const next = watch.next();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toMatchObject({ value: { id: 1 } });
    controller.abort();
  });

  it("finishes without throwing when aborted while waiting", async () => {
    const { fetchMock } = scriptedFetch([() => page([])]);
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { intervalMs: 60_000, signal: controller.signal });

    const next = watch.next();
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();

    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the signal to fetch and finishes when aborted mid-request", async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seenSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const onError = vi.fn();
    const controller = new AbortController();
    const watch = client(fetchMock).watchEvents(1, { signal: controller.signal, onError });

    const next = watch.next();
    await vi.advanceTimersByTimeAsync(0);
    expect(seenSignal).toBe(controller.signal);
    controller.abort();

    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns immediately when the signal is already aborted", async () => {
    const { fetchMock } = scriptedFetch([() => page([1])]);
    const watch = client(fetchMock).watchEvents(1, { signal: AbortSignal.abort() });

    await expect(watch.next()).resolves.toEqual({ done: true, value: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops polling when the consumer breaks out of for-await", async () => {
    const { fetchMock } = scriptedFetch([() => page([1, 2, 3])]);

    for await (const e of client(fetchMock).watchEvents(1, { intervalMs: 1000 })) {
      if (e.id === 2) break;
    }
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
