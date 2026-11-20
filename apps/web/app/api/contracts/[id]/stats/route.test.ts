import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getContractStats: vi.fn() };
});

describe("GET /api/contracts/[id]/stats sanitizes upstream errors", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("never forwards the raw upstream error body to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ApiProxyError } = await import("@/lib/api");
    const { getContractStats } = await import("@/lib/api");
    vi.mocked(getContractStats).mockRejectedValue(
      new ApiProxyError(500, "api request to /contracts/1/stats failed with 500: internal db dsn leaked here")
    );

    const { GET } = await import("./route.js");
    const response = await GET(new NextRequest("http://localhost/api/contracts/1/stats"), {
      params: { id: "1" }
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("internal db dsn");
    expect(JSON.stringify(body)).not.toContain("/contracts/1/stats");
  });

  it("maps a not-found upstream contract to a sanitized 404", async () => {
    const { ApiNotFoundError, getContractStats } = await import("@/lib/api");
    vi.mocked(getContractStats).mockRejectedValue(new ApiNotFoundError("/contracts/999/stats"));

    const { GET } = await import("./route.js");
    const response = await GET(new NextRequest("http://localhost/api/contracts/999/stats"), {
      params: { id: "999" }
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(JSON.stringify(body)).not.toContain("/contracts/999/stats");
  });
});
