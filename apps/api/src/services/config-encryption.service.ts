import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { IntegrationType } from '../generated';
import { OrganizationId } from '../types';
import { KeyProviderFactory } from './encryption/key-provider.factory';
import {
  DecryptionInput,
  EncryptedData,
  KeyProvider,
} from './encryption/key-provider.interface';

// Legacy interface for backward compatibility
export interface EncryptionResult {
  encrypted: string;
  iv: string;
  tag: string;
}

// Legacy interface for backward compatibility
export interface LegacyDecryptionInput {
  encrypted: string;
  iv: string;
  tag: string;
}

// Define which fields should be encrypted for each integration type
const SENSITIVE_FIELDS_MAP: Record<IntegrationType, string[]> = {
  GITHUB: ['token', 'refreshToken', 'privateKey', 'webhookSecret'],
  SLACK: ['botToken', 'userToken', 'signingSecret', 'clientSecret'],
  TEAMS: ['clientSecret', 'webhookSecret'],
  JIRA: ['apiToken', 'password', 'webhookSecret'],
  CONFLUENCE: ['apiToken', 'password'],
  LINEAR: ['apiKey', 'webhookSecret'],
  NOTION: ['token', 'clientSecret'],
  FIGMA: ['token', 'webhookSecret'],
  ASANA: ['token', 'clientSecret'],
  TRELLO: ['token', 'key', 'webhookSecret'],
  DISCORD: ['botToken', 'clientSecret', 'webhookSecret'],
  WEBHOOK: ['secret', 'authToken', 'apiKey'],
};

