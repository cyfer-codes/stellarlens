import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Contract } from "@/lib/api";

const loadContracts = vi.fn();

vi.mock("@/app/(dashboard)/contracts/actions", () => ({
  loadContracts: (...args: unknown[]) => loadContracts(...args)
}));

import { ContractsTable } from "./ContractsTable";

function makeContract(id: number, overrides: Partial<Contract> = {}): Contract {
  return {
    id,
    address: `C${String(id).padStart(55, "0")}`,
    name: `Contract ${id}`,
    network: "testnet",
    ...overrides
  };
}

const page1 = Array.from({ length: 20 }, (_, i) => makeContract(i + 1));
const page2 = Array.from({ length: 5 }, (_, i) => makeContract(i + 21));

describe("ContractsTable", () => {
  beforeEach(() => {
    loadContracts.mockReset();
  });

  it("loads more than 20 contracts when the user clicks Load more", async () => {
    loadContracts.mockResolvedValueOnce({ data: page2, nextCursor: null });

    render(<ContractsTable initialContracts={page1} initialNextCursor={21} />);
    // 1 header row + 20 data rows
    expect(screen.getAllByRole("row")).toHaveLength(1 + 20);

    await userEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(1 + 25));
    expect(loadContracts).toHaveBeenCalledWith({ cursor: 21 });
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("applies the name filter server-side (debounced)", async () => {
    loadContracts.mockResolvedValueOnce({ data: [makeContract(1, { name: "usdc" })], nextCursor: null });

    render(<ContractsTable initialContracts={page1} initialNextCursor={21} />);
    await userEvent.type(screen.getByLabelText(/filter contracts/i), "usdc");

    await waitFor(() => expect(loadContracts).toHaveBeenCalledWith({ name: "usdc" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(1 + 1));
  });

  it("applies the network filter server-side", async () => {
    loadContracts.mockResolvedValueOnce({ data: [], nextCursor: null });

    render(<ContractsTable initialContracts={page1} initialNextCursor={21} />);
    await userEvent.type(screen.getByLabelText(/filter by network/i), "mainnet");

    await waitFor(() => expect(loadContracts).toHaveBeenCalledWith({ network: "mainnet" }));
    await screen.findByText(/no contracts match/i);
  });
});