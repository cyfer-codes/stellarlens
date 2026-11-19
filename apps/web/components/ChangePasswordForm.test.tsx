import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "./ChangePasswordForm";

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks submission when the new password and confirmation don't match", async () => {
    render(<ChangePasswordForm />);

    await userEvent.type(screen.getByLabelText("Current password"), "oldpassword");
    await userEvent.type(screen.getByLabelText("New password"), "newpassword1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "newpassword2");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("submits the current and new password when they match", async () => {
    render(<ChangePasswordForm />);

    await userEvent.type(screen.getByLabelText("Current password"), "oldpassword");
    await userEvent.type(screen.getByLabelText("New password"), "newpassword1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "newpassword1");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/updated/i);
    expect(fetch).toHaveBeenCalledWith(
      "/api/account/password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentPassword: "oldpassword", newPassword: "newpassword1" })
      })
    );
  });
});
