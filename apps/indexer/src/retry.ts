import { MAX_RETRIES, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "./config.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
  /**
   * Optional delay override for a given failure, e.g. a server's `Retry-After` hint. When it
   * returns `undefined` the exponential backoff is used instead. Either way the delay is capped at
   * `maxDelayMs`.
   */
  retryDelayMs?: (err: unknown) => number | undefined;
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? RETRY_MAX_DELAY_MS;

  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (options?.shouldRetry?.(err) === false || attempt > maxRetries) {
        throw err;
      }
      const requestedDelay = options?.retryDelayMs?.(err);
      const delay =
        requestedDelay === undefined
          ? Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
          : Math.min(Math.max(requestedDelay, 0), maxDelayMs);
      console.error(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, err);
      await sleep(delay);
    }
  }
}
