import { Injectable, Logger } from '@nestjs/common';
import { KeyProvider } from './key-provider.interface';
import { OrganizationId } from '../../types';

@Injectable()
export class MigrationKeyProvider implements KeyProvider {
  private readonly logger = new Logger(MigrationKeyProvider.name);

  constructor(
    private readonly oldProvider: KeyProvider,
    private readonly newProvider: KeyProvider,
  ) {}

  async getKey(
    organizationId: OrganizationId,
    version?: string,
  ): Promise<Buffer> {
    try {
      // Try new provider first for current operations
      if (!version || this.isNewVersion(version)) {
        return await this.newProvider.getKey(organizationId, version);
      }

      // Fall back to old provider for legacy versions
      return await this.oldProvider.getKey(organizationId, version);
    } catch (error) {
      this.logger.warn(
        `Failed to get key from primary provider for ${organizationId}, trying fallback:`,
        error,
      );

      // If new provider fails, try old provider as fallback
      try {
        return await this.oldProvider.getKey(organizationId, version);
      } catch (fallbackError) {
        this.logger.error(
          `Both providers failed for organization ${organizationId}:`,
          { primary: error, fallback: fallbackError },
        );
        throw new Error('All key providers failed');
      }
    }
  }

  getCurrentVersion(): string {
    return this.newProvider.getCurrentVersion();
  }

  listVersions(): string[] {
    const oldVersions = this.oldProvider.listVersions();
    const newVersions = this.newProvider.listVersions();

    // Combine and deduplicate versions
    return [...new Set([...oldVersions, ...newVersions])];
  }

  getProviderType(): string {
    return `migration(${this.oldProvider.getProviderType()}->${this.newProvider.getProviderType()})`;
  }

  isInitialized(): boolean {
    return this.oldProvider.isInitialized() && this.newProvider.isInitialized();
  }

  private isNewVersion(version: string): boolean {
    // Simple version comparison - you might want more sophisticated logic
    const newVersions = this.newProvider.listVersions();
    return newVersions.includes(version);
  }

  /**
   * Get migration statistics
   */
  getMigrationStats(): {
    oldProviderType: string;
    newProviderType: string;
    availableVersions: {
      old: string[];
      new: string[];
    };
  } {
    return {
      oldProviderType: this.oldProvider.getProviderType(),
      newProviderType: this.newProvider.getProviderType(),
      availableVersions: {
        old: this.oldProvider.listVersions(),
        new: this.newProvider.listVersions(),
      },
    };
  }
}
