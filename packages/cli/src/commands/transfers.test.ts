import { afterEach, describe, expect, it, vi } from "vitest";
import type { StellarLensClient, TransferRecord } from "@stellarlens/sdk";
import { listTransfers } from "./transfers.js";

function transferFixture(id: number, ledger = 100): TransferRecord {
  return {
    id,
    contractId: 1,
    ledger,
    from: "GFROM123",
    to: "GTO456",
    amount: "10000000",
    asset: "native",
    txHash: "b".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("listTransfers (#27)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a table of transfers and passes --cursor and --limit through", async () => {
    const listTransfersMock = vi.fn().mockResolvedValue({
      data: [transferFixture(10, 200)],
      nextCursor: 10
    });
    const client = { listTransfers: listTransfersMock } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTransfers(client, 1, { cursor: 5, limit: 25 });

    expect(listTransfersMock).toHaveBeenCalledWith(1, { cursor: 5, limit: 25 });
    expect(tableSpy).toHaveBeenCalledWith([
      {
        id: 10,
        ledger: 200,
        from: "GFROM123",
        to: "GTO456",
        amount: "10000000",
        asset: "native",
        txHash: "b".repeat(64)
      }
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      "more transfers available: fetch the next page with --cursor 10"
    );
  });

  it("prints a message when there are no transfers", async () => {
    const client = {
      listTransfers: vi.fn().mockResolvedValue({ data: [], nextCursor: null })
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTransfers(client, 1);

    expect(logSpy).toHaveBeenCalledWith("No transfers found.");
  });
});
