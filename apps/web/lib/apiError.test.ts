import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiNotFoundError, ApiProxyError } from "./api.js";
import { sanitizeApiError } from "./apiError.js";

describe("sanitizeApiError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never leaks the upstream path or response body", () => {
    const err = new ApiProxyError(500, "api request to /contracts/1/events failed with 500");
    const { error } = sanitizeApiError(err);

    expect(error).not.toContain("/contracts");
    expect(error).not.toMatch(/\d{3}/);
  });

  it("maps 404 to a generic not-found message with a 404 status", () => {
    const result = sanitizeApiError(new ApiNotFoundError("/contracts/999"));
    expect(result).toEqual({ status: 404, error: "not found" });
  });

  it("maps 400 to an invalid-request message", () => {
    const result = sanitizeApiError(new ApiProxyError(400, "api request failed"));
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/invalid request/i);
  });

  it("maps 401 and 403 to a not-authorized message", () => {
    expect(sanitizeApiError(new ApiProxyError(401, "x")).error).toMatch(/not authorized/i);
    expect(sanitizeApiError(new ApiProxyError(403, "x")).error).toMatch(/not authorized/i);
  });

  it("falls back to a generic 502 for unknown errors, logging the real one server-side", () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = new Error("ECONNREFUSED 127.0.0.1:4000 — internal secret detail");

    const result = sanitizeApiError(err);

    expect(result.status).toBe(502);
    expect(result.error).not.toContain("ECONNREFUSED");
    expect(result.error).not.toContain("secret");
    expect(logSpy).toHaveBeenCalledWith(err);
  });
});
