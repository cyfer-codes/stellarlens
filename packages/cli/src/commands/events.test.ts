import { describe, expect, it, vi } from "vitest";
import type { StellarLensClient } from "@stellarlens/sdk";
import { pollNewEvents } from "./events.js";

function eventFixture(id: number, ledger: number) {
  return {
    id,
    contractId: 1,
    ledger,
    txHash: "a".repeat(64),
    topic: "[]",
    decodedData: { decoded: { topic: ["transfer"], value: "100" } },
    createdAt: "2026-01-01T00:00:00Z"
  };
}

describe("pollNewEvents", () => {
  it("advances the cursor to the last returned event's own id, not nextCursor", async () => {
    const listEvents = vi.fn().mockResolvedValue({
      data: [eventFixture(5, 100), eventFixture(8, 101)],
      nextCursor: null
    });
    const client = { listEvents } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    const nextCursor = await pollNewEvents(client, 1, undefined);

    expect(nextCursor).toBe(8);
    expect(listEvents).toHaveBeenCalledWith(1, { cursor: undefined, limit: 100 });
    expect(tableSpy).toHaveBeenCalled();
    tableSpy.mockRestore();
  });

  it("keeps the same cursor when there are no new events, rather than resetting via nextCursor", async () => {
    const listEvents = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const client = { listEvents } as unknown as StellarLensClient;

    const nextCursor = await pollNewEvents(client, 1, 42);

    expect(nextCursor).toBe(42);
  });

  it("passes the current cursor through on the next poll", async () => {
    const listEvents = vi.fn().mockResolvedValue({ data: [eventFixture(10, 200)], nextCursor: null });
    const client = { listEvents } as unknown as StellarLensClient;
    vi.spyOn(console, "table").mockImplementation(() => {});

    await pollNewEvents(client, 1, 8);

    expect(listEvents).toHaveBeenCalledWith(1, { cursor: 8, limit: 100 });
  });
});
