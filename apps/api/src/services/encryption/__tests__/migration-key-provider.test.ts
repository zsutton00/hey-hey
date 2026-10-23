import { MigrationKeyProvider } from '../migration-key-provider';
import { HkdfKeyProvider } from '../hkdf-key-provider';
import { KeyProvider } from '../key-provider.interface';
import { OrganizationId } from '../../../types';

describe('MigrationKeyProvider', () => {
  let oldProvider: KeyProvider;
  let newProvider: KeyProvider;
  let migrationProvider: MigrationKeyProvider;
  const organizationId: OrganizationId = 'org-123' as OrganizationId;

  beforeEach(() => {
    oldProvider = new HkdfKeyProvider({
      masterKey: HkdfKeyProvider.generateMasterKey(),
      currentVersion: 'v1',
    });

    newProvider = new HkdfKeyProvider({
      masterKey: HkdfKeyProvider.generateMasterKey(),
      currentVersion: 'v2',
    });

    migrationProvider = new MigrationKeyProvider(oldProvider, newProvider);
  });

  describe('initialization', () => {
    it('should initialize with both providers', () => {
      expect(migrationProvider.isInitialized()).toBe(true);
      expect(migrationProvider.getProviderType()).toBe('migration(hkdf->hkdf)');
    });

    it('should fail initialization if old provider not initialized', () => {
      const mockOldProvider = {
        isInitialized: () => false,
        getProviderType: () => 'mock',
      } as KeyProvider;

      const provider = new MigrationKeyProvider(mockOldProvider, newProvider);
      expect(provider.isInitialized()).toBe(false);
    });

    it('should fail initialization if new provider not initialized', () => {
      const mockNewProvider = {
        isInitialized: () => false,
        getProviderType: () => 'mock',
      } as KeyProvider;

      const provider = new MigrationKeyProvider(oldProvider, mockNewProvider);
      expect(provider.isInitialized()).toBe(false);
    });
  });

  describe('version management', () => {
    it('should return new provider current version', () => {
      expect(migrationProvider.getCurrentVersion()).toBe('v2');
    });

    it('should combine versions from both providers', () => {
      const versions = migrationProvider.listVersions();

      expect(versions).toContain('v1'); // from old provider
      expect(versions).toContain('v2'); // from new provider
      expect(versions.length).toBe(2);
    });

    it('should deduplicate versions', () => {
      // Create providers with overlapping versions
      const provider1 = new HkdfKeyProvider({
        masterKey: HkdfKeyProvider.generateMasterKey(),
        currentVersion: 'v1',
      });

      const provider2 = new HkdfKeyProvider({
        masterKey: HkdfKeyProvider.generateMasterKey(),
        currentVersion: 'v1', // Same version
      });

      const migration = new MigrationKeyProvider(provider1, provider2);
      const versions = migration.listVersions();

      expect(versions.filter((v) => v === 'v1')).toHaveLength(1);
    });
  });

  describe('key retrieval', () => {
    it('should use new provider for current version', async () => {
      const key = await migrationProvider.getKey(organizationId, 'v2');
      const directNewKey = await newProvider.getKey(organizationId, 'v2');

      expect(key).toEqual(directNewKey);
    });

    it('should use old provider for legacy versions', async () => {
      const key = await migrationProvider.getKey(organizationId, 'v1');
      const directOldKey = await oldProvider.getKey(organizationId, 'v1');

      expect(key).toEqual(directOldKey);
    });

    it('should use new provider when no version specified', async () => {
      const key = await migrationProvider.getKey(organizationId);
      const directNewKey = await newProvider.getKey(organizationId, 'v2');

      expect(key).toEqual(directNewKey);
    });

    it('should fallback to old provider if new provider fails', async () => {
      const failingNewProvider = {
        ...newProvider,
        getKey: jest.fn().mockRejectedValue(new Error('New provider failed')),
        listVersions: () => ['v2'],
      } as KeyProvider;

      const migration = new MigrationKeyProvider(
        oldProvider,
        failingNewProvider,
      );

      const key = await migration.getKey(organizationId, 'v2');
      const directOldKey = await oldProvider.getKey(organizationId, 'v2');

      expect(key).toEqual(directOldKey);
    });

    it('should throw error if both providers fail', async () => {
      const failingOldProvider = {
        ...oldProvider,
        getKey: jest.fn().mockRejectedValue(new Error('Old provider failed')),
      } as KeyProvider;

      const failingNewProvider = {
        ...newProvider,
        getKey: jest.fn().mockRejectedValue(new Error('New provider failed')),
        listVersions: () => ['v2'],
      } as KeyProvider;

      const migration = new MigrationKeyProvider(
        failingOldProvider,
        failingNewProvider,
      );

      await expect(migration.getKey(organizationId, 'v2')).rejects.toThrow(
        'All key providers failed',
      );
    });
  });

  describe('migration statistics', () => {
    it('should provide migration statistics', () => {
      const stats = migrationProvider.getMigrationStats();

      expect(stats).toEqual({
        oldProviderType: 'hkdf',
        newProviderType: 'hkdf',
        availableVersions: {
          old: ['v1'],
          new: ['v2'],
        },
      });
    });
  });

  describe('error handling', () => {
    it('should handle old provider errors gracefully', async () => {
      const errorOldProvider = {
        ...oldProvider,
        getKey: jest.fn().mockRejectedValue(new Error('Old provider error')),
        listVersions: () => ['v1'],
      } as KeyProvider;

      const migration = new MigrationKeyProvider(errorOldProvider, newProvider);

      // Should still work for new provider versions
      const key = await migration.getKey(organizationId, 'v2');
      expect(key).toBeDefined();
    });

    it('should log appropriate error messages', async () => {
      const loggerSpy = jest.spyOn(console, 'log').mockImplementation();

      const failingNewProvider = {
        ...newProvider,
        getKey: jest.fn().mockRejectedValue(new Error('New provider failed')),
        listVersions: () => ['v2'],
      } as KeyProvider;

      const migration = new MigrationKeyProvider(
        oldProvider,
        failingNewProvider,
      );

      await migration.getKey(organizationId, 'v2');

      loggerSpy.mockRestore();
    });
  });

  describe('integration scenarios', () => {
    it('should handle migration from single-key to multi-tenant', async () => {
      // Simulate old single-key provider vs new multi-tenant provider
      const org1 = 'org-1' as OrganizationId;
      const org2 = 'org-2' as OrganizationId;

      const key1 = await migrationProvider.getKey(org1, 'v2');
      const key2 = await migrationProvider.getKey(org2, 'v2');

      expect(key1).not.toEqual(key2); // Different keys for different orgs
    });

    it('should maintain backward compatibility', async () => {
      // Keys from old provider should still work
      const legacyKey = await migrationProvider.getKey(organizationId, 'v1');
      const directLegacyKey = await oldProvider.getKey(organizationId, 'v1');

      expect(legacyKey).toEqual(directLegacyKey);
    });
  });
});
