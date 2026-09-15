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
    const client = { listContracts: vi.fn().mockResolvedValue([]) } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listContracts(client);

    expect(logSpy).toHaveBeenCalledWith("No contracts registered.");
    logSpy.mockRestore();
  });

  it("prints a table when contracts exist", async () => {
    const client = {
      listContracts: vi.fn().mockResolvedValue([{ id: 1, address: "C1", name: null, network: "testnet" }])
    } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client);

    expect(tableSpy).toHaveBeenCalledWith([{ id: 1, address: "C1", name: "—", network: "testnet" }]);
    tableSpy.mockRestore();
  });
});
