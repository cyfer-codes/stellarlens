import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { ContractsService } from "./contracts.service";
import type { BulkCreateContractsDto } from "./dto/bulk-create-contracts.dto";

const contractAddress = (label: string) =>
  StrKey.encodeContract(createHash("sha256").update(label).digest());

const ADDRESS_A = contractAddress("BULK_UNIT_A");
const ADDRESS_B = contractAddress("BULK_UNIT_B");

function createDbMock(options: {
  created?: { id: number; address: string; name: string | null; network: string }[];
  existing?: { id: number; address: string; name: string | null; network: string }[];
}) {
  const returning = vi.fn().mockResolvedValue(options.created ?? []);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const where = vi.fn().mockResolvedValue(options.existing ?? []);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const tx = { insert, select };
  const transaction = vi.fn(
    (callback: (client: { insert: typeof insert; select: typeof select }) => unknown) =>
      callback(tx)
  );

  return {
    db: { insert, select, transaction },
    insert,
    values,
    onConflictDoNothing,
    select,
    where,
    transaction
  };
}

describe("ContractsService.registerBulk", () => {
  it("inserts valid items in one transaction and reports per-item results", async () => {
    const db = createDbMock({
      created: [{ id: 1, address: ADDRESS_A, name: "Bulk A", network: "testnet" }],
      existing: [{ id: 9, address: ADDRESS_B, name: "Already Here", network: "testnet" }]
    });
    const service = new ContractsService(db.db as never);
    const dto: BulkCreateContractsDto = {
      items: [
        { address: ADDRESS_A, network: "testnet", name: "Bulk A" },
        { address: ADDRESS_B, network: "testnet", name: "Ignored Rename" },
        { address: "not-an-address", network: "testnet" }
      ]
    };

    const result = await service.registerBulk(dto);

    expect(result.results).toEqual([
      {
        index: 0,
        address: ADDRESS_A,
        network: "testnet",
        name: "Bulk A",
        status: "created",
        id: 1
      },
      {
        index: 1,
        address: ADDRESS_B,
        network: "testnet",
        name: "Already Here",
        status: "existing",
        id: 9
      },
      {
        index: 2,
        address: "not-an-address",
        network: "testnet",
        name: null,
        status: "error",
        error: expect.stringMatching(/address/i)
      }
    ]);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith([
      { address: ADDRESS_A, network: "testnet", name: "Bulk A" },
      { address: ADDRESS_B, network: "testnet", name: "Ignored Rename" }
    ]);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repeated addresses within a batch", async () => {
    const db = createDbMock({
      created: [{ id: 1, address: ADDRESS_A, name: "First", network: "testnet" }]
    });
    const service = new ContractsService(db.db as never);
    const dto: BulkCreateContractsDto = {
      items: [
        { address: ADDRESS_A, network: "testnet", name: "First" },
        { address: ADDRESS_A, network: "testnet", name: "Second" }
      ]
    };

    const result = await service.registerBulk(dto);

    expect(result.results.map((item) => item.status)).toEqual(["created", "existing"]);
    expect(result.results[1].id).toBe(1);
    expect(db.values).toHaveBeenCalledWith([
      { address: ADDRESS_A, network: "testnet", name: "First" }
    ]);
  });

  it("does not open a transaction when every item is invalid", async () => {
    const db = createDbMock({});
    const service = new ContractsService(db.db as never);

    const result = await service.registerBulk({
      items: [{ address: "nope", network: "" }]
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("error");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
