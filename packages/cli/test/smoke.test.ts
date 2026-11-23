import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI_BIN = resolve(repoRoot, "packages/cli/dist/index.js");

describe("built CLI binary smoke tests", () => {
  it("exits 0 and prints a version for --version", () => {
    const result = spawnSync(process.execPath, [CLI_BIN, "--version"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it("exits 0 and prints help text for --help", () => {
    const result = spawnSync(process.execPath, [CLI_BIN, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});
