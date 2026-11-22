import "dotenv/config";

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
export const STELLAR_NETWORKS = ["testnet", "futurenet", "mainnet", "standalone"] as const;
export type StellarNetwork = (typeof STELLAR_NETWORKS)[number];

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
export const WEBHOOK_CONCURRENCY = positiveIntegerEnv("WEBHOOK_CONCURRENCY", 10);
export const POLL_ONCE = process.env.POLL_ONCE === "true";
export const POLL_INTERVAL_MS = positiveIntegerEnv("POLL_INTERVAL_MS", 5000);
// Missing, empty or non-numeric values fall back to the default instead of
// producing NaN, so a misconfigured batch size can never break polling.
const eventsBatchLimitValue = process.env.EVENTS_BATCH_LIMIT?.trim();
const parsedEventsBatchLimit = Number(eventsBatchLimitValue);
export const EVENTS_BATCH_LIMIT =
  eventsBatchLimitValue !== undefined &&
  eventsBatchLimitValue !== "" &&
  Number.isInteger(parsedEventsBatchLimit) &&
  parsedEventsBatchLimit > 0
    ? parsedEventsBatchLimit
    : 100;
export const MAX_RETRIES = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 30000;
export const WEBHOOK_MAX_RETRIES = 3;
export const WEBHOOK_RETRY_BASE_DELAY_MS = 500;
export const WEBHOOK_RETRY_MAX_DELAY_MS = 5000;
export const WEBHOOK_TIMEOUT_MS = 5000;