@Injectable()
export class ConfigEncryptionService {
  private readonly logger = new Logger(ConfigEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  // TODO: GCM recommends a 96-bit (12 byte) IV to avoid the extra GHASH step and to minimise nonce-reuse risk.?
  private readonly ivLength = 16; // 128 bits
  private readonly keyProvider: KeyProvider;

  constructor(private readonly keyProviderFactory: KeyProviderFactory) {
    this.keyProvider = this.keyProviderFactory.createFromEnvironment();
    this.logger.log(
      `Initialized with ${this.keyProvider.getProviderType()} key provider`,
    );
  }

  /**
   * Get the list of sensitive fields for a given integration type
   */
  getSensitiveFields(integrationType: IntegrationType): string[] {
    return SENSITIVE_FIELDS_MAP[integrationType] || [];
  }

  /**
   * Encrypt sensitive fields in an integration config object
   */
  async encryptConfig(
    config: object,
    integrationType: IntegrationType,
    organizationId: OrganizationId,
  ): Promise<object> {
    if (!config || typeof config !== 'object') {
      return config;
    }

    const sensitiveFields = this.getSensitiveFields(integrationType);
    const encryptedConfig: Record<
      string,
      | string
      | {
          _encrypted: boolean;
          keyVersion?: string;
          algorithm?: string;
          iv: string;
          tag: string;
          data: string;
        }
    > = { ...config };

    for (const field of sensitiveFields) {
      if (
        encryptedConfig[field] &&
        typeof encryptedConfig[field] === 'string'
      ) {
        try {
          const encrypted = await this.encrypt(
            encryptedConfig[field],
            organizationId,
          );
          encryptedConfig[field] = {
            _encrypted: true,
            ...encrypted.metadata,
            data: encrypted.encrypted,
          };
        } catch (error) {
          this.logger.error(`Failed to encrypt field`, error);
          throw new Error(`Failed to encrypt sensitive field: ${field}`);
        }
      }
    }

    return encryptedConfig;
  }

  /**
   * Decrypt sensitive fields in an integration config object
   */
  async decryptConfig(
    config: object,
    integrationType: IntegrationType,
    organizationId: OrganizationId,
  ): Promise<object> {
    if (!config || typeof config !== 'object') {
      return config;
    }

    const sensitiveFields = this.getSensitiveFields(integrationType);
    const decryptedConfig: Record<
      string,
      | string
      | {
          _encrypted: boolean;
          data: string;
          keyVersion?: string;
          algorithm?: string;
          iv: string;
          tag: string;
        }
    > = { ...config };

    for (const field of sensitiveFields) {
      const fieldValue = decryptedConfig[field];

      if (
        fieldValue &&
        typeof fieldValue === 'object' &&
        fieldValue._encrypted
      ) {
        try {
          const decrypted = await this.decrypt(
            {
              encrypted: fieldValue.data,
              metadata: {
                keyVersion: fieldValue.keyVersion || 'v1',
                algorithm: fieldValue.algorithm || this.algorithm,
                iv: fieldValue.iv,
                tag: fieldValue.tag,
              },
            },
            organizationId,
          );

          decryptedConfig[field] = decrypted;
          this.logger.debug(
            `Decrypted field: ${field} for integration type: ${integrationType}, org: ${organizationId}`,
          );
        } catch (error) {
          this.logger.error(`Failed to decrypt field ${field}:`, error);
          throw new Error(`Failed to decrypt sensitive field: ${field}`);
        }
      }
    }

    return decryptedConfig;
  }

  /**
   * Mask sensitive fields in config for API responses
   */
  maskConfigForResponse(
    config: object,
    integrationType: IntegrationType,
  ): object {
    if (!config || typeof config !== 'object') {
      return config;
    }

    const sensitiveFields = this.getSensitiveFields(integrationType);
    const maskedConfig: Record<string, string | object> = { ...config };

    sensitiveFields.forEach((field) => {
      if (maskedConfig[field]) {
        maskedConfig[field] = '***MASKED***';
      }
    });

    return maskedConfig;
  }

  /**
   * Encrypt a string value using AES-256-GCM with organization-specific key
   */
  private async encrypt(
    text: string,
    organizationId: OrganizationId,
  ): Promise<EncryptedData> {
    try {
      const keyVersion = this.keyProvider.getCurrentVersion();
      const encryptionKey = await this.keyProvider.getKey(
        organizationId,
        keyVersion,
      );

      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, encryptionKey, iv);

      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      const tag = cipher.getAuthTag();

      return {
        encrypted,
        metadata: {
          keyVersion,
          algorithm: this.algorithm,
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
        },
      };
    } catch (error) {
      this.logger.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt a string value using AES-256-GCM with organization-specific key
   */
  private async decrypt(
    input: DecryptionInput,
    organizationId: OrganizationId,
  ): Promise<string> {
    try {
      const { keyVersion, algorithm, iv, tag } = input.metadata;
      const encryptionKey = await this.keyProvider.getKey(
        organizationId,
        keyVersion,
      );

      const ivBuffer = Buffer.from(iv, 'base64');
      const tagBuffer = Buffer.from(tag, 'base64');

      const decipher = crypto.createDecipheriv(
        algorithm,
        encryptionKey,
        ivBuffer,
      );
      (decipher as crypto.DecipherGCM).setAuthTag(tagBuffer);

      let decrypted = decipher.update(input.encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Check if a config object has encrypted fields
   */
  hasEncryptedFields(config: object): boolean {
    if (!config || typeof config !== 'object') {
      return false;
    }

    return Object.values(config).some(
      (value) =>
        value && typeof value === 'object' && value._encrypted === true,
    );
  }

  /**
   * Generate a new encryption key (for setup/testing purposes)
   */
  static generateKey(): string {
    const key = crypto.randomBytes(32);
    return key.toString('base64');
  }

  /**
   * Validate if a key is properly formatted
   */
  static validateKey(keyBase64: string): boolean {
    try {
      const key = Buffer.from(keyBase64, 'base64');
      return key.length >= 16; // At least 128 bits
    } catch {
      return false;
    }
  }

  /**
   * Get key provider information for debugging
   */
  getProviderInfo(): {
    type: string;
    currentVersion: string;
    availableVersions: string[];
    initialized: boolean;
  } {
    return {
      type: this.keyProvider.getProviderType(),
      currentVersion: this.keyProvider.getCurrentVersion(),
      availableVersions: this.keyProvider.listVersions(),
      initialized: this.keyProvider.isInitialized(),
    };
  }
}
