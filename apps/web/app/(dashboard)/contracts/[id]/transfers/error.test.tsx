import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ContractTransfersError from "./error";

describe("ContractTransfersError", () => {
  it("shows friendly copy and never the raw error message", () => {
    const sensitive = new Error("api request to /contracts/42/transfers failed with 500: secret-upstream-detail");
    render(<ContractTransfersError error={sensitive} reset={vi.fn()} />);

    expect(screen.getByText(/couldn't load transfers/i)).toBeInTheDocument();
    expect(screen.queryByText(/secret-upstream-detail/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
