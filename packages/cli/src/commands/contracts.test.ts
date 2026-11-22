import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StellarLensApiError, type StellarLensClient } from "@stellarlens/sdk";
import {
  BULK_CHUNK_SIZE,
  addContracts,
  getContract,
  listContracts,
  parseContractsFile,
  runAddContracts
} from "./contracts.js";

// Valid strkeys, generated with @stellar/stellar-sdk.
const C1 = "CDFJPAISZIN33SX2YIY3HGRD3RG2PBXP7AKHYTTSXGAHPBNP5ZELWMKI";
const C2 = "CA7CH2AWAA4VSSRTRFHWKZHBWE2IXPL2ACENILCKZNZ65LWVTQAJ2CH4";
const G1 = "GDGQVKMFMFD3NRNU74VX37XF3IQKUOBFGCM66G2KMSWO2IZ4TL7CSFUG";

/** Test-only contract strkey encoder, checked against an sdk-generated key below. */
function encodeContract(payload: Uint8Array): string {
  const data = Uint8Array.from([2 << 3, ...payload]);
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  const bytes = [...data, crc & 0xff, crc >> 8];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31];
    }
  }
  return out;
}

function bulkResponder() {
  let nextId = 1;
  return vi.fn(async (items: { address: string; network: string; name?: string }[]) => ({
    results: items.map((item, index) => ({
      index,
      address: item.address,
      network: item.network,
      name: item.name ?? null,
      status: "created" as const,
      id: nextId++
    }))
  }));
}

