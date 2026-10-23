import { Test, TestingModule } from '@nestjs/testing';
import { ConfigEncryptionService } from '../config-encryption.service';
import { KeyProviderFactory } from '../encryption/key-provider.factory';
import { HkdfKeyProvider } from '../encryption/hkdf-key-provider';
import { IntegrationType } from '../../generated';
import { OrganizationId } from '../../types';

describe('ConfigEncryptionService', () => {
  let service: ConfigEncryptionService;
  const organizationId: OrganizationId = 'org-123' as OrganizationId;

  beforeEach(async () => {
    // Create a fresh mock key provider for each test
    const mockKeyProvider = new HkdfKeyProvider({
      masterKey: HkdfKeyProvider.generateMasterKey(),
      currentVersion: 'v1',
    });

    const mockKeyProviderFactory = {
      createFromEnvironment: jest.fn().mockReturnValue(mockKeyProvider),
      createKeyProvider: jest.fn().mockReturnValue(mockKeyProvider),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigEncryptionService,
        {
          provide: KeyProviderFactory,
          useValue: mockKeyProviderFactory,
        },
      ],
    }).compile();

    service = module.get<ConfigEncryptionService>(ConfigEncryptionService);
  });

  afterEach(() => {
    // Clear all mocks after each test to prevent pollution
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with key provider', () => {
      expect(service).toBeDefined();

      const providerInfo = service.getProviderInfo();
      expect(providerInfo.type).toBe('hkdf');
      expect(providerInfo.initialized).toBe(true);
    });
  });

  describe('getSensitiveFields', () => {
    it('should return correct sensitive fields for GitHub', () => {
      const fields = service.getSensitiveFields(IntegrationType.Github);
      expect(fields).toEqual([
        'token',
        'refreshToken',
        'privateKey',
        'webhookSecret',
      ]);
    });

    it('should return correct sensitive fields for Slack', () => {
      const fields = service.getSensitiveFields(IntegrationType.Slack);
      expect(fields).toEqual([
        'botToken',
        'userToken',
        'signingSecret',
        'clientSecret',
      ]);
    });

    it('should return empty array for unknown integration type', () => {
      const fields = service.getSensitiveFields('UNKNOWN' as IntegrationType);
      expect(fields).toEqual([]);
    });
  });

  describe('encryptConfig', () => {
    it('should encrypt sensitive fields in config', async () => {
      const config = {
        token: 'secret-token',
        publicUrl: 'https://api.github.com',
        otherField: 'not-sensitive',
      };

      const encrypted = await service.encryptConfig(
        config,
        IntegrationType.Github,
        organizationId,
      );

      expect((encrypted as any).token).toEqual({
        _encrypted: true,
        keyVersion: 'v1',
        algorithm: 'aes-256-gcm',
        data: expect.any(String),
        iv: expect.any(String),
        tag: expect.any(String),
      });
      expect((encrypted as any).publicUrl).toBe('https://api.github.com');
      expect((encrypted as any).otherField).toBe('not-sensitive');
    });

    it('should handle empty config', async () => {
      const result = await service.encryptConfig(
        null as any,
        IntegrationType.Github,
        organizationId,
      );
      expect(result).toBeNull();
    });

    it('should handle config with no sensitive fields', async () => {
      const config = {
        publicUrl: 'https://api.github.com',
        timeout: 5000,
      };

      const encrypted = await service.encryptConfig(
        config,
        IntegrationType.Github,
        organizationId,
      );

      expect(encrypted).toEqual(config);
    });

    it('should skip non-string sensitive fields', async () => {
      const config = {
        token: null as string | null,
        privateKey: 'actual-secret',
        webhookSecret: 123,
        otherField: 'not-sensitive',
      };

      const encrypted = await service.encryptConfig(
        config,
        IntegrationType.Github,
        organizationId,
      );

      expect((encrypted as any).token).toBeNull();
      expect((encrypted as any).privateKey).toHaveProperty('_encrypted', true);
      expect((encrypted as any).webhookSecret).toBe(123);
      expect((encrypted as any).otherField).toBe('not-sensitive');
    });

    it('should throw error on encryption failure', async () => {
      // Create a dedicated failing service for this test
      const failingProvider = {
        getKey: jest.fn().mockRejectedValue(new Error('Key derivation failed')),
        getCurrentVersion: () => 'v1',
        getProviderType: () => 'failing',
        isInitialized: () => true,
        listVersions: () => ['v1'],
      };

      const failingKeyProviderFactory = {
        createFromEnvironment: jest.fn().mockReturnValue(failingProvider),
        createKeyProvider: jest.fn().mockReturnValue(failingProvider),
      };

      const failingService = new ConfigEncryptionService(
        failingKeyProviderFactory as any,
      );

      const config = { token: 'secret' };

      await expect(
        failingService.encryptConfig(
          config,
          IntegrationType.Github,
          organizationId,
        ),
      ).rejects.toThrow('Failed to encrypt sensitive field: token');
    });
  });

  describe('decryptConfig', () => {
    it('should decrypt encrypted fields in config', async () => {
      const originalConfig = {
        token: 'secret-token',
        publicUrl: 'https://api.github.com',
      };

      // First encrypt
      const encrypted = await service.encryptConfig(
        originalConfig,
        IntegrationType.Github,
        organizationId,
      );

      // Then decrypt
      const decrypted = await service.decryptConfig(
        encrypted,
        IntegrationType.Github,
        organizationId,
      );

      expect((decrypted as any).token).toBe('secret-token');
      expect((decrypted as any).publicUrl).toBe('https://api.github.com');
    });

    it('should handle config with no encrypted fields', async () => {
      const config = {
        publicUrl: 'https://api.github.com',
        timeout: 5000,
      };

      const decrypted = await service.decryptConfig(
        config,
        IntegrationType.Github,
        organizationId,
      );

      expect(decrypted).toEqual(config);
    });

    it('should handle legacy encrypted format', async () => {
      const config = {
        token: {
          _encrypted: true,
          data: 'encrypted-data',
          iv: 'aXY=', // base64 'iv'
          tag: 'dGFn', // base64 'tag'
          // Missing keyVersion and algorithm - should default
        },
      };

      // Create a dedicated mock setup for this test
      const mockProvider = {
        getKey: jest.fn().mockResolvedValue(Buffer.alloc(32)),
        getCurrentVersion: () => 'v1',
        getProviderType: () => 'mock',
        isInitialized: () => true,
        listVersions: () => ['v1'],
      };

      const mockKeyProviderFactory = {
        createFromEnvironment: jest.fn().mockReturnValue(mockProvider),
        createKeyProvider: jest.fn().mockReturnValue(mockProvider),
      };

      // Mock crypto operations
      const crypto = require('crypto');
      const mockDecipher = {
        setAuthTag: jest.fn(),
        update: jest.fn().mockReturnValue('decrypted-'),
        final: jest.fn().mockReturnValue('token'),
      };
      const createDecipherivSpy = jest
        .spyOn(crypto, 'createDecipheriv')
        .mockReturnValue(mockDecipher);

      const testService = new ConfigEncryptionService(
        mockKeyProviderFactory as any,
      );

      const decrypted = await testService.decryptConfig(
        config,
        IntegrationType.Github,
        organizationId,
      );

      expect(mockProvider.getKey).toHaveBeenCalledWith(organizationId, 'v1');
      expect((decrypted as any).token).toBe('decrypted-token');

      // Clean up the crypto mock
      createDecipherivSpy.mockRestore();
    });

    it('should throw error on decryption failure', async () => {
      const config = {
        token: {
          _encrypted: true,
          keyVersion: 'v1',
          algorithm: 'aes-256-gcm',
          data: 'invalid-encrypted-data',
          iv: 'aXY=',
          tag: 'dGFn',
        },
      };

      await expect(
        service.decryptConfig(config, IntegrationType.Github, organizationId),
      ).rejects.toThrow('Failed to decrypt sensitive field: token');
    });

    it('should handle empty config', async () => {
      const result = await service.decryptConfig(
        null as any,
        IntegrationType.Github,
        organizationId,
      );
      expect(result).toBeNull();
    });
  });

  describe('maskConfigForResponse', () => {
    it('should mask sensitive fields', () => {
      const config = {
        token: 'secret-token',
        publicUrl: 'https://api.github.com',
        webhookSecret: 'webhook-secret',
      };

      const masked = service.maskConfigForResponse(
        config,
        IntegrationType.Github,
      );

      expect((masked as any).token).toBe('***MASKED***');
      expect((masked as any).webhookSecret).toBe('***MASKED***');
      expect((masked as any).publicUrl).toBe('https://api.github.com');
    });

    it('should handle config with no sensitive fields', () => {
      const config = {
        publicUrl: 'https://api.github.com',
        timeout: 5000,
      };

      const masked = service.maskConfigForResponse(
        config,
        IntegrationType.Github,
      );

      expect(masked).toEqual(config);
    });

    it('should handle empty config', () => {
      const result = service.maskConfigForResponse(
        null as any,
        IntegrationType.Github,
      );
      expect(result).toBeNull();
    });
  });

  describe('hasEncryptedFields', () => {
    it('should detect encrypted fields', () => {
      const config = {
        token: {
          _encrypted: true,
          data: 'encrypted-data',
        },
        publicUrl: 'https://api.github.com',
      };

      expect(service.hasEncryptedFields(config)).toBe(true);
    });

    it('should return false for config without encrypted fields', () => {
      const config = {
        token: 'plain-text',
        publicUrl: 'https://api.github.com',
      };

      expect(service.hasEncryptedFields(config)).toBe(false);
    });

    it('should handle empty config', () => {
      expect(service.hasEncryptedFields(null as any)).toBe(false);
      expect(service.hasEncryptedFields({})).toBe(false);
    });
  });

  describe('getProviderInfo', () => {
    it('should return provider information', () => {
      const info = service.getProviderInfo();

      expect(info).toEqual({
        type: 'hkdf',
        currentVersion: 'v1',
        availableVersions: ['v1'],
        initialized: true,
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle full encrypt-decrypt cycle for different organizations', async () => {
      const config = { token: 'secret-token' };
      const org1 = 'org-1' as OrganizationId;
      const org2 = 'org-2' as OrganizationId;

      // Encrypt with different organizations
      const encrypted1 = await service.encryptConfig(
        config,
        IntegrationType.Github,
        org1,
      );
      const encrypted2 = await service.encryptConfig(
        config,
        IntegrationType.Github,
        org2,
      );

      // Encrypted data should be different
      expect((encrypted1 as any).token.data).not.toBe(
        (encrypted2 as any).token.data,
      );

      // But both should decrypt correctly with their respective org IDs
      const decrypted1 = await service.decryptConfig(
        encrypted1,
        IntegrationType.Github,
        org1,
      );
      const decrypted2 = await service.decryptConfig(
        encrypted2,
        IntegrationType.Github,
        org2,
      );

      expect((decrypted1 as any).token).toBe('secret-token');
      expect((decrypted2 as any).token).toBe('secret-token');
    });

    it('should handle multiple sensitive fields', async () => {
      const config = {
        botToken: 'bot-token-123',
        userToken: 'user-token-456',
        signingSecret: 'signing-secret-789',
        publicChannel: '#general',
      };

      const encrypted = await service.encryptConfig(
        config,
        IntegrationType.Slack,
        organizationId,
      );

      expect((encrypted as any).botToken).toHaveProperty('_encrypted', true);
      expect((encrypted as any).userToken).toHaveProperty('_encrypted', true);
      expect((encrypted as any).signingSecret).toHaveProperty(
        '_encrypted',
        true,
      );
      expect((encrypted as any).publicChannel).toBe('#general');

      const decrypted = await service.decryptConfig(
        encrypted,
        IntegrationType.Slack,
        organizationId,
      );

      expect((decrypted as any).botToken).toBe('bot-token-123');
      expect((decrypted as any).userToken).toBe('user-token-456');
      expect((decrypted as any).signingSecret).toBe('signing-secret-789');
      expect((decrypted as any).publicChannel).toBe('#general');
    });
  });

  describe('static methods', () => {
    it('should generate valid keys', () => {
      const key = ConfigEncryptionService.generateKey();
      expect(typeof key).toBe('string');
      expect(ConfigEncryptionService.validateKey(key)).toBe(true);
    });

    it('should validate keys correctly', () => {
      const validKey = ConfigEncryptionService.generateKey();
      const invalidKey = 'too-short';

      expect(ConfigEncryptionService.validateKey(validKey)).toBe(true);
      expect(ConfigEncryptionService.validateKey(invalidKey)).toBe(false);
    });
  });
});
