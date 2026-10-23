import { HkdfKeyProvider } from '../hkdf-key-provider';
import { OrganizationId } from '../../../types';

describe('HkdfKeyProvider', () => {
  let provider: HkdfKeyProvider;
  const masterKey = HkdfKeyProvider.generateMasterKey();
  const organizationId: OrganizationId = 'org-123' as OrganizationId;

  beforeEach(() => {
    provider = new HkdfKeyProvider({
      masterKey,
      currentVersion: 'v1',
    });
  });

  describe('initialization', () => {
    it('should initialize successfully with valid master key', () => {
      expect(provider.isInitialized()).toBe(true);
      expect(provider.getCurrentVersion()).toBe('v1');
      expect(provider.getProviderType()).toBe('hkdf');
    });

    it('should throw error with missing master key', () => {
      expect(() => {
        new HkdfKeyProvider({ masterKey: '' });
      }).toThrow('Master key is required for HKDF provider');
    });

    it('should throw error with short master key', () => {
      const shortKey = Buffer.from('short').toString('base64');

      expect(() => {
        new HkdfKeyProvider({ masterKey: shortKey });
      }).toThrow('Master key must be at least 128 bits');
    });

    it('should throw error with invalid base64 master key', () => {
      expect(() => {
        new HkdfKeyProvider({ masterKey: 'invalid-base64!!!!!!!!!!!!!' });
      }).toThrow();
    });
  });

  describe('key derivation', () => {
    it('should derive consistent keys for same organization and version', async () => {
      const key1 = await provider.getKey(organizationId, 'v1');
      const key2 = await provider.getKey(organizationId, 'v1');

      expect(key1).toEqual(key2);
      expect(key1).toBeInstanceOf(Buffer);
      expect(key1.length).toBe(32); // 256 bits
    });

    it('should derive different keys for different organizations', async () => {
      const org1Key = await provider.getKey('org-1' as OrganizationId, 'v1');
      const org2Key = await provider.getKey('org-2' as OrganizationId, 'v1');

      expect(org1Key).not.toEqual(org2Key);
    });

    it('should derive different keys for different versions', async () => {
      const v1Key = await provider.getKey(organizationId, 'v1');
      const v2Key = await provider.getKey(organizationId, 'v2');

      expect(v1Key).not.toEqual(v2Key);
    });

    it('should use current version when version not specified', async () => {
      const defaultKey = await provider.getKey(organizationId);
      const v1Key = await provider.getKey(organizationId, 'v1');

      expect(defaultKey).toEqual(v1Key);
    });

    it('should throw error when not initialized', async () => {
      const uninitializedProvider = Object.create(HkdfKeyProvider.prototype);
      uninitializedProvider.initialized = false;

      await expect(
        uninitializedProvider.getKey(organizationId),
      ).rejects.toThrow('HKDF key provider not initialized');
    });
  });

  describe('version management', () => {
    it('should return current version', () => {
      expect(provider.getCurrentVersion()).toBe('v1');
    });

    it('should list available versions', () => {
      const versions = provider.listVersions();
      expect(versions).toContain('v1');
      expect(Array.isArray(versions)).toBe(true);
    });

    it('should use custom current version', () => {
      const customProvider = new HkdfKeyProvider({
        masterKey,
        currentVersion: 'v2.0',
      });

      expect(customProvider.getCurrentVersion()).toBe('v2.0');
    });
  });

  describe('static methods', () => {
    describe('validateMasterKey', () => {
      it('should validate correct master key', () => {
        const validKey = HkdfKeyProvider.generateMasterKey();
        expect(HkdfKeyProvider.validateMasterKey(validKey)).toBe(true);
      });

      it('should reject short keys', () => {
        const shortKey = Buffer.from('short').toString('base64');
        expect(HkdfKeyProvider.validateMasterKey(shortKey)).toBe(false);
      });

      it('should reject invalid base64', () => {
        expect(HkdfKeyProvider.validateMasterKey('invalid-base64!')).toBe(
          false,
        );
      });
    });

    describe('generateMasterKey', () => {
      it('should generate valid master key', () => {
        const key = HkdfKeyProvider.generateMasterKey();

        expect(typeof key).toBe('string');
        expect(HkdfKeyProvider.validateMasterKey(key)).toBe(true);
      });

      it('should generate keys of specified length', () => {
        const key16 = HkdfKeyProvider.generateMasterKey(16);
        const key32 = HkdfKeyProvider.generateMasterKey(32);

        const buffer16 = Buffer.from(key16, 'base64');
        const buffer32 = Buffer.from(key32, 'base64');

        expect(buffer16.length).toBe(16);
        expect(buffer32.length).toBe(32);
      });

      it('should generate different keys each time', () => {
        const key1 = HkdfKeyProvider.generateMasterKey();
        const key2 = HkdfKeyProvider.generateMasterKey();

        expect(key1).not.toBe(key2);
      });
    });
  });

  describe('cryptographic properties', () => {
    it('should produce keys that look random', async () => {
      const key = await provider.getKey(organizationId, 'v1');

      // Basic entropy check - no repeated bytes
      const bytes = Array.from(key);
      const uniqueBytes = new Set(bytes);

      // At least 16 different byte values in a 32-byte key
      expect(uniqueBytes.size).toBeGreaterThan(16);
    });

    it('should be deterministic across provider instances', async () => {
      const provider1 = new HkdfKeyProvider({ masterKey });
      const provider2 = new HkdfKeyProvider({ masterKey });

      const key1 = await provider1.getKey(organizationId, 'v1');
      const key2 = await provider2.getKey(organizationId, 'v1');

      expect(key1).toEqual(key2);
    });
  });
});
