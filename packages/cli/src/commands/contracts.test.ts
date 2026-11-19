import { describe, expect, it, vi } from "vitest";
import type { StellarLensClient } from "@stellarlens/sdk";
import { addContract, listContracts } from "./contracts.js";

describe("addContract", () => {
  it("registers a contract and prints confirmation", async () => {
    const registerContract = vi.fn().mockResolvedValue({ id: 1, address: "C1", name: null, network: "testnet" });
    const client = { registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await addContract(client, "C1", { network: "testnet" });

    expect(registerContract).toHaveBeenCalledWith({ address: "C1", network: "testnet", name: undefined });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("registered contract 1"));
    logSpy.mockRestore();
  });
});

describe("listContracts", () => {
  it("prints a message when there are no contracts", async () => {
    const client = {
      listContracts: vi.fn().mockResolvedValue({ data: [], nextCursor: null })
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listContracts(client);

    expect(logSpy).toHaveBeenCalledWith("No contracts registered.");
    logSpy.mockRestore();
  });

  it("prints a table when contracts exist", async () => {
    const client = {
      listContracts: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 1, address: "C1", name: null, network: "testnet" }], nextCursor: null })
    } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client);

    expect(tableSpy).toHaveBeenCalledWith([{ id: 1, address: "C1", name: "—", network: "testnet" }]);
    tableSpy.mockRestore();
  });

  it("follows nextCursor until every page is fetched", async () => {
    const listContractsMock = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 1, address: "C1", name: "One", network: "testnet" }], nextCursor: 1 })
      .mockResolvedValueOnce({ data: [{ id: 2, address: "C2", name: null, network: "mainnet" }], nextCursor: null });
    const client = { listContracts: listContractsMock } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client);

    expect(listContractsMock.mock.calls).toEqual([[{ cursor: undefined, limit: 100 }], [{ cursor: 1, limit: 100 }]]);
    expect(tableSpy).toHaveBeenCalledWith([
      { id: 1, address: "C1", name: "One", network: "testnet" },
      { id: 2, address: "C2", name: "—", network: "mainnet" }
    ]);
    tableSpy.mockRestore();
  });
});
