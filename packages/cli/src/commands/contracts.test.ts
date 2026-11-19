import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StellarLensClient } from "@stellarlens/sdk";
import {
  addContract,
  addContracts,
  isValidStellarAddress,
  listContracts,
  parseAddressesFromFile
} from "./contracts.js";

// Deterministic valid checksummed addresses for testing
const VALID_CONTRACT_1 = StrKey.encodeContract(Buffer.alloc(32, 1));
const VALID_CONTRACT_2 = StrKey.encodeContract(Buffer.alloc(32, 2));
const VALID_ACCOUNT_1 = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const INVALID_ADDRESS = "C_NOT_A_VALID_CHECKSUMMED_STRKEY_123";

describe("isValidStellarAddress", () => {
  it("returns true for a valid contract (C...) strkey", () => {
    expect(isValidStellarAddress(VALID_CONTRACT_1)).toBe(true);
  });

  it("returns true for a valid account (G...) strkey", () => {
    expect(isValidStellarAddress(VALID_ACCOUNT_1)).toBe(true);
  });

  it("returns false for invalid addresses", () => {
    expect(isValidStellarAddress("")).toBe(false);
    expect(isValidStellarAddress(INVALID_ADDRESS)).toBe(false);
    expect(isValidStellarAddress("c12345")).toBe(false);
    expect(isValidStellarAddress(null as unknown as string)).toBe(false);
  });
});

describe("parseAddressesFromFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stellarlens-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses newline-delimited addresses from a .txt file, ignoring comments and blanks", () => {
    const filePath = path.join(tempDir, "contracts.txt");
    fs.writeFileSync(
      filePath,
      `
# Header comment
${VALID_CONTRACT_1} Token A
// another comment

${VALID_CONTRACT_2} # inline comment
      `.trim()
    );

    const targets = parseAddressesFromFile(filePath);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({ address: VALID_CONTRACT_1, name: "Token A" });
    expect(targets[1]).toEqual({ address: VALID_CONTRACT_2, name: undefined });
  });

  it("parses string array from a .json file", () => {
    const filePath = path.join(tempDir, "contracts.json");
    fs.writeFileSync(filePath, JSON.stringify([VALID_CONTRACT_1, VALID_CONTRACT_2]));

    const targets = parseAddressesFromFile(filePath);
    expect(targets).toEqual([{ address: VALID_CONTRACT_1 }, { address: VALID_CONTRACT_2 }]);
  });

  it("parses object array from a .json file", () => {
    const filePath = path.join(tempDir, "contracts.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        { address: VALID_CONTRACT_1, name: "Treasury" },
        { address: VALID_CONTRACT_2, name: "Escrow" }
      ])
    );

    const targets = parseAddressesFromFile(filePath);
    expect(targets).toEqual([
      { address: VALID_CONTRACT_1, name: "Treasury" },
      { address: VALID_CONTRACT_2, name: "Escrow" }
    ]);
  });

  it("parses an object with an 'addresses' array from a .json file", () => {
    const filePath = path.join(tempDir, "bundle.json");
    fs.writeFileSync(filePath, JSON.stringify({ addresses: [VALID_CONTRACT_1] }));

    const targets = parseAddressesFromFile(filePath);
    expect(targets).toEqual([{ address: VALID_CONTRACT_1 }]);
  });

  it("throws when file does not exist", () => {
    expect(() => parseAddressesFromFile(path.join(tempDir, "nonexistent.txt"))).toThrow(
      "file not found"
    );
  });
});

