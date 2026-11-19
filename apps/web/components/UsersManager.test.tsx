import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "@/lib/users";
import { UsersManager } from "./UsersManager";

function user(id: number, email: string): UserRow {
  return { id, email, role: "member", createdAt: new Date().toISOString() };
}

describe("UsersManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables removing the last remaining user", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [user(1, "only@example.com")] }))
    );

    render(<UsersManager />);

    const removeButton = await screen.findByLabelText("Remove only@example.com");
    expect(removeButton).toBeDisabled();
  });

  it("allows removing a user when more than one exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [user(1, "first@example.com"), user(2, "second@example.com")]
      }))
    );

    render(<UsersManager />);

    await waitFor(() => expect(screen.getByLabelText("Remove first@example.com")).not.toBeDisabled());
  });
});
