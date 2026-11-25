import { afterEach, describe, expect, it, vi } from "vitest";
import { StellarLensApiError, type ApiKey, type StellarLensClient } from "@stellarlens/sdk";
import { formatApiKey, listApiKeys, revokeApiKey } from "./api-keys.js";

function keyFixture(id: number, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id,
    name: "ci",
    scope: "read",
    createdAt: "2026-01-01T00:00:00Z",
    revokedAt: null,
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatApiKey", () => {
  it("shows active keys as active", () => {
    expect(formatApiKey(keyFixture(1))).toEqual({
      id: 1,
      name: "ci",
      scope: "read",
      "created at": "2026-01-01T00:00:00Z",
      status: "active"
    });
  });

  it("shows revoked keys with the revocation time, and — for an unnamed key", () => {
    expect(formatApiKey(keyFixture(2, { name: null, revokedAt: "2026-02-01T00:00:00Z" }))).toEqual({
      id: 2,
      name: "—",
      scope: "read",
      "created at": "2026-01-01T00:00:00Z",
      status: "revoked at 2026-02-01T00:00:00Z"
    });
  });
});

describe("listApiKeys", () => {
  it("prints a table of api keys", async () => {
    const listApiKeysMock = vi.fn().mockResolvedValue([keyFixture(1), keyFixture(2, { scope: "full" })]);
    const client = { listApiKeys: listApiKeysMock } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listApiKeys(client);

    expect(listApiKeysMock).toHaveBeenCalledWith();
    expect(tableSpy).toHaveBeenCalledWith([formatApiKey(keyFixture(1)), formatApiKey(keyFixture(2, { scope: "full" }))]);
  });

  it("prints a message when there are no api keys", async () => {
    const client = { listApiKeys: vi.fn().mockResolvedValue([]) } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listApiKeys(client);

    expect(logSpy).toHaveBeenCalledWith("No api keys found.");
  });
});

describe("revokeApiKey", () => {
  it("revokes the key and prints confirmation", async () => {
    const revokeApiKeyMock = vi.fn().mockResolvedValue(undefined);
    const client = { revokeApiKey: revokeApiKeyMock } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await revokeApiKey(client, 5);

    expect(revokeApiKeyMock).toHaveBeenCalledWith(5);
    expect(logSpy).toHaveBeenCalledWith("api key 5 revoked");
  });

  it("rejects with a clear error for a nonexistent id", async () => {
    const client = {
      revokeApiKey: vi.fn().mockRejectedValue(new StellarLensApiError(404, { message: "Api key 999 not found" }))
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(revokeApiKey(client, 999)).rejects.toThrow("api key 999 not found");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("passes other api errors through unchanged", async () => {
    const error = new StellarLensApiError(500, {});
    const client = { revokeApiKey: vi.fn().mockRejectedValue(error) } as unknown as StellarLensClient;

    await expect(revokeApiKey(client, 1)).rejects.toBe(error);
  });
});
