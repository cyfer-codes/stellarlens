import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/retry.js";
import { logger } from "../src/logger.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withRetry", () => {
  it("gives up after maxRetries attempts and rethrows the last error", async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const firstError = new Error("first failure");
    const lastError = new Error("last failure");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(new Error("second failure"))
      .mockRejectedValue(lastError);

    const result = withRetry("test", fn, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 100 });
    const rejection = expect(result).rejects.toBe(lastError);
    await vi.runAllTimersAsync();

    await rejection;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns the result when a later attempt succeeds without further retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue("success");

    const result = withRetry("test", fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 100 });
    const resolution = expect(result).resolves.toBe("success");
    await vi.runAllTimersAsync();

    await resolution;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honours an error-provided retry delay instead of the backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const rateLimited = Object.assign(new Error("rate limited"), { retryAfterMs: 4000 });
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValue("success");

    const result = withRetry("test", fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 5000,
      retryDelayMs: (err) => (err as { retryAfterMs?: number }).retryAfterMs
    });
    const resolution = expect(result).resolves.toBe("success");

    // The backoff (10ms) must be ignored in favour of the requested 4s delay.
    await vi.advanceTimersByTimeAsync(3999);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await resolution;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caps a requested retry delay at maxDelayMs", async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const longWait = Object.assign(new Error("slow down"), { retryAfterMs: 600_000 });
    const fn = vi.fn().mockRejectedValueOnce(longWait).mockResolvedValue("success");

    const result = withRetry("test", fn, {
      maxRetries: 1,
      baseDelayMs: 10,
      maxDelayMs: 5000,
      retryDelayMs: (err) => (err as { retryAfterMs?: number }).retryAfterMs
    });
    const resolution = expect(result).resolves.toBe("success");

    // 10 minutes requested, but the wait is capped at maxDelayMs (5s).
    await vi.advanceTimersByTimeAsync(5000);
    await resolution;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("logs retry attempts through the structured logger", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue("success");

    const result = withRetry("test", fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 100 });
    const resolution = expect(result).resolves.toBe("success");
    await vi.runAllTimersAsync();

    await resolution;
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg, context] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("test");
    expect(context).toMatchObject({ attempt: 1 });
  });
});
