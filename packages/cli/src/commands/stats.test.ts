import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractStats, StellarLensClient } from "@stellarlens/sdk";
import { showStats } from "./stats.js";

const STATS: ContractStats = {
  transferCount: 12,
  uniqueSenders: 3,
  uniqueReceivers: 5,
  volumeByAsset: [
    { asset: "USDC", volume: "1000000000000000000000" },
    { asset: "XLM", volume: "42" }
  ]
};

afterEach(() => {
  vi.restoreAllMocks();
});

function printed(logSpy: ReturnType<typeof vi.spyOn>): string[] {
  return logSpy.mock.calls.map((call: unknown[]) => call[0] as string);
}

describe("showStats", () => {
  it("prints transfer count, unique senders/receivers and volume by asset", async () => {
    const getStats = vi.fn().mockResolvedValue(STATS);
    const client = { getStats } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showStats(client, 1);

    expect(getStats).toHaveBeenCalledWith(1, { from: undefined, to: undefined });
    expect(printed(logSpy)).toEqual([
      "stats for contract 1",
      "transfers:        12",
      "unique senders:   3",
      "unique receivers: 5",
      "volume by asset:",
      "  USDC: 1000000000000000000000",
      "  XLM: 42"
    ]);
  });

  it("passes --from/--to through and shows the window", async () => {
    const getStats = vi.fn().mockResolvedValue({ ...STATS, transferCount: 2 });
    const client = { getStats } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showStats(client, 7, { from: "2026-01-01", to: "2026-02-01" });

    expect(getStats).toHaveBeenCalledWith(7, { from: "2026-01-01", to: "2026-02-01" });
    expect(printed(logSpy)[0]).toBe("stats for contract 7 (2026-01-01 → 2026-02-01)");
    expect(printed(logSpy)[1]).toBe("transfers:        2");
  });

  it("shows an open-ended window and an empty volume list", async () => {
    const getStats = vi.fn().mockResolvedValue({ ...STATS, transferCount: 0, volumeByAsset: [] });
    const client = { getStats } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showStats(client, 1, { from: "2026-01-01" });

    expect(printed(logSpy)[0]).toBe("stats for contract 1 (2026-01-01 → now)");
    expect(printed(logSpy)).toContain("volume by asset:  —");
  });
});
