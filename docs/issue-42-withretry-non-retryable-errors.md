# Issue #42 — Don't retry non-retryable errors in `withRetry`

**Complexity:** medium  
**Files:** `apps/indexer/src/retry.ts`, `apps/indexer/src/events.ts`

## Background

`withRetry` in `apps/indexer/src/retry.ts` retries any error that the caller does not explicitly
opt out of. A client error (e.g. a malformed Soroban RPC request) will never succeed on retry, but
the current code exhausts the full `maxRetries` budget before giving up — wasting time and
producing misleading log noise.

## Current behaviour

```ts
// retry.ts (simplified)
if (options?.shouldRetry?.(err) === false || attempt > maxRetries) {
  throw err;
}
```

If `shouldRetry` is not supplied, every error is retried up to `maxRetries` times. The caller in
`events.ts` passes no `shouldRetry` option, so a 400-style RPC error gets retried identically to a
transient network failure.

## What to implement

### 1. Add a `isRetryable` helper in `retry.ts`

Classify an error as non-retryable when it clearly represents a client mistake that will not go
away on retry. The right heuristic depends on what Soroban RPC surfaces:

```ts
// Example — adapt to the actual error shape from @stellar/stellar-sdk
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // HTTP 4xx responses are client errors; retrying is pointless.
    const status = (err as Error & { status?: number; code?: number }).status
      ?? (err as Error & { status?: number; code?: number }).code;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return false;
    }
  }
  // Everything else (network errors, 5xx, timeouts) is assumed retryable.
  return true;
}
```

### 2. Wire it into the call sites in `events.ts`

Pass `shouldRetry: isRetryableError` wherever `withRetry` is called:

```ts
import { withRetry, isRetryableError } from "./retry.js";

const shouldRetry = isRetryableError;

// In processEventsBatch:
const latestLedger = await withRetry(
  "getLatestLedger",
  () => server._getLatestLedger(),
  { shouldRetry },
);

const response = await withRetry(
  "getEvents",
  () => server._getEvents(request),
  { shouldRetry },
);
```

### 3. Add tests covering both paths

The existing `RetryOptions.shouldRetry` hook already supports fast-fail. Tests should confirm:

- A non-retryable error (e.g. `shouldRetry` returns `false`) is thrown immediately on the first
  attempt without sleeping or incrementing `attempt`.
- A retryable error (e.g. a 503) is retried up to `maxRetries` times before being re-thrown.
- The existing delay/backoff logic is unaffected.

Example test skeleton (Vitest):

```ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("fails fast when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("bad request"));
    await expect(
      withRetry("label", fn, { shouldRetry: () => false, baseDelayMs: 0 })
    ).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable errors up to maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("server error"));
    await expect(
      withRetry("label", fn, { maxRetries: 2, shouldRetry: () => true, baseDelayMs: 0 })
    ).rejects.toThrow("server error");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
```

## Notes on the existing implementation

- `shouldRetry` returning `undefined` (i.e. the function exists but doesn't return `false`) is
  treated as retryable. Only an explicit `false` stops retries. This is intentional — keep it.
- `retryDelayMs` already exists for Retry-After style hints. It is unrelated to this change.
- `MAX_RETRIES`, `RETRY_BASE_DELAY_MS`, and `RETRY_MAX_DELAY_MS` come from `config.ts`. Do not
  change their defaults as part of this fix.

## Acceptance criteria checklist

- [ ] `withRetry` (or its callers) can distinguish a non-retryable error and fail fast without exhausting `maxRetries`.
- [ ] Existing retryable-error behaviour (network errors, 5xx) is unchanged.
- [ ] A test covers the fast-fail path.
- [ ] A test covers the normal-retry path.
