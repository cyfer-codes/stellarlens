import { afterEach, describe, expect, it, vi } from "vitest";

describe("indexer configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts a recognized Stellar network", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.STELLAR_NETWORK).toBe("testnet");
  });

  it("fails startup with a clear error for an unknown Stellar network", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnetwork");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'STELLAR_NETWORK must be one of: testnet, futurenet, mainnet, standalone; received "testnetwork"'
    );
  });

  it("defaults POLL_INTERVAL_MS to 5000", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("POLL_INTERVAL_MS", undefined);
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.POLL_INTERVAL_MS).toBe(5000);
  });

  it("reads POLL_INTERVAL_MS from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("POLL_INTERVAL_MS", "2000");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.POLL_INTERVAL_MS).toBe(2000);
  });

  it("rejects a non-positive POLL_INTERVAL_MS", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("POLL_INTERVAL_MS", "0");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'POLL_INTERVAL_MS must be a positive integer; received "0"'
    );
  });
});