function singleResponder() {
  let nextId = 1;
  return vi.fn(async (input: { address: string; network: string; name?: string }) => ({
    id: nextId++,
    address: input.address,
    network: input.network,
    name: input.name ?? null
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addContracts", () => {
  it("registers a single address through the single-contract endpoint", async () => {
    const registerContract = singleResponder();
    const registerContractsBulk = vi.fn();
    const client = { registerContract, registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(client, [{ address: C1 }], {
      network: "testnet",
      name: "Token"
    });

    expect(registerContract).toHaveBeenCalledWith({ address: C1, network: "testnet", name: "Token" });
    expect(registerContractsBulk).not.toHaveBeenCalled();
    expect(results).toEqual([{ address: C1, network: "testnet", status: "registered", id: 1 }]);
  });

  it("validates every address locally and never sends invalid ones", async () => {
    const registerContractsBulk = bulkResponder();
    const client = { registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(
      client,
      [{ address: C1 }, { address: "CNOTAREALADDRESS" }, { address: G1 }],
      { network: "testnet" }
    );

    expect(registerContractsBulk).toHaveBeenCalledTimes(1);
    expect(registerContractsBulk).toHaveBeenCalledWith([
      { address: C1, network: "testnet", name: undefined },
      { address: G1, network: "testnet", name: undefined }
    ]);
    expect(results.map((r) => r.status)).toEqual(["created", "invalid", "created"]);
    expect(results[1].error).toMatch(/strkey/);
  });

  it("does not call the api at all when every address is invalid", async () => {
    const registerContract = vi.fn();
    const registerContractsBulk = vi.fn();
    const client = { registerContract, registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(client, [{ address: "nope" }, { address: "" }], {
      network: "testnet"
    });

    expect(registerContract).not.toHaveBeenCalled();
    expect(registerContractsBulk).not.toHaveBeenCalled();
    expect(results.every((r) => r.status === "invalid")).toBe(true);
  });

  it("marks entries without any network as invalid", async () => {
    const client = { registerContract: vi.fn() } as unknown as StellarLensClient;

    const [result] = await addContracts(client, [{ address: C1 }]);

    expect(result).toMatchObject({ status: "invalid", error: expect.stringMatching(/network/) });
  });

  it("uses per-entry networks and names over the --network default", async () => {
    const registerContractsBulk = bulkResponder();
    const client = { registerContractsBulk } as unknown as StellarLensClient;

    await addContracts(client, [{ address: C1, network: "mainnet", name: "A" }, { address: C2 }], {
      network: "testnet"
    });

    expect(registerContractsBulk).toHaveBeenCalledWith([
      { address: C1, network: "mainnet", name: "A" },
      { address: C2, network: "testnet", name: undefined }
    ]);
  });

  it("reports duplicates in the input without sending them twice", async () => {
    const registerContractsBulk = bulkResponder();
    const client = { registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(client, [{ address: C1 }, { address: C2 }, { address: C1 }], {
      network: "testnet"
    });

    expect(registerContractsBulk.mock.calls[0][0]).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(["created", "created", "duplicate"]);
  });

  it("maps per-item bulk statuses (existing, error) back to input order", async () => {
    const registerContractsBulk = vi.fn().mockResolvedValue({
      results: [
        { index: 1, address: C2, network: "testnet", name: null, status: "error", error: "boom" },
        { index: 0, address: C1, network: "testnet", name: null, status: "existing", id: 7 }
      ]
    });
    const client = { registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(client, [{ address: C1 }, { address: C2 }], {
      network: "testnet"
    });

    expect(results).toEqual([
      { address: C1, network: "testnet", status: "existing", id: 7 },
      { address: C2, network: "testnet", status: "error", error: "boom" }
    ]);
  });

  it("falls back to sequential requests when the bulk endpoint is unavailable", async () => {
    const registerContractsBulk = vi
      .fn()
      .mockRejectedValue(new StellarLensApiError(404, { message: "Cannot POST /contracts/bulk" }));
    const registerContract = vi
      .fn()
      .mockResolvedValueOnce({ id: 1, address: C1, network: "testnet", name: null })
      .mockRejectedValueOnce(new StellarLensApiError(400, { message: ["address is invalid"] }));
    const client = { registerContract, registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(client, [{ address: C1 }, { address: C2 }], {
      network: "testnet"
    });

    expect(registerContract).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { address: C1, network: "testnet", status: "registered", id: 1 },
      { address: C2, network: "testnet", status: "error", error: "400: address is invalid" }
    ]);
  });

  it("marks a whole chunk as failed when a bulk request errors for another reason", async () => {
    const registerContractsBulk = vi.fn().mockRejectedValue(new StellarLensApiError(500, "oops"));
    const registerContract = vi.fn();
    const client = { registerContract, registerContractsBulk } as unknown as StellarLensClient;

    const results = await addContracts(client, [{ address: C1 }, { address: C2 }], {
      network: "testnet"
    });

    expect(registerContract).not.toHaveBeenCalled();
    expect(results.map((r) => [r.status, r.error])).toEqual([
      ["error", "500: oops"],
      ["error", "500: oops"]
    ]);
  });

  it("rejects --name with more than one address", async () => {
    const client = {} as StellarLensClient;
    await expect(
      addContracts(client, [{ address: C1 }, { address: C2 }], { network: "testnet", name: "x" })
    ).rejects.toThrow(/--name/);
  });
});

describe("addContracts chunking", () => {
  it("sends more than BULK_CHUNK_SIZE unique addresses across several requests", async () => {
    expect(encodeContract(createHash("sha256").update("a").digest())).toBe(C1);

    const registerContractsBulk = bulkResponder();
    const client = { registerContractsBulk } as unknown as StellarLensClient;
    const entries = Array.from({ length: BULK_CHUNK_SIZE + 5 }, (_, i) => ({
      address: encodeContract(createHash("sha256").update(`contract-${i}`).digest())
    }));

    const results = await addContracts(client, entries, { network: "testnet" });

    expect(registerContractsBulk).toHaveBeenCalledTimes(2);
    expect(registerContractsBulk.mock.calls[0][0]).toHaveLength(BULK_CHUNK_SIZE);
    expect(registerContractsBulk.mock.calls[1][0]).toHaveLength(5);
    expect(results.every((r) => r.status === "created")).toBe(true);
    expect(results.map((r) => r.id)).toEqual(entries.map((_, i) => i + 1));
  });
});

describe("runAddContracts", () => {
  it("prints a line per address plus a summary and returns false when any fail", async () => {
    const client = { registerContractsBulk: bulkResponder() } as unknown as StellarLensClient;
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StellarLensClient } from "@stellarlens/sdk";
import { addContract, listContracts } from "./contracts.js";

describe("addContract", () => {
  it("registers a contract and prints confirmation", async () => {
    const registerContract = vi.fn().mockResolvedValue({ id: 1, address: "C1", name: null, network: "testnet" });
    const client = { registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ok = await runAddContracts(client, [{ address: C1 }, { address: "bad" }, { address: C2 }], {
      network: "testnet"
    });

    expect(ok).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`created    ${C1} (testnet) id=1`));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("invalid    bad"));
    expect(logSpy).toHaveBeenLastCalledWith("2 succeeded, 1 failed (3 total)");
  });

  it("returns true when every address succeeds", async () => {
    const client = { registerContract: singleResponder() } as unknown as StellarLensClient;
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await runAddContracts(client, [{ address: C1 }], { network: "testnet" })).toBe(true);
  });

  it("returns false when given no addresses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runAddContracts({} as StellarLensClient, [])).toBe(false);
  });
});

describe("parseContractsFile", () => {
  it("parses text files, ignoring blank lines and comments", () => {
    expect(parseContractsFile("contracts.txt", `# protocol\n${C1}\n\n  ${C2}  # router\r\n`)).toEqual([
      { address: C1 },
      { address: C2 }
    ]);
  });

  it("parses a JSON array of strings and objects", () => {
    const json = JSON.stringify([C1, { address: C2, network: "mainnet", name: "Router" }]);
    expect(parseContractsFile("contracts.json", json)).toEqual([
      { address: C1 },
      { address: C2, network: "mainnet", name: "Router" }
    ]);
  });

  it("accepts an { items } envelope matching the bulk api body", () => {
    const json = JSON.stringify({ items: [{ address: C1, network: "testnet" }] });
    expect(parseContractsFile("contracts.json", json)).toEqual([{ address: C1, network: "testnet" }]);
  });

  it("rejects malformed JSON and unexpected shapes", () => {
    expect(() => parseContractsFile("c.json", "{")).toThrow(/invalid JSON/);
    expect(() => parseContractsFile("c.json", '{"a":1}')).toThrow(/array/);
    expect(() => parseContractsFile("c.json", "[1]")).toThrow(/c\.json\[0\]/);
    expect(() => parseContractsFile("c.json", '[{"address":1}]')).toThrow(/must be strings/);
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
    const client = {
      listContracts: vi.fn().mockResolvedValue({ data: [], nextCursor: null })
    } as unknown as StellarLensClient;
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

describe("getContract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the contract's details", async () => {
    const getContractMock = vi.fn().mockResolvedValue({ id: 1, address: C1, name: "My token", network: "testnet" });
    const client = { getContract: getContractMock } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await getContract(client, 1);

    expect(getContractMock).toHaveBeenCalledWith(1);
    const output = logSpy.mock.calls.map((call) => call[0]).join("
");
    expect(output).toContain("id:      1");
    expect(output).toContain(`address: ${C1}`);
    expect(output).toContain("name:    My token");
    expect(output).toContain("network: testnet");
  });

  it("rejects with a clear error for a nonexistent id", async () => {
    const getContractMock = vi
      .fn()
      .mockRejectedValue(new StellarLensApiError(404, { message: "Contract 999 not found" }));
    const client = { getContract: getContractMock } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(getContract(client, 999)).rejects.toThrow("contract 999 not found");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("passes other api errors through unchanged", async () => {
    const error = new StellarLensApiError(500, {});
    const client = { getContract: vi.fn().mockRejectedValue(error) } as unknown as StellarLensClient;

    await expect(getContract(client, 1)).rejects.toBe(error);
  });
});

describe("--json output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listContracts prints a JSON array instead of a table", async () => {
    const contracts = [
      { id: 1, address: C1, name: "one", network: "testnet" },
      { id: 2, address: C2, name: null, network: "mainnet" }
    ];
    const client = {
      listAllContracts: async function* () {
        yield* contracts;
      }
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client, { json: true });

    expect(tableSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(contracts);
  });

  it("listContracts prints an empty JSON array when there are no contracts", async () => {
    const client = {
      listAllContracts: async function* () {}
    } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listContracts(client, { json: true });

    expect(logSpy).toHaveBeenCalledWith("[]");
  });

  it("runAddContracts prints the results as JSON and still reports failures", async () => {
    const registerContract = singleResponder();
    const client = { registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ok = await runAddContracts(client, [{ address: C1 }], { network: "testnet", json: true });

    expect(ok).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual([
      { address: C1, network: "testnet", status: "registered", id: 1 }
    ]);
  });
});
