import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `sideEffects: false` lets consumer bundlers tree-shake unused SDK exports. It is
// correct only while the entry points (src/index.ts, src/webhooks.ts) do nothing
// observable at import time: no globals, polyfills, listeners or timers outside
// functions. Keep it that way, or remove the flag along with this test.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  sideEffects?: unknown;
};

describe("package tree-shaking contract", () => {
  it("declares sideEffects: false", () => {
    expect(pkg.sideEffects).toBe(false);
  });
});
