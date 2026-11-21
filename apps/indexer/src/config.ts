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

function positiveIntegerEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer; received "${value}"`);
  }
  return parsed;
}

export const SOROBAN_RPC_URL = requireEnv("SOROBAN_RPC_URL");

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
export const REGISTRY_PORT = Number(process.env.REGISTRY_PORT ?? 3002);
/** Shared secret clients must send in the X-Registry-Secret header when registering contracts. */
export const REGISTRY_SECRET = requireEnv("REGISTRY_SECRET");
export const WEBHOOK_CONCURRENCY = positiveIntegerEnv("WEBHOOK_CONCURRENCY", 10);
export const POLL_ONCE = process.env.POLL_ONCE === "true";
export const POLL_INTERVAL_MS = positiveIntegerEnv("POLL_INTERVAL_MS", 5000);
export const EVENTS_BATCH_LIMIT = 100;
export const MAX_RETRIES = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 30000;
export const WEBHOOK_MAX_RETRIES = 3;
export const WEBHOOK_RETRY_BASE_DELAY_MS = 500;
export const WEBHOOK_RETRY_MAX_DELAY_MS = 5000;
export const WEBHOOK_TIMEOUT_MS = 5000;
