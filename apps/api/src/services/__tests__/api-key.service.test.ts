import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiKeyService } from '../api-key.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../types';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let mockPrismaService: jest.Mocked<PrismaService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    // Create mock with minimal required methods
    const createMock = jest.fn();
    const findFirstMock = jest.fn();
    const findManyMock = jest.fn();
    const updateMock = jest.fn();
    const deleteMock = jest.fn();

    mockPrismaService = {
      db: {
        apiKey: {
          create: createMock,
          findFirst: findFirstMock,
          findMany: findManyMock,
          update: updateMock,
          delete: deleteMock,
        },
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockConfigService = {
      get: jest
        .fn()
        .mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'NODE_ENV') return 'development';
          return defaultValue;
        }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createApiKey', () => {
    it('should create a new API key successfully', async () => {
      const mockApiKey = {
        id: 'api-key-123',
        organizationId: testIds.organization,
        createdBy: testIds.user,
        name: 'Test API Key',
        description: 'Test description',
        keyHash: 'hashed-key',
        prefix: 'hh_dev_test',
        scopes: ['read:projects'],
        expiresAt: null as Date | null,
        isActive: true,
        lastUsedAt: null as Date | null,
        lastUsedIp: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrismaService.db.apiKey.create as jest.Mock).mockResolvedValue(
        mockApiKey,
      );

      const result = await service.createApiKey({
        organizationId: testIds.organization,
        createdBy: testIds.user,
        name: 'Test API Key',
        description: 'Test description',
        scopes: ['read:projects'],
      });

      expect(result).toHaveProperty('id', 'api-key-123');
      expect(result).toHaveProperty('key'); // Should have the actual key
      expect(result.key).toMatch(/^hh_dev_/); // Should match our format
      expect(result).toHaveProperty('name', 'Test API Key');
      expect(result).toHaveProperty('scopes', ['read:projects']);
      expect(mockPrismaService.db.apiKey.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid scopes', async () => {
      await expect(
        service.createApiKey({
          organizationId: testIds.organization,
          createdBy: testIds.user,
          name: 'Test API Key',
          scopes: ['invalid:scope'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateApiKey', () => {
    it('should validate a correct API key', async () => {
      const mockApiKey = {
        id: 'api-key-123',
        organizationId: testIds.organization,
        createdBy: testIds.user,
        name: 'Test API Key',
        keyHash: '$2b$12$hash', // This would be the actual bcrypt hash
        prefix: 'hh_dev_test',
        scopes: ['read:projects'],
        expiresAt: null as Date | null,
        isActive: true,
      };

      (mockPrismaService.db.apiKey.findFirst as jest.Mock).mockResolvedValue(
        mockApiKey,
      );
      (mockPrismaService.db.apiKey.update as jest.Mock).mockResolvedValue(
        mockApiKey,
      );

      // Mock bcrypt compare - we'll assume it passes
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      const result = await service.validateApiKey(
        'hh_dev_test12345678901234567890',
        '127.0.0.1',
      );

      expect(result).toEqual({
        id: 'api-key-123',
        organizationId: testIds.organization,
        scopes: ['read:projects'],
        name: 'Test API Key',
        createdBy: testIds.user,
      });
    });

    it('should throw BadRequestException for invalid key format', async () => {
      await expect(
        service.validateApiKey('invalid-key', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-existent key', async () => {
      (mockPrismaService.db.apiKey.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.validateApiKey('hh_dev_test12345678901234567890', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getApiKeys', () => {
    it('should return all API keys for an organization', async () => {
      const mockApiKeys = [
        {
          id: 'key-1',
          organizationId: testIds.organization,
          createdBy: testIds.user,
          name: 'API Key 1',
          description: 'First key',
          keyHash: 'hash1',
          prefix: 'hh_dev_key1',
          scopes: ['read:projects'],
          expiresAt: null as Date | null,
          isActive: true,
          lastUsedAt: null as Date | null,
          lastUsedIp: null as string | null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (mockPrismaService.db.apiKey.findMany as jest.Mock).mockResolvedValue(
        mockApiKeys,
      );

      const result = await service.getApiKeys(testIds.organization);

      const [mockApiKey] = mockApiKeys;
      if (!mockApiKey) {
        throw new Error('Expected mock API key');
      }

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'key-1',
        prefix: 'hh_dev_key1',
        name: 'API Key 1',
        description: 'First key',
        scopes: ['read:projects'],
        lastUsedAt: undefined,
        lastUsedIp: undefined,
        expiresAt: undefined,
        createdAt: mockApiKey.createdAt,
        updatedAt: mockApiKey.updatedAt,
        isActive: true,
        createdBy: testIds.user,
      });
    });
  });

  describe('deleteApiKey', () => {
    it('should delete an API key successfully', async () => {
      const mockDeleteResult = {
        id: 'api-key-123',
        organizationId: testIds.organization,
        createdBy: testIds.user,
        name: 'Test API Key',
        description: null as string | null,
        keyHash: 'hash',
        prefix: 'hh_dev_test',
        scopes: ['read:projects'],
        expiresAt: null as Date | null,
        isActive: true,
        lastUsedAt: null as Date | null,
        lastUsedIp: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrismaService.db.apiKey.delete as jest.Mock).mockResolvedValue(
        mockDeleteResult,
      );

      await service.deleteApiKey('api-key-123' as any, testIds.organization);

      expect(mockPrismaService.db.apiKey.delete).toHaveBeenCalledWith({
        where: {
          id: 'api-key-123',
          organizationId: testIds.organization,
        },
      });
    });

    it('should throw NotFoundException if key does not exist', async () => {
      (mockPrismaService.db.apiKey.delete as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      await expect(
        service.deleteApiKey('non-existent' as any, testIds.organization),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
