import { describe, expect, it } from "vitest";
import type { EventRow, TransferRow } from "@/lib/api";
import { TRANSFER_CSV_HEADERS, eventsToCsv, transfersToCsvRows } from "./csvExport";

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    contractId: 1,
    ledger: 100,
    txHash: "tx1",
    topic: "transfer",
    decodedData: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function transfer(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: 1,
    contractId: 1,
    from: "GSENDER",
    to: "GRECEIVER",
    amount: "10",
    asset: "USDC",
    txHash: "tx1",
    ledger: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("csvExport ingestion-time labeling", () => {
  it("labels the transfers timestamp column 'Indexed At', not 'Ledger Timestamp'", () => {
    expect(TRANSFER_CSV_HEADERS).toContain("Indexed At");
    expect(TRANSFER_CSV_HEADERS).not.toContain("Ledger Timestamp");
  });

  it("writes transfer.createdAt under the Indexed At column", () => {
    const indexedAtIndex = TRANSFER_CSV_HEADERS.indexOf("Indexed At");
    const row = transfersToCsvRows([transfer({ createdAt: "2026-03-01T12:00:00.000Z" })]);

    expect(row.split(",")[indexedAtIndex]).toBe("2026-03-01T12:00:00.000Z");
  });

  it("labels the events timestamp column 'indexed_at', not 'created_at'", () => {
    const csv = eventsToCsv([event({ createdAt: "2026-03-01T12:00:00.000Z" })]);
    const [header, row] = csv.split("\r\n");
    const columns = header.split(",");

    expect(columns).toContain("indexed_at");
    expect(columns).not.toContain("created_at");
    expect(row.split(",")[columns.indexOf("indexed_at")]).toBe("2026-03-01T12:00:00.000Z");
  });
});
