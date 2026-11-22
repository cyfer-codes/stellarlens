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

describe("detectTransfer SAC asset topic", () => {
  const from = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const to = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const amount = "1000000";
  const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

  const transferTopic = ["transfer", from, to];

  it("returns the asset string when topic[3] is a string asset identifier", () => {
    const topic = [...transferTopic, "USDC:GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"];
    expect(detectTransfer(topic, amount)).toEqual({
      from,
      to,
      amount,
      asset: "USDC:GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });
  });

  it("returns the native asset string when topic[3] is 'native'", () => {
    const topic = [...transferTopic, "native"];
    expect(detectTransfer(topic, amount)).toEqual({ from, to, amount, asset: "native" });
  });

  it("returns undefined asset when topic[3] is absent", () => {
    expect(detectTransfer(transferTopic, amount)).toEqual({ from, to, amount, asset: undefined });
  });

  it("returns undefined asset when topic[3] is not a string", () => {
    const topic = [...transferTopic, 12345];
    expect(detectTransfer(topic, amount)).toEqual({ from, to, amount, asset: undefined });
  });

  it("ignores the contract address argument for asset resolution", () => {
    const topic = [...transferTopic, "native"];
    expect(detectTransfer(topic, amount, contract)).toEqual({ from, to, amount, asset: "native" });
  });
});