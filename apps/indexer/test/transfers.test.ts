import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectTokenMovement } from "../src/transfers.js";

interface Sep41Fixture {
  name: string;
  topic: unknown[];
  value: unknown;
  movement:
    | {
        kind: "transfer" | "mint" | "burn" | "clawback";
        from: string | null;
        to: string | null;
        amount: string;
        toMuxedId?: string | null;
      }
    | null;
}

// Shared with packages/sdk (parseTransfer / parseTokenMovement) so the SDK can't drift from what the indexer stores.
const { cases } = JSON.parse(
  readFileSync(new URL("./fixtures/sep41-events.json", import.meta.url), "utf8")
) as { cases: Sep41Fixture[] };

describe("detectTokenMovement", () => {
  it.each(cases.filter((c) => c.movement !== null))(
    "detects $name",
    ({ topic, value, movement }) => {
      expect(detectTokenMovement(topic, value)).toEqual(movement);
    }
  );

  it.each(cases.filter((c) => c.movement === null))("rejects $name", ({ topic, value }) => {
    expect(detectTokenMovement(topic, value)).toBeUndefined();
  });
});