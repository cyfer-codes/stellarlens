import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyButton } from "./CopyButton";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("CopyButton", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the full value and shows Copied! briefly", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const value = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

    render(<CopyButton value={value} ariaLabel="Copy contract address" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy contract address" }));
    });

    expect(writeText).toHaveBeenCalledWith(value);
    expect(screen.getByRole("status")).toHaveTextContent("Copied!");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("reports a failed copy instead of claiming success", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    render(<CopyButton value="secret" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent("Copy failed");
  });
});
