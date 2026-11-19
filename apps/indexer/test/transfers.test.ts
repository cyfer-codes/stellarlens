import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectTransfer } from "../src/transfers.js";

interface Sep41Fixture {
  name: string;
  topic: unknown[];
  value: unknown;
  transfer: { from: string; to: string; amount: string } | null;
}

// Shared with packages/sdk (parseTransfer / parseTokenMovement) so the SDK can't drift from what the indexer stores.
const { cases } = JSON.parse(
  readFileSync(new URL("./fixtures/sep41-events.json", import.meta.url), "utf8")
) as { cases: Sep41Fixture[] };

describe("detectTransfer", () => {
  it.each(cases.filter((c) => c.transfer !== null))("detects $name", ({ topic, value, transfer }) => {
    expect(detectTransfer(topic, value)).toEqual(transfer);
  });

  it.each(cases.filter((c) => c.transfer === null))("rejects $name", ({ topic, value }) => {
    expect(detectTransfer(topic, value)).toBeUndefined();
  });
});
