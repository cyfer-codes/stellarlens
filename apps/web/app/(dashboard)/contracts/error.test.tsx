import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ContractsError from "./error";

describe("ContractsError", () => {
  it("shows friendly copy and never the raw error message", () => {
    const sensitive = new Error(
      "api request to /contracts failed with 500: postgres://user:pass@host/db unreachable"
    );
    render(<ContractsError error={sensitive} reset={vi.fn()} />);

    expect(screen.getByText(/couldn't load contracts/i)).toBeInTheDocument();
    expect(screen.queryByText(/postgres:\/\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/contracts failed/)).not.toBeInTheDocument();
  });

  it("calls reset when the retry button is clicked", async () => {
    const reset = vi.fn();
    render(<ContractsError error={new Error("boom")} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
