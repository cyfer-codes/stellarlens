import { afterEach, describe, expect, it, vi } from "vitest";

describe("indexer configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts a recognized Stellar network", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.STELLAR_NETWORK).toBe("testnet");
  });

  it("fails startup when REGISTRY_SECRET is not set", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("REGISTRY_SECRET", undefined);
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      "REGISTRY_SECRET environment variable is required"
    );
  });

  it("fails startup with a clear error for an unknown Stellar network", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnetwork");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'STELLAR_NETWORK must be one of: testnet, futurenet, mainnet, standalone; received "testnetwork"'
    );
  });

  it("defaults POLL_INTERVAL_MS to 5000", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("POLL_INTERVAL_MS", undefined);
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.POLL_INTERVAL_MS).toBe(5000);
  });

  it("reads POLL_INTERVAL_MS from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("POLL_INTERVAL_MS", "2000");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.POLL_INTERVAL_MS).toBe(2000);
  });

  it("defaults webhook retry and timeout tuning when unset", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("WEBHOOK_MAX_RETRIES", undefined);
    vi.stubEnv("WEBHOOK_RETRY_BASE_DELAY_MS", undefined);
    vi.stubEnv("WEBHOOK_RETRY_MAX_DELAY_MS", undefined);
    vi.stubEnv("WEBHOOK_TIMEOUT_MS", undefined);
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.WEBHOOK_MAX_RETRIES).toBe(3);
    expect(config.WEBHOOK_RETRY_BASE_DELAY_MS).toBe(500);
    expect(config.WEBHOOK_RETRY_MAX_DELAY_MS).toBe(5000);
    expect(config.WEBHOOK_TIMEOUT_MS).toBe(5000);
  });

  it("reads webhook retry and timeout tuning from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("WEBHOOK_MAX_RETRIES", "0");
    vi.stubEnv("WEBHOOK_RETRY_BASE_DELAY_MS", "250");
    vi.stubEnv("WEBHOOK_RETRY_MAX_DELAY_MS", "10000");
    vi.stubEnv("WEBHOOK_TIMEOUT_MS", "15000");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.WEBHOOK_MAX_RETRIES).toBe(0);
    expect(config.WEBHOOK_RETRY_BASE_DELAY_MS).toBe(250);
    expect(config.WEBHOOK_RETRY_MAX_DELAY_MS).toBe(10000);
    expect(config.WEBHOOK_TIMEOUT_MS).toBe(15000);
  });

  it("rejects an invalid WEBHOOK_TIMEOUT_MS", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("WEBHOOK_TIMEOUT_MS", "0");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'WEBHOOK_TIMEOUT_MS must be a positive integer; received "0"'
    );
  });

  it("rejects a negative WEBHOOK_MAX_RETRIES", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("WEBHOOK_MAX_RETRIES", "-1");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'WEBHOOK_MAX_RETRIES must be a non-negative integer; received "-1"'
    );
  });

  it("rejects a WEBHOOK_RETRY_MAX_DELAY_MS below WEBHOOK_RETRY_BASE_DELAY_MS", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("WEBHOOK_RETRY_BASE_DELAY_MS", "2000");
    vi.stubEnv("WEBHOOK_RETRY_MAX_DELAY_MS", "1000");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      "WEBHOOK_RETRY_MAX_DELAY_MS (1000) must be greater than or equal to WEBHOOK_RETRY_BASE_DELAY_MS (2000)"
    );
  });

  it("rejects a non-positive POLL_INTERVAL_MS", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("POLL_INTERVAL_MS", "0");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'POLL_INTERVAL_MS must be a positive integer; received "0"'
    );
  });
});
