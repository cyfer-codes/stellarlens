import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeysManager } from "./ApiKeysManager";
import type { ApiKeyRow } from "@/lib/apiKeys";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const mockKeys: ApiKeyRow[] = [
  {
    id: 1,
    name: "Full Key",
    scope: "full",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null
  },
  {
    id: 2,
    name: "Read Only Key",
    scope: "read",
    createdAt: "2026-01-02T00:00:00.000Z",
    expiresAt: "2099-12-31T23:59:59.000Z",
    revokedAt: null
  },
  {
    id: 3,
    name: "Expired Key",
    scope: "read",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z", // In the past
    revokedAt: null
  },
  {
    id: 4,
    name: "Revoked Key",
    scope: "full",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: "2026-01-03T00:00:00.000Z"
  }
];

describe("ApiKeysManager", () => {
  it("renders api keys showing scope, expiry, and status (Active, Expired, Revoked)", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/api-keys")) {
        return Promise.resolve(jsonResponse(mockKeys));
      }
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    });

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("Full Key")).toBeDefined();
    });

    // Check scopes rendered
    expect(screen.getAllByText("Full access").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Read-only").length).toBeGreaterThanOrEqual(1);

    // Check expiry rendered
    expect(screen.getAllByText("Never").length).toBe(2);

    // Check statuses
    expect(screen.getAllByText("Active").length).toBe(2);
    expect(screen.getByText("Expired")).toBeDefined();
    expect(screen.getByText("Revoked")).toBeDefined();
  });

  it("generates a key with selected scope and expiry", async () => {
    const user = userEvent.setup();
    let postBody: Record<string, unknown> | null = null;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/api-keys") && init?.method === "POST") {
        postBody = JSON.parse(init.body as string);
        return Promise.resolve(jsonResponse({ id: 5, key: "stellar_sk_12345" }, 201));
      }
      if (url.endsWith("/api/api-keys")) {
        return Promise.resolve(jsonResponse(mockKeys));
      }
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    });

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("Full Key")).toBeDefined();
    });

    // Fill form
    await user.type(screen.getByLabelText(/name/i), "Scoped Worker");
    await user.selectOptions(screen.getByLabelText(/scope/i), "read");
    await user.type(screen.getByLabelText(/expiry/i), "2030-06-15");

    await user.click(screen.getByRole("button", { name: /generate key/i }));

    await waitFor(() => {
      expect(postBody).toEqual({
        name: "Scoped Worker",
        scope: "read",
        expiresAt: new Date("2030-06-15").toISOString()
      });
    });

    // Copy banner shown
    expect(screen.getByText("stellar_sk_12345")).toBeDefined();
  });

  it("allows revoking an unrevoked key", async () => {
    const user = userEvent.setup();
    let revokedId: string | null = null;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/api-keys/") && init?.method === "DELETE") {
        revokedId = url.split("/").pop() ?? null;
        return Promise.resolve(jsonResponse({ success: true }));
      }
      if (url.endsWith("/api/api-keys")) {
        return Promise.resolve(jsonResponse(mockKeys));
      }
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    });

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("Full Key")).toBeDefined();
    });

    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    expect(revokeButtons.length).toBeGreaterThan(0);
    await user.click(revokeButtons[0]);

    await waitFor(() => {
      expect(revokedId).toBe("1");
    });
  });
});
