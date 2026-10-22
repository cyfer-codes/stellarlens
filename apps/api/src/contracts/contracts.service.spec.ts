import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContractsService } from './contracts.service';
import { DATABASE } from '../database/database.module';

describe('ContractsService', () => {
  let service: ContractsService;

  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));

  const mockDb = {
    insert: mockInsert,
    select: mockSelect,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        {
          provide: DATABASE,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
  });

  describe('register', () => {
    it('should insert a new contract and return the created row', async () => {
      const contractData = {
        name: 'Test Contract',
        address: '0x1234567890abcdef',
      };
      const createdContract = {
        id: 'contract-1',
        ...contractData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReturning.mockResolvedValueOnce([createdContract]);

      const result = await service.register(contractData as any);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockValues).toHaveBeenCalledWith(contractData);
      expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(mockReturning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(createdContract);
    });

    it('should update the existing contract on conflict and return the updated row', async () => {
      const contractData = {
        name: 'Updated Contract',
        address: '0x1234567890abcdef',
      };
      const updatedContract = {
        id: 'contract-1',
        ...contractData,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-02-01'),
      };

      mockReturning.mockResolvedValueOnce([updatedContract]);

      const result = await service.register(contractData as any);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockValues).toHaveBeenCalledWith(contractData);
      expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(mockReturning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updatedContract);
    });
  });

  describe('findAll', () => {
    it('should return all contracts from the select chain', async () => {
      const contracts = [
        {
          id: 'contract-1',
          name: 'Contract One',
          address: '0x1111111111111111',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'contract-2',
          name: 'Contract Two',
          address: '0x2222222222222222',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockLimit.mockResolvedValueOnce(contracts);

      const result = await service.findAll();

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockWhere).toHaveBeenCalledTimes(1);
      expect(mockOrderBy).toHaveBeenCalledTimes(1);
      expect(mockLimit).toHaveBeenCalledWith(21);
      expect(result).toEqual({ data: contracts, nextCursor: null });
    });

    it('should return an empty array when no contracts exist', async () => {
      mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockLimit.mockResolvedValueOnce([]);

      const result = await service.findAll();

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockWhere).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: [], nextCursor: null });
    });
  });

  describe('findOne', () => {
    it('should return the found contract', async () => {
      const contract = {
        id: 'contract-1',
        name: 'Contract One',
        address: '0x1111111111111111',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockWhere.mockResolvedValueOnce([contract]);

      const result = await service.findOne('contract-1');

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockWhere).toHaveBeenCalledTimes(1);
      expect(result).toEqual(contract);
    });

    it('should throw NotFoundException when no contract is found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockWhere).toHaveBeenCalledTimes(1);
    });
  });
});