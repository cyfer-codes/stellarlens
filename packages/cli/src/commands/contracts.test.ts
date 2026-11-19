import { afterEach, describe, expect, it, vi } from "vitest";
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

function pagedClient(pages: Record<string, { data: unknown[]; nextCursor: number | null }>) {
  const listContracts = vi.fn(async (params?: { cursor?: number }) => pages[String(params?.cursor ?? "")]);
  const client = {
    listContracts,
    async *listAllContracts(params?: { cursor?: number }) {
      let cursor = params?.cursor;
      do {
        const page = await listContracts({ ...params, cursor });
        yield* page.data;
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
    }
  };
  return { client: client as unknown as StellarLensClient, listContracts };
}

describe("listContracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a message when there are no contracts", async () => {
    const client = { listContracts: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) } as unknown as StellarLensClient;
    const { client } = pagedClient({ "": { data: [], nextCursor: null } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listContracts(client);

    expect(logSpy).toHaveBeenCalledWith("No contracts registered.");
  });

  it("prints a table when contracts exist", async () => {
    const client = {
      listContracts: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 1, address: "C1", name: null, network: "testnet" }], nextCursor: null })
    } as unknown as StellarLensClient;
    const { client } = pagedClient({
      "": { data: [{ id: 1, address: "C1", name: null, network: "testnet" }], nextCursor: null }
    });
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client);

    expect(tableSpy).toHaveBeenCalledWith([{ id: 1, address: "C1", name: "—", network: "testnet" }]);
  });

  it("paginates through every page and forwards filters", async () => {
    const { client, listContracts: listPage } = pagedClient({
      "": { data: [{ id: 1, address: "C1", name: "a", network: "testnet" }], nextCursor: 1 },
      "1": { data: [{ id: 2, address: "C2", name: "b", network: "testnet" }], nextCursor: null }
    });
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client, { network: "testnet", name: "tok", pageSize: 1 });

    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage).toHaveBeenNthCalledWith(1, { name: "tok", network: "testnet", limit: 1, cursor: undefined });
    expect(listPage).toHaveBeenNthCalledWith(2, { name: "tok", network: "testnet", limit: 1, cursor: 1 });
    expect(tableSpy).toHaveBeenCalledWith([
      { id: 1, address: "C1", name: "a", network: "testnet" },
      { id: 2, address: "C2", name: "b", network: "testnet" }
    ]);
  });

  it("follows nextCursor until every page has been fetched", async () => {
    const listContractsMock = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 1, address: "C1", name: "one", network: "testnet" }], nextCursor: 1 })
      .mockResolvedValueOnce({ data: [{ id: 2, address: "C2", name: null, network: "mainnet" }], nextCursor: null });
    const client = { listContracts: listContractsMock } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client);

    expect(listContractsMock).toHaveBeenNthCalledWith(1, { cursor: undefined, limit: 100 });
    expect(listContractsMock).toHaveBeenNthCalledWith(2, { cursor: 1, limit: 100 });
    expect(tableSpy).toHaveBeenCalledWith([
      { id: 1, address: "C1", name: "one", network: "testnet" },
      { id: 2, address: "C2", name: "—", network: "mainnet" }
    ]);
    tableSpy.mockRestore();
  });
});
