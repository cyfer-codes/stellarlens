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

  it("defaults EVENTS_BATCH_LIMIT to 100 when unset", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("EVENTS_BATCH_LIMIT", undefined);
  it("reads REGISTRY_PORT from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("REGISTRY_PORT", "4000");
  it("parses a comma-separated SOROBAN_RPC_URL into an ordered list", async () => {
    vi.stubEnv(
      "SOROBAN_RPC_URL",
      "https://primary.example.com, https://secondary.example.com ,https://tertiary.example.com"
    );
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.EVENTS_BATCH_LIMIT).toBe(100);
  });

  it("reads EVENTS_BATCH_LIMIT from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("EVENTS_BATCH_LIMIT", "250");
    expect(config.SOROBAN_RPC_URLS).toEqual([
      "https://primary.example.com",
      "https://secondary.example.com",
      "https://tertiary.example.com",
    ]);
    expect(config.SOROBAN_RPC_URL).toBe("https://primary.example.com");
  });

  it("treats a single SOROBAN_RPC_URL as a one-element list", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.SOROBAN_RPC_URLS).toEqual(["https://rpc.example.com"]);
    expect(config.SOROBAN_RPC_URL).toBe("https://rpc.example.com");
  });

  it("rejects an empty SOROBAN_RPC_URL list", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", " , ,");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      "SOROBAN_RPC_URL must contain at least one endpoint"
    );
  });

  it("defaults RPC failover tuning when unset", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("RPC_FAILOVER_THRESHOLD", undefined);
    vi.stubEnv("RPC_PRIMARY_PROBE_INTERVAL_MS", undefined);
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.EVENTS_BATCH_LIMIT).toBe(250);
  });

  it("falls back to 100 for a non-numeric EVENTS_BATCH_LIMIT", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("EVENTS_BATCH_LIMIT", "not-a-number");
    expect(config.RPC_FAILOVER_THRESHOLD).toBe(3);
    expect(config.RPC_PRIMARY_PROBE_INTERVAL_MS).toBe(60000);
  });

  it("reads RPC failover tuning from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("RPC_FAILOVER_THRESHOLD", "5");
    vi.stubEnv("RPC_PRIMARY_PROBE_INTERVAL_MS", "15000");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.EVENTS_BATCH_LIMIT).toBe(100);
  });

  it("falls back to 100 for an empty or whitespace-only EVENTS_BATCH_LIMIT", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
      vi.stubEnv("STELLAR_NETWORK", "testnet");
      vi.stubEnv("EVENTS_BATCH_LIMIT", value);
      vi.resetModules();

      const config = await import("../src/config.js");

      expect(config.EVENTS_BATCH_LIMIT).toBe(100);
    }
  });

  it("never produces NaN for an invalid EVENTS_BATCH_LIMIT", async () => {
    for (const value of ["abc", "10.5", "0", "-5", ""]) {
      vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
      vi.stubEnv("STELLAR_NETWORK", "testnet");
      vi.stubEnv("EVENTS_BATCH_LIMIT", value);
      vi.resetModules();

      const config = await import("../src/config.js");

      expect(Number.isNaN(config.EVENTS_BATCH_LIMIT)).toBe(false);
      expect(config.EVENTS_BATCH_LIMIT).toBe(100);
    }
    expect(config.REGISTRY_PORT).toBe(4000);
  });

  it("rejects a non-numeric REGISTRY_PORT", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("REGISTRY_PORT", "abc");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'REGISTRY_PORT must be a positive integer; received "abc"'
    );
  });

  it("rejects an out-of-range REGISTRY_PORT", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("REGISTRY_PORT", "70000");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'REGISTRY_PORT must be at most 65535; received "70000"'
    expect(config.RPC_FAILOVER_THRESHOLD).toBe(5);
    expect(config.RPC_PRIMARY_PROBE_INTERVAL_MS).toBe(15000);
  });

  it("rejects a non-positive RPC_FAILOVER_THRESHOLD", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("RPC_FAILOVER_THRESHOLD", "0");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'RPC_FAILOVER_THRESHOLD must be a positive integer; received "0"'
    );
  });

  it("rejects a non-positive RPC_PRIMARY_PROBE_INTERVAL_MS", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("RPC_PRIMARY_PROBE_INTERVAL_MS", "-5");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'RPC_PRIMARY_PROBE_INTERVAL_MS must be a positive integer; received "-5"'
    );
  });

  it("defaults LOG_LEVEL to info", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("LOG_LEVEL", undefined);
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.LOG_LEVEL).toBe("info");
  });

  it("reads LOG_LEVEL from the environment", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.resetModules();

    const config = await import("../src/config.js");

    expect(config.LOG_LEVEL).toBe("debug");
  });

  it("rejects an invalid LOG_LEVEL", async () => {
    vi.stubEnv("SOROBAN_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("REGISTRY_SECRET", "test-registry-secret");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("LOG_LEVEL", "verbose");
    vi.resetModules();

    await expect(import("../src/config.js")).rejects.toThrow(
      'LOG_LEVEL must be one of: debug, info, warn, error; received "verbose"'
    );
  });
});
