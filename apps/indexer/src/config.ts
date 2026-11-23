import "dotenv/config";
import { STELLAR_NETWORKS, type StellarNetwork } from "@stellarlens/db";

export { STELLAR_NETWORKS, type StellarNetwork };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function positiveIntegerEnv(
  name: string,
  defaultValue: number,
  options: { max?: number } = {}
): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer; received "${value}"`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${name} must be at most ${options.max}; received "${value}"`);
  }
  return parsed;
}

function nonNegativeIntegerEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (value.trim() === "" || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer; received "${value}"`);
  }
  return parsed;
}

function parseRpcUrls(name: string): string[] {
  const raw = requireEnv(name);
  const urls = raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (urls.length === 0) {
    throw new Error(`${name} must contain at least one non-empty URL; received "${raw}"`);
  }
  return urls;
}

/** Ordered list of Soroban RPC endpoints; the first entry is the primary. */
export const SOROBAN_RPC_URLS = parseRpcUrls("SOROBAN_RPC_URL");
/** Primary Soroban RPC endpoint (first entry of `SOROBAN_RPC_URLS`), kept for backwards compatibility. */
export const SOROBAN_RPC_URL = SOROBAN_RPC_URLS[0]!;
/** Consecutive failures against the active endpoint before rotating to the next one. */
export const RPC_FAILOVER_THRESHOLD = positiveIntegerEnv("RPC_FAILOVER_THRESHOLD", 3);
/** How often to probe the primary endpoint while running on a fallback. */
export const RPC_PRIMARY_PROBE_INTERVAL_MS = positiveIntegerEnv(
  "RPC_PRIMARY_PROBE_INTERVAL_MS",
  60000
);

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.some((level) => level === value);
}

function logLevelEnv(name: string, defaultValue: LogLevel): LogLevel {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!isLogLevel(normalized)) {
    throw new Error(`${name} must be one of: ${LOG_LEVELS.join(", ")}; received "${value}"`);
  }
  return normalized;
}

export const LOG_LEVEL = logLevelEnv("LOG_LEVEL", "info");

const stellarNetwork = requireEnv("STELLAR_NETWORK");
function isStellarNetwork(value: string): value is StellarNetwork {
  return STELLAR_NETWORKS.some((network) => network === value);
}

if (!isStellarNetwork(stellarNetwork)) {
  throw new Error(
    `STELLAR_NETWORK must be one of: ${STELLAR_NETWORKS.join(", ")}; received "${stellarNetwork}"`
  );
}
export const STELLAR_NETWORK = stellarNetwork;
export const REGISTRY_PORT = positiveIntegerEnv("REGISTRY_PORT", 3002, { max: 65535 });
/** Shared secret clients must send in the X-Registry-Secret header when registering contracts. */
export const REGISTRY_SECRET = requireEnv("REGISTRY_SECRET");
export const WEBHOOK_CONCURRENCY = positiveIntegerEnv("WEBHOOK_CONCURRENCY", 10);
export const POLL_ONCE = process.env.POLL_ONCE === "true";
export const POLL_INTERVAL_MS = positiveIntegerEnv("POLL_INTERVAL_MS", 5000);
export const EVENTS_BATCH_LIMIT = 100;
export const MAX_RETRIES = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 30000;
/** Retries after the first webhook delivery attempt; `0` disables retries. */
export const WEBHOOK_MAX_RETRIES = nonNegativeIntegerEnv("WEBHOOK_MAX_RETRIES", 3);
export const WEBHOOK_RETRY_BASE_DELAY_MS = positiveIntegerEnv("WEBHOOK_RETRY_BASE_DELAY_MS", 500);
export const WEBHOOK_RETRY_MAX_DELAY_MS = positiveIntegerEnv("WEBHOOK_RETRY_MAX_DELAY_MS", 5000);
/** Per-attempt timeout for a webhook POST; the request is aborted once it elapses. */
export const WEBHOOK_TIMEOUT_MS = positiveIntegerEnv("WEBHOOK_TIMEOUT_MS", 5000);

if (WEBHOOK_RETRY_MAX_DELAY_MS < WEBHOOK_RETRY_BASE_DELAY_MS) {
  throw new Error(
    `WEBHOOK_RETRY_MAX_DELAY_MS (${WEBHOOK_RETRY_MAX_DELAY_MS}) must be greater than or equal to WEBHOOK_RETRY_BASE_DELAY_MS (${WEBHOOK_RETRY_BASE_DELAY_MS})`
  );
}
