import { describe, expect, it, vi } from "vitest";
import { ApiError, ApiNotFoundError, sanitizeApiError } from "./api";

describe("sanitizeApiError", () => {
  it("sanitizes 400 Bad Request without leaking internal details", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiError(
      400,
      "/internal/contracts/42/events?token=secret123",
      JSON.stringify({ details: "db table column failed validation", stack: "Error at line 99" })
    );

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(400);
    expect(message).toBe("Invalid request. Please verify your input.");
    expect(message).not.toContain("secret123");
    expect(message).not.toContain("internal/contracts");
    expect(message).not.toContain("stack");
    expect(errorSpy).toHaveBeenCalledWith("Internal API error:", rawError);
    errorSpy.mockRestore();
  });

  it("sanitizes 401 Unauthorized", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiError(401, "/admin/keys", "invalid key");

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(401);
    expect(message).toBe("Unauthorized. Please check your credentials.");
    expect(message).not.toContain("/admin/keys");
    errorSpy.mockRestore();
  });

  it("sanitizes 403 Forbidden", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiError(403, "/protected/route", "role user cannot access");

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(403);
    expect(message).toBe("Forbidden. You do not have permission to perform this action.");
    errorSpy.mockRestore();
  });

  it("sanitizes 404 Not Found with default message", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiNotFoundError("/contracts/999", "missing");

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(404);
    expect(message).toBe("The requested resource was not found.");
    expect(message).not.toContain("/contracts/999");
    errorSpy.mockRestore();
  });

  it("sanitizes 404 Not Found with custom resource name", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiNotFoundError("/contracts/123", "contract not found");

    const { status, message } = sanitizeApiError(rawError, "contract 123");

    expect(status).toBe(404);
    expect(message).toBe("contract 123 not found");
    expect(message).not.toContain("/contracts/123");
    errorSpy.mockRestore();
  });

  it("sanitizes 409 Conflict", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiError(409, "/contracts", "unique key constraint violation");

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(409);
    expect(message).toBe("A conflict occurred with an existing resource.");
    errorSpy.mockRestore();
  });

  it("sanitizes 429 Rate Limit Exceeded", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiError(429, "/contracts", "rate limit exceeded");

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(429);
    expect(message).toBe("Too many requests. Please try again later.");
    errorSpy.mockRestore();
  });

  it("sanitizes 500 Internal Server Error into 502 with friendly copy", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new ApiError(
      500,
      "/contracts/1/stats",
      "FATAL: database connection pool exhausted at postgresql://user:pwd@db:5432/main"
    );

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(502);
    expect(message).toBe("An internal server error occurred in the upstream service.");
    expect(message).not.toContain("FATAL");
    expect(message).not.toContain("postgresql");
    expect(message).not.toContain("db:5432");
    errorSpy.mockRestore();
  });

  it("sanitizes 502 / 503 / 504 Gateway & Upstream Errors into friendly messages", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(sanitizeApiError(new ApiError(502, "/test", "bad gateway"))).toEqual({
      status: 502,
      message: "The upstream API service is currently unavailable."
    });

    expect(sanitizeApiError(new ApiError(503, "/test", "unavailable"))).toEqual({
      status: 502,
      message: "The upstream service is temporarily overloaded or down."
    });

    expect(sanitizeApiError(new ApiError(504, "/test", "timeout"))).toEqual({
      status: 502,
      message: "The upstream service timed out."
    });

    errorSpy.mockRestore();
  });

  it("sanitizes unknown non-ApiError exceptions (e.g. network fetch failed)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:3000");

    const { status, message } = sanitizeApiError(rawError);

    expect(status).toBe(502);
    expect(message).toBe("An unexpected error occurred while communicating with the server.");
    expect(message).not.toContain("ECONNREFUSED");
    expect(message).not.toContain("127.0.0.1:3000");
    errorSpy.mockRestore();
  });
});
