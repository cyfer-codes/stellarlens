import { afterEach, describe, expect, it, vi } from "vitest";
import type { StellarLensClient } from "@stellarlens/sdk";
import { showStats } from "./stats.js";

describe("showStats (#28)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints transfer count, unique senders/receivers, and volume by asset with --from/--to", async () => {
    const getStatsMock = vi.fn().mockResolvedValue({
      transferCount: 42,
      uniqueSenders: 12,
      uniqueReceivers: 19,
      volumeByAsset: [{ asset: "native", volume: "950000000" }]
    });
    const client = { getStats: getStatsMock } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await showStats(client, 1, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z"
    });

    expect(getStatsMock).toHaveBeenCalledWith(1, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z"
    });
    expect(logSpy).toHaveBeenCalledWith("Transfer count:   42");
    expect(logSpy).toHaveBeenCalledWith("Unique senders:   12");
    expect(logSpy).toHaveBeenCalledWith("Unique receivers: 19");
    expect(tableSpy).toHaveBeenCalledWith([{ asset: "native", volume: "950000000" }]);
  });

  it("prints 'Volume by asset:  none' when volumeByAsset is empty", async () => {
    const client = {
      getStats: vi.fn().mockResolvedValue({
        transferCount: 0,
        uniqueSenders: 0,
        uniqueReceivers: 0,
        volumeByAsset: []
      })
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showStats(client, 1);

    expect(logSpy).toHaveBeenCalledWith("Volume by asset:  none");
  });
});
