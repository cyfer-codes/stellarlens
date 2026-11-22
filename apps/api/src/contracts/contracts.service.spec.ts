import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContractsService } from "./contracts.service";
import { DATABASE } from "../database/database.module";
import type { CreateContractDto } from "./dto/create-contract.dto";

describe("ContractsService", () => {
  let service: ContractsService;

  const mockReturning = vi.fn();
  const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockDb = { insert: mockInsert, select: mockSelect };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractsService, { provide: DATABASE, useValue: mockDb }]
    }).compile();
    service = module.get<ContractsService>(ContractsService);
  });

  describe("register", () => {
    const input = {
      address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      name: "Original name",
      network: "testnet"
    } as CreateContractDto;

    it("inserts and returns a newly registered contract", async () => {
      const created = { id: 12, ...input };
      mockReturning.mockResolvedValueOnce([created]);

      await expect(service.register(input)).resolves.toEqual(created);
      expect(mockValues).toHaveBeenCalledWith(input);
      expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1);
    });

    it("returns 409 with the existing id without mutating a duplicate", async () => {
      const existing = { id: 42, address: input.address, name: "Keep this name", network: "mainnet" };
      mockReturning.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([existing]);

      await expect(service.register({ ...input, name: "Overwrite attempt", network: "testnet" }))
        .rejects.toMatchObject({
          status: 409,
          response: {
            message: "A contract with this address is already registered. Use PATCH /contracts/:id to update it.",
            existingId: 42
          }
        });
      expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1);
    });

    it("asks the caller to retry if a conflicting row disappears before lookup", async () => {
      mockReturning.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([]);

      await expect(service.register(input)).rejects.toThrow(ConflictException);
    });
  });

  describe("findOne", () => {
    it("returns the found contract", async () => {
      const contract = { id: 1, address: inputAddress(), name: "Contract", network: "testnet", decimals: null, symbol: null };
      mockWhere.mockResolvedValueOnce([contract]);
      await expect(service.findOne(1)).resolves.toEqual(contract);
    });

    it("throws NotFoundException when no contract is found", async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });
});

function inputAddress() {
  return "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
}
