import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContractsService } from "./contracts.service";

describe("ContractsService.update", () => {
  it("updates only the supplied fields and returns the updated contract", async () => {
    const updatedContract = {
      id: 42,
      address: "CONTRACT_ADDRESS",
      name: "Updated name",
      network: "mainnet"
    };
    const returning = vi.fn().mockResolvedValue([updatedContract]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const service = new ContractsService({ update } as never);

    await expect(service.update(42, { name: "Updated name", network: "mainnet" })).resolves.toEqual(
      updatedContract
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ name: "Updated name", network: "mainnet" });
  });

  it("throws NotFoundException when the contract does not exist", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const service = new ContractsService({ update } as never);

    await expect(service.update(404, { network: "testnet" })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
