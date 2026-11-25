import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@stellarlens/db", () => ({
  getDb: getDbMock,
  apiKeys: {
    id: "id",
    name: "name",
    keyHash: "keyHash",
    scope: "scope",
    expiresAt: "expiresAt",
    createdAt: "createdAt",
    revokedAt: "revokedAt"
  }
}));

function chain(result: unknown) {
  const builder: Record<string, unknown> = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    values: vi.fn(() => builder),
    set: vi.fn(() => builder),
    returning: vi.fn(async () => result),
    then: (resolve: (value: unknown) => void) => resolve(result)
  };
  return builder;
}

describe("lib/apiKeys", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it("lists api keys with scope and expiresAt", async () => {
    const mockRows = [
      {
        id: 1,
        name: "Worker Key",
        scope: "read",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        revokedAt: null
      }
    ];

    const select = vi.fn().mockReturnValueOnce(chain(mockRows));
    getDbMock.mockReturnValue({ select });

    const { listApiKeys } = await import("./apiKeys.js");
    const result = await listApiKeys();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      name: "Worker Key",
      scope: "read",
      expiresAt: "2026-12-31T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null
    });
  });

  it("generates an api key with scope and expiresAt options", async () => {
    const mockCreated = {
      id: 10,
      name: "Test Scoped Key",
      scope: "read",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const insert = vi.fn().mockReturnValueOnce(chain([mockCreated]));
    getDbMock.mockReturnValue({ insert });

    const { generateApiKey } = await import("./apiKeys.js");
    const result = await generateApiKey({
      name: "Test Scoped Key",
      scope: "read",
      expiresAt: "2027-01-01T00:00:00.000Z"
    });

    expect(result).toMatchObject({
      id: 10,
      name: "Test Scoped Key",
      scope: "read",
      expiresAt: "2027-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null
    });
    expect(typeof result.key).toBe("string");
    expect(result.key.length).toBe(48); // 24 bytes hex
  });
});
