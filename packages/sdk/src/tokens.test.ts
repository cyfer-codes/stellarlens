import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTokenMovement, parseTransfer } from "./tokens.js";
import type { EventRecord } from "./types.js";

interface Sep41Fixture {
  name: string;
  topic: unknown[];
  value: unknown;
  transfer: { from: string; to: string; amount: string } | null;
  movement: { kind: string; from: string | null; to: string | null; amount: string; toMuxedId: string | null } | null;
}

// The same fixtures drive apps/indexer/test/transfers.test.ts (detectTransfer), so these helpers can't disagree
// with what the indexer stores as a transfer.
const { cases } = JSON.parse(
  readFileSync(new URL("../../../apps/indexer/test/fixtures/sep41-events.json", import.meta.url), "utf8")
) as { cases: Sep41Fixture[] };

function eventOf(topic: unknown[], value: unknown): EventRecord {
  return {
    id: 1,
    contractId: 1,
    ledger: 100,
    txHash: "a".repeat(64),
    topic: JSON.stringify(topic),
    createdAt: "2026-01-01T00:00:00Z",
    decodedData: {
      id: "0000000429496733696-0000000001",
      type: "contract",
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      inSuccessfulContractCall: true,
      raw: { topic: [], value: "" },
      decoded: { topic, value }
    }
  };
}

describe("parseTransfer (shared indexer fixtures)", () => {
  it.each(cases)("$name", ({ topic, value, transfer }) => {
    const parsed = parseTransfer(eventOf(topic, value));
    if (transfer === null) {
      expect(parsed).toBeNull();
    } else {
      expect(parsed && { from: parsed.from, to: parsed.to, amount: parsed.amount }).toEqual(transfer);
    }
  });

  it("exposes the muxed recipient id", () => {
    const parsed = parseTransfer(eventOf(["transfer", "GA", "GB"], { amount: "5", to_muxed_id: "77" }));
    expect(parsed).toEqual({ from: "GA", to: "GB", amount: "5", toMuxedId: "77" });
  });
});

describe("parseTokenMovement (shared indexer fixtures)", () => {
  it.each(cases)("$name", ({ topic, value, movement }) => {
    expect(parseTokenMovement(eventOf(topic, value))).toEqual(movement);
  });

  it("agrees with parseTransfer for every transfer", () => {
    for (const { topic, value } of cases) {
      const event = eventOf(topic, value);
      const transfer = parseTransfer(event);
      if (transfer) {
        expect(parseTokenMovement(event)).toEqual({ kind: "transfer", ...transfer });
      }
    }
  });
});

describe("events without decoded data", () => {
  it("returns null when decodedData is null", () => {
    const event = { ...eventOf([], null), decodedData: null };
    expect(parseTransfer(event)).toBeNull();
    expect(parseTokenMovement(event)).toBeNull();
  });
});
