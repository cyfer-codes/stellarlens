import { afterEach, describe, expect, it, vi } from "vitest";
import type { StellarLensClient, TransferRecord } from "@stellarlens/sdk";
import { formatTransfer, listTransfers } from "./transfers.js";

function transferFixture(id: number, ledger: number): TransferRecord {
  return {
    id,
    contractId: 1,
    from: "GFROM",
    to: "GTO",
    amount: "1000000000000000000000",
    asset: "USDC",
    txHash: "b".repeat(64),
    ledger,
    rpcEventId: null,
    createdAt: "2026-01-01T00:00:00Z"
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatTransfer", () => {
  it("keeps ledger, from, to, amount (as the exact decimal string), asset and tx hash", () => {
    expect(formatTransfer(transferFixture(1, 42))).toEqual({
      ledger: 42,
      from: "GFROM",
      to: "GTO",
      amount: "1000000000000000000000",
      asset: "USDC",
      "tx hash": "b".repeat(64)
    });
  });
});

describe("listTransfers", () => {
  it("prints a table of transfers for the contract", async () => {
    const listTransfersMock = vi
      .fn()
      .mockResolvedValue({ data: [transferFixture(1, 10), transferFixture(2, 11)], nextCursor: null });
    const client = { listTransfers: listTransfersMock } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTransfers(client, 1);

    expect(listTransfersMock).toHaveBeenCalledWith(1, { cursor: undefined, limit: undefined });
    expect(tableSpy).toHaveBeenCalledWith([formatTransfer(transferFixture(1, 10)), formatTransfer(transferFixture(2, 11))]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("passes --cursor and --limit through and prints the next cursor", async () => {
    const listTransfersMock = vi.fn().mockResolvedValue({ data: [transferFixture(6, 20)], nextCursor: 6 });
    const client = { listTransfers: listTransfersMock } as unknown as StellarLensClient;
    vi.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTransfers(client, 3, { cursor: 5, limit: 1 });

    expect(listTransfersMock).toHaveBeenCalledWith(3, { cursor: 5, limit: 1 });
    expect(logSpy).toHaveBeenCalledWith("more transfers available: fetch the next page with --cursor 6");
  });

  it("prints a message when there are no transfers", async () => {
    const client = {
      listTransfers: vi.fn().mockResolvedValue({ data: [], nextCursor: null })
    } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTransfers(client, 1);

    expect(tableSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("No transfers found.");
  });
});
