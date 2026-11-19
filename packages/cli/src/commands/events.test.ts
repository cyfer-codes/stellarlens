import { afterEach, describe, expect, it, vi } from "vitest";
import type { StellarLensClient } from "@stellarlens/sdk";
import { listEvents, pollNewEvents } from "./events.js";
import {
  MAX_BACKOFF_MS,
  POLL_INTERVAL_MS,
  nextPollDelay,
  parseSince,
  pollNewEvents,
  resolveStartCursor,
  tailEvents
} from "./events.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StellarLensClient, type EventRecord } from "@stellarlens/sdk";
import { formatEvent, tailEvents } from "./events.js";

function eventFixture(id: number, ledger: number): EventRecord {
  return {
    id,
    contractId: 1,
    ledger,
    txHash: "a".repeat(64),
    topic: "[]",
    decodedData: {
      id: "x",
      type: "contract",
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      inSuccessfulContractCall: true,
      raw: { topic: [], value: "" },
      decoded: { topic: ["transfer"], value: "100" }
    },
    createdAt: "2026-01-01T00:00:00Z"
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function page(...events: ReturnType<typeof eventFixture>[]) {
  return { data: events, nextCursor: null };
}

/** A sleep stub that records each delay and aborts the tail loop after `polls` waits. */
function stopAfter(polls: number) {
  const controller = new AbortController();
  const delays: number[] = [];
  const sleep = vi.fn(async (ms: number) => {
    delays.push(ms);
    if (delays.length >= polls) {
      controller.abort();
    }
  });
  return { sleep, signal: controller.signal, delays };
}

describe("pollNewEvents", () => {
  it("advances the cursor to the last returned event's own id, not nextCursor", async () => {
    const listEvents = vi.fn().mockResolvedValue({
      data: [eventFixture(5, 100), eventFixture(8, 101)],
      nextCursor: null
describe("formatEvent", () => {
  it("renders id, ledger, short tx hash and decoded topic/value on one line", () => {
    expect(formatEvent(eventFixture(5, 100))).toBe(
      `#5  ledger 100  tx ${"a".repeat(12)}…  topic ["transfer"]  value "100"`
    );
  });

  it("falls back to — when there is no decoded data", () => {
    expect(formatEvent({ ...eventFixture(1, 1), decodedData: null })).toContain("topic —  value —");
  });
});

describe("tailEvents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints every event yielded by watchEvents and forwards options", async () => {
    const watchEvents = vi.fn(async function* () {
      yield eventFixture(5, 100);
      yield eventFixture(8, 101);
    });
    const client = { watchEvents } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const signal = new AbortController().signal;

    await tailEvents(client, 3, { latest: true, intervalMs: 250, signal });

    expect(watchEvents).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ startAt: "latest", intervalMs: 250, signal })
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("#5"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("#8"));
  });

  it("replays from the start with the default interval when no options are given", async () => {
    const watchEvents = vi.fn(async function* () {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await tailEvents({ watchEvents } as unknown as StellarLensClient, 1);

    expect(watchEvents).toHaveBeenCalledWith(1, expect.objectContaining({ startAt: undefined, intervalMs: 5000 }));
  });
});

describe("tailEvents on the real SDK watchEvents (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never re-prints events once caught up, logs errors, and stops on abort", async () => {
    const responses: Array<() => Response> = [
      () => Response.json({ data: [eventFixture(5, 100), eventFixture(8, 101)], nextCursor: null }),
      () => Response.json({ data: [], nextCursor: null }),
      () => new Response("down", { status: 503 }),
      () => Response.json({ data: [eventFixture(9, 102)], nextCursor: null })
    ];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL) => {
      urls.push(new URL(String(url)).search);
      return (responses.shift() ?? (() => Response.json({ data: [], nextCursor: null })))();
    });
    const client = new StellarLensClient({ baseUrl: "https://api.test", apiKey: "k", fetch: fetchMock as typeof fetch });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();

    const done = tailEvents(client, 1, { intervalMs: 1000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1000); // poll 2: nothing new
    await vi.advanceTimersByTimeAsync(1000); // poll 3: 503
    await vi.advanceTimersByTimeAsync(2000); // backoff 2s, poll 4: event 9
    controller.abort();
    await done;

    const printed = logSpy.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("#"));
    expect(printed.map((line) => line.split(" ")[0])).toEqual(["#5", "#8", "#9"]);
    expect(urls).toEqual(["?limit=100", "?cursor=8&limit=100", "?cursor=8&limit=100", "?cursor=8&limit=100"]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("retrying in 2s"));
  });
});

describe("parseSince", () => {
  it("treats an integer as an event id cursor", () => {
    expect(parseSince("1234")).toEqual({ kind: "cursor", cursor: 1234 });
    expect(parseSince(" 0 ")).toEqual({ kind: "cursor", cursor: 0 });
  });

  it("treats an ISO 8601 date or date-time as a date", () => {
    expect(parseSince("2026-01-02")).toEqual({ kind: "date", date: new Date("2026-01-02T00:00:00Z") });
    expect(parseSince("2026-01-02T03:04:05+01:00")).toEqual({
      kind: "date",
      date: new Date("2026-01-02T02:04:05Z")
    });
  });

  it("rejects anything else", () => {
    for (const value of ["", "yesterday", "-5", "1.5", "2026-13-45", "Jan 2 2026"]) {
      expect(() => parseSince(value), value).toThrow(/--since must be/);
    }
  });
});

describe("resolveStartCursor", () => {
  it("starts at the latest event by default, via order=desc&limit=1", async () => {
    const listEvents = vi.fn().mockResolvedValue(page(eventFixture(9001, 500)));
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1)).resolves.toBe(9001);
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledWith(1, { order: "desc", limit: 1 });
  });

  it("starts with no cursor when the contract has no events yet", async () => {
    const listEvents = vi.fn().mockResolvedValue(page());
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1)).resolves.toBeUndefined();
  });

  it("replays all history with fromStart, without querying", async () => {
    const listEvents = vi.fn();
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1, { fromStart: true })).resolves.toBeUndefined();
    expect(listEvents).not.toHaveBeenCalled();
  });

  it("uses a --since cursor as-is", async () => {
    const listEvents = vi.fn();
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1, { since: "42" })).resolves.toBe(42);
    await expect(resolveStartCursor(client, 1, { since: "0" })).resolves.toBeUndefined();
    expect(listEvents).not.toHaveBeenCalled();
  });

  it("starts just before the first event at/after a --since date", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page(eventFixture(900, 500))) // latest
      .mockResolvedValueOnce(page(eventFixture(77, 300))); // first since the date
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1, { since: "2026-01-01" })).resolves.toBe(76);
    expect(listEvents).toHaveBeenNthCalledWith(1, 1, { order: "desc", limit: 1 });
    expect(listEvents).toHaveBeenNthCalledWith(2, 1, { from: "2026-01-01T00:00:00.000Z", limit: 1 });
  });

  it("omits the cursor when the first event since the date is event 1", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page(eventFixture(5, 500)))
      .mockResolvedValueOnce(page(eventFixture(1, 100)));
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1, { since: "2020-01-01" })).resolves.toBeUndefined();
  });

  it("falls back to the latest event when nothing was indexed since the date", async () => {
    const listEvents = vi.fn().mockResolvedValueOnce(page(eventFixture(900, 500))).mockResolvedValueOnce(page());
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1, { since: "2099-01-01T00:00:00Z" })).resolves.toBe(900);
  });

  it("rejects --since together with --from-start", async () => {
    const client = { listEvents: vi.fn() } as unknown as StellarLensClient;

    await expect(resolveStartCursor(client, 1, { since: "1", fromStart: true })).rejects.toThrow(
      "can't be used together"
    );
  });
});

