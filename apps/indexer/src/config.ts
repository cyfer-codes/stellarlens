import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export const SOROBAN_RPC_URL = requireEnv("SOROBAN_RPC_URL");
export const STELLAR_NETWORK = requireEnv("STELLAR_NETWORK");
export const REGISTRY_PORT = Number(process.env.REGISTRY_PORT ?? 3002);
export const POLL_INTERVAL_MS = 5000;
export const EVENTS_BATCH_LIMIT = 100;
export const MAX_RETRIES = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 30000;
export const WEBHOOK_MAX_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES ?? 3);
export const WEBHOOK_RETRY_BASE_DELAY_MS = Number(process.env.WEBHOOK_RETRY_BASE_DELAY_MS ?? 500);
export const WEBHOOK_RETRY_MAX_DELAY_MS = Number(process.env.WEBHOOK_RETRY_MAX_DELAY_MS ?? 5000);
export const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5000);
