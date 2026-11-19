import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiKeysService } from './api-keys.service';
import { DATABASE } from '../database/database.module';

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  const mockInsertValues = vi.fn();
  const mockInsertReturning = vi.fn();
  const mockInsert = vi.fn(() => ({
    values: mockInsertValues,
  }));

  const mockSelectWhere = vi.fn();
  const mockSelectFrom = vi.fn(() => ({
    where: mockSelectWhere,
  }));
  const mockSelect = vi.fn(() => ({
    from: mockSelectFrom,
  }));

  const mockUpdateWhere = vi.fn();
  const mockUpdateSet = vi.fn(() => ({
    where: mockUpdateWhere,
  }));
  const mockUpdate = vi.fn(() => ({
    set: mockUpdateSet,
  }));

  const mockDb = {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockInsertValues.mockReturnValue({
      returning: mockInsertReturning,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: DATABASE,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  describe('generate', () => {
    it('returns the raw key exactly once while persisting only its hash', async () => {
      const persistedRow = {
        id: 'key-1',
        name: 'Test Key',
        keyHash: 'irrelevant',
        createdAt: new Date(),
        revokedAt: null,
      };
      mockInsertReturning.mockResolvedValue([persistedRow]);

      const result = await service.generate({ name: 'Test Key' });

      expect(result).toHaveProperty('key');
      expect(typeof result.key).toBe('string');
      expect(result.key.length).toBeGreaterThan(0);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsertValues).toHaveBeenCalledTimes(1);

      const insertedValues = mockInsertValues.mock.calls[0][0];
      const expectedHash = createHash('sha256')
        .update(result.key)
        .digest('hex');

      expect(insertedValues.keyHash).toBe(expectedHash);
      expect(insertedValues.name).toBe('Test Key');

      // The raw key must not be persisted anywhere in the insert values.
      const serializedValues = JSON.stringify(insertedValues);
      expect(serializedValues).not.toContain(result.key);
      expect(insertedValues).not.toHaveProperty('key');
    });
  });

  describe('revoke', () => {
    it('is a no-op when the key is already revoked', async () => {
      mockSelectWhere.mockResolvedValue([
        {
          id: 'key-1',
          name: 'Test Key',
          keyHash: 'hash',
          createdAt: new Date(),
          revokedAt: new Date(),
        },
      ]);

      await expect(service.revoke(1)).resolves.not.toThrow();

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the key does not exist', async () => {
      mockSelectWhere.mockResolvedValue([]);

      await expect(service.revoke(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});