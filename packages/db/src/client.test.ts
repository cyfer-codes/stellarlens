import { afterEach, describe, expect, it, vi } from "vitest";

const { postgresMock, drizzleMock } = vi.hoisted(() => ({
  postgresMock: vi.fn((..._args: unknown[]) => ({ _client: true })),
  drizzleMock: vi.fn((..._args: unknown[]) => ({ _db: true }))
}));

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));

describe("getDb", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as unknown as { __stellarlensDb?: unknown }).__stellarlensDb;
    delete process.env.DATABASE_POOL_MAX;
  });

  it("opens a single connection pool across repeated calls", async () => {
    process.env.DATABASE_URL = "postgres://example/test";
    const { getDb } = await import("./client.js");

    const first = getDb();
    const second = getDb();
    const third = getDb();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(postgresMock).toHaveBeenCalledTimes(1);
  });

  it("defaults the pool size and allows overriding it via DATABASE_POOL_MAX", async () => {
    process.env.DATABASE_URL = "postgres://example/test";
    const { createDb } = await import("./client.js");

    createDb();
    expect(postgresMock).toHaveBeenLastCalledWith(expect.any(String), { max: 10 });

    process.env.DATABASE_POOL_MAX = "3";
    createDb();
    expect(postgresMock).toHaveBeenLastCalledWith(expect.any(String), { max: 3 });
  });
});
