import { KeyProviderFactory } from '../key-provider.factory';
import { HkdfKeyProvider } from '../hkdf-key-provider';
import { MigrationKeyProvider } from '../migration-key-provider';

describe('KeyProviderFactory', () => {
  let factory: KeyProviderFactory;

  beforeEach(() => {
    factory = new KeyProviderFactory();
  });

  describe('createKeyProvider', () => {
    describe('HKDF provider', () => {
      it('should create HKDF provider with valid config', () => {
        const config = {
          type: 'hkdf' as const,
          config: {
            masterKey: HkdfKeyProvider.generateMasterKey(),
            currentVersion: 'v1',
          },
        };

        const provider = factory.createKeyProvider(config);

        expect(provider).toBeInstanceOf(HkdfKeyProvider);
        expect(provider.getProviderType()).toBe('hkdf');
        expect(provider.getCurrentVersion()).toBe('v1');
      });

      it('should throw error with missing master key', () => {
        const config = {
          type: 'hkdf' as const,
          config: {},
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'HKDF provider requires masterKey (string)',
        );
      });

      it('should throw error with invalid master key type', () => {
        const config = {
          type: 'hkdf' as const,
          config: {
            masterKey: 123, // Invalid type
          },
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'HKDF provider requires masterKey (string)',
        );
      });

      it('should use default values for optional config', () => {
        const config = {
          type: 'hkdf' as const,
          config: {
            masterKey: HkdfKeyProvider.generateMasterKey(),
          },
        };

        const provider = factory.createKeyProvider(config);

        expect(provider.getCurrentVersion()).toBe('v1'); // Default version
      });
    });

    describe('Migration provider', () => {
      it('should create migration provider with valid config', () => {
        const config = {
          type: 'migration' as const,
          config: {
            oldProvider: {
              type: 'hkdf' as const,
              config: {
                masterKey: HkdfKeyProvider.generateMasterKey(),
                currentVersion: 'v1',
              },
            },
            newProvider: {
              type: 'hkdf' as const,
              config: {
                masterKey: HkdfKeyProvider.generateMasterKey(),
                currentVersion: 'v2',
              },
            },
          },
        };

        const provider = factory.createKeyProvider(config);

        expect(provider).toBeInstanceOf(MigrationKeyProvider);
        expect(provider.getProviderType()).toBe('migration(hkdf->hkdf)');
      });

      it('should throw error with missing old provider', () => {
        const config = {
          type: 'migration' as const,
          config: {
            newProvider: {
              type: 'hkdf' as const,
              config: {
                masterKey: HkdfKeyProvider.generateMasterKey(),
              },
            },
          },
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'Migration provider requires oldProvider and newProvider configs',
        );
      });

      it('should throw error with missing new provider', () => {
        const config = {
          type: 'migration' as const,
          config: {
            oldProvider: {
              type: 'hkdf' as const,
              config: {
                masterKey: HkdfKeyProvider.generateMasterKey(),
              },
            },
          },
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'Migration provider requires oldProvider and newProvider configs',
        );
      });
    });

    describe('Unsupported providers', () => {
      it('should throw error for AWS KMS provider', () => {
        const config = {
          type: 'aws-kms' as const,
          config: {},
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'Provider type aws-kms not yet implemented',
        );
      });

      it('should throw error for Azure Key Vault provider', () => {
        const config = {
          type: 'azure-kv' as const,
          config: {},
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'Provider type azure-kv not yet implemented',
        );
      });

      it('should throw error for unknown provider type', () => {
        const config = {
          type: 'unknown' as any,
          config: {},
        };

        expect(() => factory.createKeyProvider(config)).toThrow(
          'Unknown key provider type: unknown',
        );
      });
    });
  });

  describe('createFromEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create HKDF provider from environment variables', () => {
      process.env.INTEGRATION_ENCRYPTION_KEY =
        HkdfKeyProvider.generateMasterKey();
      process.env.KEY_PROVIDER_TYPE = 'hkdf';
      process.env.KEY_VERSION = 'v2';

      const provider = factory.createFromEnvironment();

      expect(provider).toBeInstanceOf(HkdfKeyProvider);
      expect(provider.getCurrentVersion()).toBe('v2');
    });

    it('should use default provider type when not specified', () => {
      process.env.INTEGRATION_ENCRYPTION_KEY =
        HkdfKeyProvider.generateMasterKey();
      delete process.env.KEY_PROVIDER_TYPE;

      const provider = factory.createFromEnvironment();

      expect(provider).toBeInstanceOf(HkdfKeyProvider);
      expect(provider.getProviderType()).toBe('hkdf');
    });

    it('should use default version when not specified', () => {
      process.env.INTEGRATION_ENCRYPTION_KEY =
        HkdfKeyProvider.generateMasterKey();
      delete process.env.KEY_VERSION;

      const provider = factory.createFromEnvironment();

      expect(provider.getCurrentVersion()).toBe('v1');
    });

    it('should throw error when INTEGRATION_ENCRYPTION_KEY is missing', () => {
      delete process.env.INTEGRATION_ENCRYPTION_KEY;

      expect(() => factory.createFromEnvironment()).toThrow(
        'INTEGRATION_ENCRYPTION_KEY environment variable is required',
      );
    });

    it('should throw error when INTEGRATION_ENCRYPTION_KEY is empty', () => {
      process.env.INTEGRATION_ENCRYPTION_KEY = '';

      expect(() => factory.createFromEnvironment()).toThrow(
        'INTEGRATION_ENCRYPTION_KEY environment variable is required',
      );
    });

    it('should handle invalid provider type in environment', () => {
      process.env.INTEGRATION_ENCRYPTION_KEY =
        HkdfKeyProvider.generateMasterKey();
      process.env.KEY_PROVIDER_TYPE = 'invalid';

      expect(() => factory.createFromEnvironment()).toThrow(
        'Unknown key provider type: invalid',
      );
    });
  });

  describe('factory integration', () => {
    it('should create working providers', async () => {
      const config = {
        type: 'hkdf' as const,
        config: {
          masterKey: HkdfKeyProvider.generateMasterKey(),
        },
      };

      const provider = factory.createKeyProvider(config);
      const key = await provider.getKey('org-123' as any);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should create nested migration providers', () => {
      const config = {
        type: 'migration' as const,
        config: {
          oldProvider: {
            type: 'hkdf' as const,
            config: {
              masterKey: HkdfKeyProvider.generateMasterKey(),
              currentVersion: 'v1',
            },
          },
          newProvider: {
            type: 'migration' as const,
            config: {
              oldProvider: {
                type: 'hkdf' as const,
                config: {
                  masterKey: HkdfKeyProvider.generateMasterKey(),
                  currentVersion: 'v2',
                },
              },
              newProvider: {
                type: 'hkdf' as const,
                config: {
                  masterKey: HkdfKeyProvider.generateMasterKey(),
                  currentVersion: 'v3',
                },
              },
            },
          },
        },
      };

      const provider = factory.createKeyProvider(config);

      expect(provider).toBeInstanceOf(MigrationKeyProvider);
      expect(provider.getProviderType()).toBe(
        'migration(hkdf->migration(hkdf->hkdf))',
      );
    });
  });
});
