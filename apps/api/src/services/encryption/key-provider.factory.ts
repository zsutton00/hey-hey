import { Injectable, Logger } from '@nestjs/common';
import { KeyProvider, KeyProviderConfig } from './key-provider.interface';
import { HkdfKeyProvider } from './hkdf-key-provider';
import { MigrationKeyProvider } from './migration-key-provider';

@Injectable()
export class KeyProviderFactory {
  private readonly logger = new Logger(KeyProviderFactory.name);

  createKeyProvider(config: KeyProviderConfig): KeyProvider {
    this.logger.log(`Creating key provider of type: ${config.type}`);

    switch (config.type) {
      case 'hkdf':
        return this.createHkdfProvider(config.config);

      case 'migration':
        return this.createMigrationProvider(config.config);

      case 'aws-kms':
      case 'azure-kv':
        throw new Error(`Provider type ${config.type} not yet implemented`);

      default:
        throw new Error(`Unknown key provider type: ${config.type}`);
    }
  }

  private createHkdfProvider(config: Record<string, unknown>): HkdfKeyProvider {
    if (typeof config.masterKey !== 'string') {
      throw new Error('HKDF provider requires masterKey (string)');
    }

    return new HkdfKeyProvider({
      masterKey: config.masterKey,
      currentVersion: config.currentVersion as string,
      algorithm: config.algorithm as string,
      keyLength: config.keyLength as number,
    });
  }

  private createMigrationProvider(
    config: Record<string, unknown>,
  ): MigrationKeyProvider {
    const oldConfig = config.oldProvider as KeyProviderConfig;
    const newConfig = config.newProvider as KeyProviderConfig;

    if (!oldConfig || !newConfig) {
      throw new Error(
        'Migration provider requires oldProvider and newProvider configs',
      );
    }

    const oldProvider = this.createKeyProvider(oldConfig);
    const newProvider = this.createKeyProvider(newConfig);

    return new MigrationKeyProvider(oldProvider, newProvider);
  }

  /**
   * Create key provider from environment variables
   */
  createFromEnvironment(): KeyProvider {
    const providerType = process.env.KEY_PROVIDER_TYPE || 'hkdf';
    const masterKey = process.env.INTEGRATION_ENCRYPTION_KEY;

    if (!masterKey) {
      throw new Error(
        'INTEGRATION_ENCRYPTION_KEY environment variable is required',
      );
    }

    if (!['hkdf', 'aws-kms', 'azure-kv', 'migration'].includes(providerType)) {
      throw new Error(`Unknown key provider type: ${providerType}`);
    }

    const config: KeyProviderConfig = {
      type: providerType as 'hkdf' | 'aws-kms' | 'azure-kv' | 'migration',
      config: {
        masterKey,
        currentVersion: process.env.KEY_VERSION || 'v1',
      },
    };

    return this.createKeyProvider(config);
  }
}
