import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerContract, ContractAlreadyRegisteredError } from "./registry.js";

const address = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const registration = { address, name: "New name", network: "testnet" };

describe("registerContract", () => {
  const returning = vi.fn();
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const where = vi.fn();
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const db = { insert, select } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a contract without updating on conflict", async () => {
    const created = { id: 7, ...registration, decimals: null, symbol: null, tokenName: null };
    returning.mockResolvedValueOnce([created]);

    await expect(registerContract(db, registration)).resolves.toEqual(created);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate and reports the existing id without updating it", async () => {
    returning.mockResolvedValueOnce([]);
    where.mockResolvedValueOnce([{ id: 19 }]);

    await expect(registerContract(db, { ...registration, name: "Replacement", network: "mainnet" }))
      .rejects.toBeInstanceOf(ContractAlreadyRegisteredError);
    await expect(registerContract(db, registration)).rejects.toBeInstanceOf(Error);
  });
});
