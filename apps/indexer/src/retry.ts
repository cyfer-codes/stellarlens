import { MAX_RETRIES, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "./config.js";
import { logger } from "./logger.js";

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
  /**
   * Called on every failed attempt (including the final one that is rethrown). Lets callers such as
   * the endpoint manager track consecutive failures per endpoint.
   */
  onFailure?: (err: unknown, attempt: number) => void;
  /** Called once when the wrapped function eventually succeeds. */
  onSuccess?: () => void;
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? RETRY_MAX_DELAY_MS;

  let attempt = 0;

  for (;;) {
    try {
      const result = await fn();
      options?.onSuccess?.();
      return result;
    } catch (err) {
      attempt += 1;
      options?.onFailure?.(err, attempt);
      if (options?.shouldRetry?.(err) === false || attempt > maxRetries) {
        throw err;
      }
      const requestedDelay = options?.retryDelayMs?.(err);
      const delay =
        requestedDelay === undefined
          ? Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
          : Math.min(Math.max(requestedDelay, 0), maxDelayMs);
      logger.warn("retrying after failure", {
        label,
        attempt,
        maxRetries,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }
}
