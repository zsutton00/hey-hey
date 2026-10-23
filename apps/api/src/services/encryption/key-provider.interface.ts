import { OrganizationId } from '../../types';

export interface EncryptionMetadata {
  keyVersion: string;
  algorithm: string;
  iv: string;
  tag: string;
}

export interface EncryptedData {
  encrypted: string;
  metadata: EncryptionMetadata;
}

export interface DecryptionInput {
  encrypted: string;
  metadata: EncryptionMetadata;
}

export interface KeyProvider {
  /**
   * Get encryption key for a specific organization and version
   */
  getKey(organizationId: OrganizationId, version?: string): Promise<Buffer>;

  /**
   * Get the current/latest key version
   */
  getCurrentVersion(): string;

  /**
   * List all available key versions
   */
  listVersions(): string[];

  /**
   * Get provider type identifier
   */
  getProviderType(): string;

  /**
   * Check if provider is properly initialized
   */
  isInitialized(): boolean;
}

export interface KeyProviderConfig {
  type: 'hkdf' | 'aws-kms' | 'azure-kv' | 'migration';
  config: Record<string, unknown>;
}
