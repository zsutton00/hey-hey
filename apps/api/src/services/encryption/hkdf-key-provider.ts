import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { KeyProvider } from './key-provider.interface';
import { OrganizationId } from '../../types';

export interface HkdfKeyProviderConfig {
  masterKey: string; // Base64 encoded master key
  currentVersion?: string;
  algorithm?: string;
  keyLength?: number;
}

@Injectable()
export class HkdfKeyProvider implements KeyProvider {
  private readonly logger = new Logger(HkdfKeyProvider.name);
  private masterKey: Buffer;
  private readonly currentVersion: string;
  private readonly algorithm = 'sha256';
  private readonly keyLength = 32; // 256 bits
  private readonly info = 'hey-hey-integration-encryption';
  private initialized = false;

  constructor(private readonly config: HkdfKeyProviderConfig) {
    this.currentVersion = config.currentVersion || 'v1';
    this.masterKey = this.initializeProvider();
  }

  private initializeProvider(): Buffer {
    try {
      if (!this.config.masterKey) {
        throw new Error('Master key is required for HKDF provider');
      }

      const masterKey = Buffer.from(this.config.masterKey, 'base64');

      if (masterKey.length < 16) {
        throw new Error('Master key must be at least 128 bits (16 bytes)');
      }

      this.initialized = true;
      this.logger.log('HKDF key provider initialized successfully');
      return masterKey;
    } catch (error) {
      this.logger.error('Failed to initialize HKDF key provider:', error);
      if (
        error instanceof Error &&
        (error.message.includes('Master key is required') ||
          error.message.includes('Master key must be'))
      ) {
        throw error;
      }
      throw new Error('Failed to initialize HKDF key provider');
    }
  }

  async getKey(
    organizationId: OrganizationId,
    version = this.currentVersion,
  ): Promise<Buffer> {
    if (!this.initialized) {
      throw new Error('HKDF key provider not initialized');
    }

    try {
      // Create unique salt for this organization and version
      const salt = this.createSalt(organizationId, version);

      // Derive key using HKDF
      const derivedKey = crypto.hkdfSync(
        this.algorithm,
        this.masterKey,
        salt,
        Buffer.from(`${this.info}-${version}`, 'utf8'),
        this.keyLength,
      );

      this.logger.debug(
        `Derived key for organization ${organizationId} version ${version}`,
      );

      return Buffer.from(derivedKey);
    } catch (error) {
      this.logger.error(
        `Failed to derive key for organization ${organizationId}:`,
        error,
      );
      throw new Error('Key derivation failed');
    }
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  listVersions(): string[] {
    // For HKDF, we support any version string
    // In practice, you might want to maintain a list of valid versions
    return [this.currentVersion];
  }

  getProviderType(): string {
    return 'hkdf';
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private createSalt(organizationId: OrganizationId, version: string): Buffer {
    // Create deterministic but unique salt for each organization/version combination
    const saltInput = `${organizationId}-${version}`;
    return crypto.createHash('sha256').update(saltInput).digest();
  }

  /**
   * Validate master key format
   */
  static validateMasterKey(masterKeyBase64: string): boolean {
    try {
      const key = Buffer.from(masterKeyBase64, 'base64');
      return key.length >= 16; // At least 128 bits
    } catch {
      return false;
    }
  }

  /**
   * Generate a new master key for setup
   */
  static generateMasterKey(length = 32): string {
    const key = crypto.randomBytes(length);
    return key.toString('base64');
  }
}
