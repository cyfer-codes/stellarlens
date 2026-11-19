import { describe, expect, it, vi, beforeEach } from "vitest";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@stellarlens/db", () => ({
  getDb: getDbMock,
  users: {
    id: "id",
    email: "email",
    role: "role",
    passwordHash: "passwordHash",
    createdAt: "createdAt"
  },
  USER_ROLES: ["admin", "member"]
}));

vi.mock("./password", () => ({
  hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
  verifyPassword: vi.fn(async (password: string, stored: string) => stored === `hashed:${password}`)
}));

// Chainable stand-in for drizzle's query builder: every method returns the
// same builder, and awaiting it resolves to `result`.
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

describe("lib/users", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it("refuses to delete the only remaining user", async () => {
    const select = vi.fn().mockReturnValueOnce(chain([{ count: 1 }]));
    getDbMock.mockReturnValue({ select });

    const { deleteUser } = await import("./users.js");
    const result = await deleteUser(1);

    expect(result).toBe("last_user");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("deletes a user when more than one remains", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(chain([{ count: 2 }]))
      .mockReturnValueOnce(chain([{ id: 5 }]));
    const del = vi.fn(() => chain(undefined));
    getDbMock.mockReturnValue({ select, delete: del });

    const { deleteUser } = await import("./users.js");
    const result = await deleteUser(5);

    expect(result).toBe("ok");
    expect(del).toHaveBeenCalled();
  });

  it("reports not_found when the user to delete doesn't exist", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(chain([{ count: 2 }]))
      .mockReturnValueOnce(chain([]));
    getDbMock.mockReturnValue({ select, delete: vi.fn() });

    const { deleteUser } = await import("./users.js");
    const result = await deleteUser(999);

    expect(result).toBe("not_found");
  });

  it("rejects creating a user with a duplicate email", async () => {
    const select = vi.fn().mockReturnValueOnce(chain([{ id: 1 }]));
    getDbMock.mockReturnValue({ select });

    const { createUser } = await import("./users.js");
    const result = await createUser("admin@example.com", "password123", "member");

    expect(result).toEqual({ status: "duplicate_email" });
  });

  it("creates a user when the email is free", async () => {
    const select = vi.fn().mockReturnValueOnce(chain([]));
    const insert = vi.fn(() =>
      chain([{ id: 2, email: "new@example.com", role: "member", createdAt: new Date("2026-01-01") }])
    );
    getDbMock.mockReturnValue({ select, insert });

    const { createUser } = await import("./users.js");
    const result = await createUser("new@example.com", "password123", "member");

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.user.email).toBe("new@example.com");
  });

  it("rejects a password change with the wrong current password", async () => {
    const select = vi.fn().mockReturnValueOnce(chain([{ id: 1, passwordHash: "hashed:correct" }]));
    getDbMock.mockReturnValue({ select });

    const { changePassword } = await import("./users.js");
    const result = await changePassword(1, "wrong", "newpassword123");

    expect(result).toBe("invalid_current_password");
  });

  it("changes the password when the current password is correct", async () => {
    const select = vi.fn().mockReturnValueOnce(chain([{ id: 1, passwordHash: "hashed:correct" }]));
    const update = vi.fn(() => chain(undefined));
    getDbMock.mockReturnValue({ select, update });

    const { changePassword } = await import("./users.js");
    const result = await changePassword(1, "correct", "newpassword123");

    expect(result).toBe("ok");
    expect(update).toHaveBeenCalled();
  });
});
