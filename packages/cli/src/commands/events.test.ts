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