describe("nextPollDelay", () => {
  it("polls at the normal interval while healthy, and backs off exponentially up to a cap", () => {
    expect(nextPollDelay(0)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay(1)).toBe(POLL_INTERVAL_MS * 2);
    expect(nextPollDelay(2)).toBe(POLL_INTERVAL_MS * 4);
    expect(nextPollDelay(3)).toBe(POLL_INTERVAL_MS * 8);
    expect(nextPollDelay(10)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay(1000)).toBe(MAX_BACKOFF_MS);
  });
});

describe("tailEvents", () => {
  it("starts at the latest event and only prints events that arrive afterwards", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page(eventFixture(500, 50))) // latest, at startup
      .mockResolvedValueOnce(page()) // first poll: nothing new
      .mockResolvedValueOnce(page(eventFixture(501, 51))); // second poll: one new event
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    const { sleep, signal } = stopAfter(2);

    await tailEvents(client, 1, {}, { sleep, signal });

    expect(listEvents).toHaveBeenNthCalledWith(1, 1, { order: "desc", limit: 1 });
    expect(listEvents).toHaveBeenNthCalledWith(2, 1, { cursor: 500, limit: 100 });
    expect(listEvents).toHaveBeenNthCalledWith(3, 1, { cursor: 500, limit: 100 });
    expect(tableSpy).toHaveBeenCalledTimes(1);
    expect(tableSpy.mock.calls[0][0]).toEqual([expect.objectContaining({ id: "501" })]);
  });

  it("starts from a --since cursor", async () => {
    const listEvents = vi.fn().mockResolvedValue(page());
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sleep, signal } = stopAfter(1);

    await tailEvents(client, 1, { since: "123" }, { sleep, signal });

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledWith(1, { cursor: 123, limit: 100 });
  });

  it("starts from a --since date", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page(eventFixture(900, 500)))
      .mockResolvedValueOnce(page(eventFixture(77, 300)))
      .mockResolvedValue(page());
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sleep, signal } = stopAfter(1);

    await tailEvents(client, 1, { since: "2026-01-01T00:00:00Z" }, { sleep, signal });

    expect(listEvents).toHaveBeenLastCalledWith(1, { cursor: 76, limit: 100 });
  });

  it("replays from the start with --from-start", async () => {
    const listEvents = vi.fn().mockResolvedValue(page());
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sleep, signal } = stopAfter(1);

    await tailEvents(client, 1, { fromStart: true }, { sleep, signal });

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledWith(1, { cursor: undefined, limit: 100 });
  });

  it("backs off on consecutive failures and resets after a success", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page(eventFixture(10, 1))) // latest
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error("503"));
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sleep, signal, delays } = stopAfter(5);

    await tailEvents(client, 1, {}, { sleep, signal });

    expect(delays).toEqual([10_000, 20_000, 40_000, POLL_INTERVAL_MS, 10_000]);
    expect(errorSpy).toHaveBeenCalledWith("failed to fetch events (3 in a row, retrying in 40s):", "503");
    // the cursor survives failed polls
    expect(listEvents).toHaveBeenLastCalledWith(1, { cursor: 10, limit: 100 });
  });

  it("retries resolving the start position when it fails, instead of falling back to the oldest events", async () => {
    const listEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(page(eventFixture(10, 1)))
      .mockResolvedValue(page());
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sleep, signal } = stopAfter(2);

    await tailEvents(client, 1, {}, { sleep, signal });

    expect(listEvents).toHaveBeenNthCalledWith(1, 1, { order: "desc", limit: 1 });
    expect(listEvents).toHaveBeenNthCalledWith(2, 1, { order: "desc", limit: 1 });
    expect(listEvents).toHaveBeenNthCalledWith(3, 1, { cursor: 10, limit: 100 });
  });

  it("fails fast on an invalid --since instead of retrying forever", async () => {
    const listEvents = vi.fn();
    const client = { listEvents } as unknown as StellarLensClient;

    await expect(tailEvents(client, 1, { since: "yesterday" })).rejects.toThrow(/--since must be/);
    await expect(tailEvents(client, 1, { since: "1", fromStart: true })).rejects.toThrow("can't be used together");
    expect(listEvents).not.toHaveBeenCalled();
  });
});

describe("listEvents", () => {
  it("passes paging and filter options through and prints the next cursor", async () => {
    const listEventsMock = vi.fn().mockResolvedValue({ data: [eventFixture(3, 100)], nextCursor: 3 });
    const client = { listEvents: listEventsMock } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listEvents(client, 1, { limit: 1, cursor: 2, topic: "transfer", from: "2026-01-01" });

    expect(listEventsMock).toHaveBeenCalledWith(1, {
      cursor: 2,
      limit: 1,
      topic: "transfer",
      from: "2026-01-01",
      to: undefined
    });
    expect(tableSpy).toHaveBeenCalledWith([expect.objectContaining({ id: "3", ledger: "100" })]);
    expect(logSpy).toHaveBeenCalledWith("more events available: fetch the next page with --cursor 3");
    tableSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("prints a message when there are no events", async () => {
    const client = {
      listEvents: vi.fn().mockResolvedValue({ data: [], nextCursor: null })
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listEvents(client, 1);

    expect(logSpy).toHaveBeenCalledWith("No events found.");
    logSpy.mockRestore();
  });
});