describe("addContracts", () => {
  it("registers multiple addresses sequentially and reports per-address results", async () => {
    const registerContract = vi.fn().mockImplementation(async ({ address }) => ({
      id: address === VALID_CONTRACT_1 ? 1 : 2,
      address,
      network: "testnet"
    }));
    const client = { registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const success = await addContracts(client, [VALID_CONTRACT_1, VALID_CONTRACT_2], {
      network: "testnet"
    });

    expect(success).toBe(true);
    expect(registerContract).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`✓ ${VALID_CONTRACT_1}: registered`)
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`✓ ${VALID_CONTRACT_2}: registered`)
    );
    logSpy.mockRestore();
  });

  it("validates strkeys before sending and rejects invalid ones without calling API", async () => {
    const registerContract = vi
      .fn()
      .mockResolvedValue({ id: 1, address: VALID_CONTRACT_1, network: "testnet" });
    const client = { registerContract } as unknown as StellarLensClient;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const success = await addContracts(client, [VALID_CONTRACT_1, INVALID_ADDRESS], {
      network: "testnet"
    });

    // Exit code condition: false because at least one address failed
    expect(success).toBe(false);
    expect(registerContract).toHaveBeenCalledTimes(1); // API only called for valid address
    expect(registerContract).toHaveBeenCalledWith({
      address: VALID_CONTRACT_1,
      network: "testnet",
      name: undefined
    });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`✗ ${INVALID_ADDRESS}: invalid Stellar strkey`)
    );
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("uses bulk registration when available on client", async () => {
    const registerContracts = vi.fn().mockResolvedValue([
      { id: 10, address: VALID_CONTRACT_1, network: "testnet" },
      { id: 20, address: VALID_CONTRACT_2, network: "testnet" }
    ]);
    const registerContract = vi.fn();
    const client = { registerContracts, registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const success = await addContracts(client, [VALID_CONTRACT_1, VALID_CONTRACT_2], {
      network: "testnet"
    });

    expect(success).toBe(true);
    expect(registerContracts).toHaveBeenCalledTimes(1);
    expect(registerContract).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("reads addresses from a file and combines with CLI arguments", async () => {
    const tempFile = path.join(os.tmpdir(), `contracts-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, `${VALID_CONTRACT_1} FileContract\n`);

    const registerContract = vi.fn().mockImplementation(async ({ address }) => ({
      id: 1,
      address,
      network: "testnet"
    }));
    const client = { registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const success = await addContracts(client, [VALID_CONTRACT_2], {
        network: "testnet",
        file: tempFile
      });

      expect(success).toBe(true);
      expect(registerContract).toHaveBeenCalledTimes(2);
    } finally {
      fs.unlinkSync(tempFile);
      logSpy.mockRestore();
    }
  });

  it("returns false if no addresses are provided", async () => {
    const client = {} as StellarLensClient;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const success = await addContracts(client, [], { network: "testnet" });

    expect(success).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("No contract addresses provided"));
    errSpy.mockRestore();
  });

  it("returns false if registration API fails for an address", async () => {
    const registerContract = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const client = { registerContract } as unknown as StellarLensClient;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const success = await addContracts(client, [VALID_CONTRACT_1], { network: "testnet" });

    expect(success).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Network timeout"));
    errSpy.mockRestore();
  });
});

describe("addContract (backward compatibility)", () => {
  it("registers a single contract and prints confirmation", async () => {
    const registerContract = vi
      .fn()
      .mockResolvedValue({ id: 1, address: VALID_CONTRACT_1, name: null, network: "testnet" });
    const client = { registerContract } as unknown as StellarLensClient;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await addContract(client, VALID_CONTRACT_1, { network: "testnet" });

    expect(registerContract).toHaveBeenCalledWith({
      address: VALID_CONTRACT_1,
      network: "testnet",
      name: undefined
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`✓ ${VALID_CONTRACT_1}: registered`)
    );
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
      listContracts: vi
        .fn()
        .mockResolvedValue([{ id: 1, address: VALID_CONTRACT_1, name: null, network: "testnet" }])
    } as unknown as StellarLensClient;
    const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

    await listContracts(client);

    expect(tableSpy).toHaveBeenCalledWith([
      { id: 1, address: VALID_CONTRACT_1, name: "—", network: "testnet" }
    ]);
    tableSpy.mockRestore();
  });
});
