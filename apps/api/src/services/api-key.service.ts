import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { ApiKeyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ApiKeyId, OrganizationId, UserId } from '../types';

export interface CreateApiKeyOptions {
  organizationId: OrganizationId;
  createdBy: UserId;
  name: string;
  description?: string;
  keyType?: ApiKeyType;
  serviceType?: string;
  scopes: string[];
  expiresAt?: Date;
  keyValue?: string; // Optional specific key value (for storing environment keys)
}

export interface ApiKeyWithSecret {
  id: ApiKeyId;
  key: string; // Only returned on creation
  prefix: string;
  name: string;
  description?: string;
  keyType: ApiKeyType;
  serviceType?: string;
  scopes: string[];
  expiresAt?: Date;
  createdAt: Date;
  isActive: boolean;
}

export interface ApiKeyInfo {
  id: ApiKeyId;
  prefix: string;
  name: string;
  description?: string;
  keyType: ApiKeyType;
  serviceType?: string;
  scopes: string[];
  lastUsedAt?: Date;
  lastUsedIp?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  createdBy: UserId;
}

export interface ValidatedApiKey {
  id: ApiKeyId;
  organizationId: OrganizationId;
  keyType: ApiKeyType;
  serviceType?: string;
  scopes: string[];
  name: string;
  createdBy: UserId;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly environment: string;
  private readonly saltRounds = 12;
  private readonly organizationApiKeyCache = new Map<
    OrganizationId,
    string | null
  >();
  private readonly organizationApiKeyCacheExpiry = new Map<
    OrganizationId,
    number
  >();
  private readonly ORGANIZATION_API_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.environment = this.configService.get<string>(
      'NODE_ENV',
      'development',
    );
  }

  /**
   * Generate a secure API key with proper format
   * Format: hh_[env]_[32-byte-base64]
   */
  private generateApiKey(): { key: string; prefix: string } {
    const randomBytes = crypto.randomBytes(32);
    const randomPart = randomBytes.toString('base64url'); // URL-safe base64
    const envPrefix = this.environment === 'production' ? 'prod' : 'dev';

    const key = `hh_${envPrefix}_${randomPart}`;
    const prefix = key.substring(0, 12); // e.g., "hh_prod_xyz1"

    return { key, prefix };
  }

  /**
   * Hash an API key for secure storage
   */
  private async hashApiKey(key: string): Promise<string> {
    return bcrypt.hash(key, this.saltRounds);
  }

  /**
   * Encrypt an API key for retrievable storage (used for service keys)
   */
  private encryptApiKey(key: string): string {
    // Simple encryption using crypto - in production, use proper key management
    const algorithm = 'aes-256-cbc';
    const secretKey = crypto.scryptSync(
      this.configService.get<string>('SECRET_KEY', 'fallback-secret'),
      'salt',
      32,
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);

    let encrypted = cipher.update(key, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Combine IV and encrypted data
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt an API key from storage
   */
  private decryptApiKey(encryptedKey: string): string {
    try {
      const algorithm = 'aes-256-cbc';
      const secretKey = crypto.scryptSync(
        this.configService.get<string>('SECRET_KEY', 'fallback-secret'),
        'salt',
        32,
      );

      // Validate encrypted key format
      if (!encryptedKey || !encryptedKey.includes(':')) {
        throw new Error('Invalid encrypted key format: missing IV separator');
      }

      const [ivHex, encrypted] = encryptedKey.split(':');

      // Validate IV and encrypted data
      if (!ivHex || !encrypted) {
        throw new Error(
          'Invalid encrypted key format: missing IV or encrypted data',
        );
      }

      // Validate IV length (should be 32 hex characters = 16 bytes)
      if (ivHex.length !== 32) {
        throw new Error(
          `Invalid IV length: expected 32 hex characters, got ${ivHex.length}`,
        );
      }

      // Validate hex format
      if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(encrypted)) {
        throw new Error(
          'Invalid encrypted key format: non-hex characters detected',
        );
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      // Wrap crypto errors with more context
      if (error instanceof Error) {
        throw new Error(`Decryption failed: ${error.message}`);
      }
      throw new Error('Decryption failed: unknown error');
    }
  }

  /**
   * Verify an API key against its hash
   */
  private async verifyApiKey(key: string, hash: string): Promise<boolean> {
    return bcrypt.compare(key, hash);
  }

  /**
   * Validate API key scopes
   */
  private validateScopes(scopes: string[]): void {
    const validScopes = [
      // Project access
      'read:projects',
      'write:projects',
      // Initiative access
      'read:initiatives',
      'write:initiatives',
      // Conversation access
      'read:conversations',
      'write:conversations',
      // Message access
      'read:messages',
      'write:messages',
      // Artifact access
      'read:artifacts',
      'write:artifacts',
      // Task access
      'read:tasks',
      'write:tasks',
      // Tag access
      'read:tags',
      'write:tags',
      // Organization member access
      'read:members',
      // Agent execution and callbacks
      'agent:execute',
      'callback:results',
      // Administrative scopes
      'admin:org',
      'admin:workflows',
    ];

    const invalidScopes = scopes.filter(
      (scope) => !validScopes.includes(scope),
    );
    if (invalidScopes.length > 0) {
      throw new BadRequestException(
        `Invalid scopes: ${invalidScopes.join(', ')}`,
      );
    }
  }

  /**
   * Create a new API key
   */
  async createApiKey(options: CreateApiKeyOptions): Promise<ApiKeyWithSecret> {
    const {
      organizationId,
      createdBy,
      name,
      description,
      keyType = ApiKeyType.INTERNAL,
      serviceType,
      scopes,
      expiresAt,
      keyValue,
    } = options;

    // Validate scopes
    this.validateScopes(scopes);

    // Use provided key value or generate new one
    const { key, prefix } = keyValue
      ? { key: keyValue, prefix: keyValue.substring(0, 12) }
      : this.generateApiKey();

    // For Mastra keys, we need to encrypt (not hash) so we can retrieve them
    const keyHash =
      keyType === ApiKeyType.MASTRA_AI && serviceType === 'agent-service'
        ? this.encryptApiKey(key)
        : await this.hashApiKey(key);

    try {
      const apiKey = await this.prisma.db.apiKey.create({
        data: {
          organizationId,
          createdBy,
          name,
          description,
          keyHash,
          prefix,
          keyType,
          serviceType,
          scopes,
          expiresAt,
          isActive: true,
        },
      });

      this.logger.log(
        `Created ${keyType} API key ${apiKey.id} for organization ${organizationId}${serviceType ? ` (service: ${serviceType})` : ''}`,
      );

      return {
        id: apiKey.id,
        key, // Only returned here, never stored or returned again
        prefix: apiKey.prefix,
        name: apiKey.name,
        description: apiKey.description || undefined,
        keyType: apiKey.keyType,
        serviceType: apiKey.serviceType || undefined,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt || undefined,
        createdAt: apiKey.createdAt,
        isActive: apiKey.isActive,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create API key: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new BadRequestException('Failed to create API key');
    }
  }

  /**
   * Validate an API key and return its information
   */
  async validateApiKey(
    key: string,
    clientIp?: string,
  ): Promise<ValidatedApiKey> {
    this.logger.debug(
      `[ApiKeyService] Starting validation for key: ${key.substring(0, 10)}...`,
    );

    if (!key || !key.startsWith('hh_')) {
      this.logger.warn(
        `[ApiKeyService] Invalid key format: ${key.substring(0, 10)}...`,
      );
      throw new BadRequestException('Invalid API key format');
    }

    const prefix = key.substring(0, 12);
    this.logger.debug(`[ApiKeyService] Looking up key by prefix: ${prefix}`);

    try {
      // Find API key by prefix first (indexed lookup)
      const apiKey = await this.prisma.db.apiKey.findFirst({
        where: {
          prefix,
          isActive: true,
        },
      });

      if (!apiKey) {
        this.logger.warn(
          `[ApiKeyService] API key validation failed: key not found for prefix ${prefix}`,
        );
        throw new BadRequestException('Invalid API key');
      }

      this.logger.debug(
        `[ApiKeyService] Found API key: ${apiKey.id} for org ${apiKey.organizationId}`,
      );

      // Check expiration
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        this.logger.warn(`API key validation failed: expired key ${apiKey.id}`);
        throw new BadRequestException('API key has expired');
      }

      // Verify the hash/encrypted key
      this.logger.debug(`[ApiKeyService] Verifying key for ${apiKey.id}`);
      let isValid = false;

      if (
        apiKey.keyType === ApiKeyType.MASTRA_AI &&
        apiKey.serviceType === 'agent-service'
      ) {
        // For Mastra keys, decrypt and compare
        try {
          const decryptedKey = this.decryptApiKey(apiKey.keyHash);
          isValid = decryptedKey === key;
        } catch (error) {
          this.logger.warn(
            `Failed to decrypt key for validation: ${(error as Error).message}`,
          );
          isValid = false;
        }
      } else {
        // For regular keys, use hash comparison
        isValid = await this.verifyApiKey(key, apiKey.keyHash);
      }

      if (!isValid) {
        this.logger.warn(
          `[ApiKeyService] API key validation failed: key mismatch for ${apiKey.id}`,
        );
        throw new BadRequestException('Invalid API key');
      }

      // Update last used information
      this.logger.debug(`[ApiKeyService] Updating last used for ${apiKey.id}`);
      await this.updateLastUsed(apiKey.id, clientIp);

      this.logger.log(
        `[ApiKeyService] ✅ API key validated successfully: ${apiKey.id} for org ${apiKey.organizationId}`,
      );

      return {
        id: apiKey.id,
        organizationId: apiKey.organizationId,
        keyType: apiKey.keyType,
        serviceType: apiKey.serviceType || undefined,
        scopes: apiKey.scopes,
        name: apiKey.name,
        createdBy: apiKey.createdBy,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `API key validation error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new BadRequestException('API key validation failed');
    }
  }

  /**
   * Update last used information for an API key
   */
  private async updateLastUsed(
    keyId: ApiKeyId,
    clientIp?: string,
  ): Promise<void> {
    try {
      await this.prisma.db.apiKey.update({
        where: { id: keyId },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: clientIp || null,
        },
      });
    } catch (error) {
      // Don't throw, just log - this is not critical
      this.logger.warn(
        `Failed to update last used info for API key ${keyId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get all API keys for an organization (without secrets)
   */
  async getApiKeys(organizationId: OrganizationId): Promise<ApiKeyInfo[]> {
    const apiKeys = await this.prisma.db.apiKey.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return (apiKeys as any[]).map((key) => ({
      id: key.id,
      prefix: key.prefix,
      name: key.name,
      description: key.description || undefined,
      keyType: key.keyType,
      serviceType: key.serviceType || undefined,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt || undefined,
      lastUsedIp: key.lastUsedIp || undefined,
      expiresAt: key.expiresAt || undefined,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      isActive: key.isActive,
      createdBy: key.createdBy,
    }));
  }

  /**
   * Get a specific API key by ID (without secret)
   */
  async getApiKeyById(
    keyId: ApiKeyId,
    organizationId: OrganizationId,
  ): Promise<ApiKeyInfo> {
    const apiKey = await this.prisma.db.apiKey.findFirst({
      where: {
        id: keyId,
        organizationId,
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return {
      id: apiKey.id,
      prefix: apiKey.prefix,
      name: apiKey.name,
      description: apiKey.description || undefined,
      keyType: apiKey.keyType,
      serviceType: apiKey.serviceType || undefined,
      scopes: apiKey.scopes,
      lastUsedAt: apiKey.lastUsedAt || undefined,
      lastUsedIp: apiKey.lastUsedIp || undefined,
      expiresAt: apiKey.expiresAt || undefined,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
      isActive: apiKey.isActive,
      createdBy: apiKey.createdBy,
    };
  }

  /**
   * Update an API key
   */
  async updateApiKey(
    keyId: ApiKeyId,
    organizationId: OrganizationId,
    updates: {
      name?: string;
      description?: string;
      scopes?: string[];
      isActive?: boolean;
      expiresAt?: Date;
    },
  ): Promise<ApiKeyInfo> {
    if (updates.scopes) {
      this.validateScopes(updates.scopes);
    }

    try {
      const apiKey = await this.prisma.db.apiKey.update({
        where: {
          id: keyId,
          organizationId,
        },
        data: updates,
      });

      this.logger.log(
        `Updated API key ${keyId} for organization ${organizationId}`,
      );

      return {
        id: apiKey.id,
        prefix: apiKey.prefix,
        name: apiKey.name,
        description: apiKey.description || undefined,
        keyType: apiKey.keyType,
        serviceType: apiKey.serviceType || undefined,
        scopes: apiKey.scopes,
        lastUsedAt: apiKey.lastUsedAt || undefined,
        lastUsedIp: apiKey.lastUsedIp || undefined,
        expiresAt: apiKey.expiresAt || undefined,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
        isActive: apiKey.isActive,
        createdBy: apiKey.createdBy,
      };
    } catch (error) {
      this.logger.error(
        `Failed to update API key ${keyId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new NotFoundException('API key not found or update failed');
    }
  }

  /**
   * Delete (revoke) an API key
   */
  async deleteApiKey(
    keyId: ApiKeyId,
    organizationId: OrganizationId,
  ): Promise<void> {
    try {
      await this.prisma.db.apiKey.delete({
        where: {
          id: keyId,
          organizationId,
        },
      });

      this.logger.log(
        `Deleted API key ${keyId} for organization ${organizationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete API key ${keyId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new NotFoundException('API key not found');
    }
  }

  /**
   * Rotate an API key (generate new key, same metadata)
   */
  async rotateApiKey(
    keyId: ApiKeyId,
    organizationId: OrganizationId,
  ): Promise<ApiKeyWithSecret> {
    // Verify the key exists before rotating
    await this.getApiKeyById(keyId, organizationId);

    // Generate new key
    const { key, prefix } = this.generateApiKey();
    const keyHash = await this.hashApiKey(key);

    try {
      const updatedKey = await this.prisma.db.apiKey.update({
        where: {
          id: keyId,
          organizationId,
        },
        data: {
          keyHash,
          prefix,
          lastUsedAt: null,
          lastUsedIp: null,
        },
      });

      this.logger.log(
        `Rotated API key ${keyId} for organization ${organizationId}`,
      );

      return {
        id: updatedKey.id,
        key, // New secret key
        prefix: updatedKey.prefix,
        name: updatedKey.name,
        description: updatedKey.description || undefined,
        keyType: updatedKey.keyType,
        serviceType: updatedKey.serviceType || undefined,
        scopes: updatedKey.scopes,
        expiresAt: updatedKey.expiresAt || undefined,
        createdAt: updatedKey.createdAt,
        isActive: updatedKey.isActive,
      };
    } catch (error) {
      this.logger.error(
        `Failed to rotate API key ${keyId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new NotFoundException('API key not found or rotation failed');
    }
  }

  /**
   * Create a Mastra.ai API key for an organization
   * Includes comprehensive scopes for agent service to access organizational data
   */
  async createOrganizationApiKey(
    organizationId: OrganizationId,
    createdBy: UserId,
  ): Promise<ApiKeyWithSecret> {
    return this.createApiKey({
      organizationId,
      createdBy,
      name: 'Agent Service API Key',
      description:
        'Auto-generated key for agent service data access and callbacks',
      keyType: ApiKeyType.MASTRA_AI,
      serviceType: 'agent-service',
      scopes: [
        // Core data access for agent processing
        'read:projects',
        'read:initiatives',
        'write:initiatives',
        'read:conversations',
        'read:messages',
        'write:messages',
        'read:artifacts',
        'write:artifacts',
        'read:tasks',
        'write:tasks',
        'read:tags',
        'read:members',
        // Agent-specific permissions
        'agent:execute',
        'callback:results',
      ],
    });
  }

  /**
   * Resolve and cache the Mastra.ai API key for an organization.
   * Attempts to fetch an existing key, creates one if missing, and caches the
   * result with a short TTL to limit database traffic.
   */
  async getOrganizationApiKey(
    organizationId: OrganizationId,
  ): Promise<string | null> {
    const cachedValue = this.organizationApiKeyCache.get(organizationId);
    const expiry = this.organizationApiKeyCacheExpiry.get(organizationId);

    if (cachedValue !== undefined && expiry && Date.now() < expiry) {
      return cachedValue;
    }

    try {
      let organizationApiKey = await this.getApiKey(organizationId);

      if (!organizationApiKey) {
        const createdKey = await this.createOrganizationApiKey(
          organizationId,
          'system' as UserId,
        );
        organizationApiKey = createdKey.key;
      }

      const resolvedKey = organizationApiKey ?? null;
      this.organizationApiKeyCache.set(organizationId, resolvedKey);
      this.organizationApiKeyCacheExpiry.set(
        organizationId,
        Date.now() + this.ORGANIZATION_API_KEY_CACHE_TTL_MS,
      );

      return resolvedKey;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to resolve Mastra API key', {
        organizationId,
        error: errorMessage,
      });
      this.organizationApiKeyCache.delete(organizationId);
      this.organizationApiKeyCacheExpiry.delete(organizationId);
      throw new Error(
        `Failed to resolve API key for organization ${organizationId}: ${errorMessage}`,
      );
    }
  }

  invalidateOrganizationApiKey(organizationId: OrganizationId): void {
    this.organizationApiKeyCache.delete(organizationId);
    this.organizationApiKeyCacheExpiry.delete(organizationId);
    this.logger.debug(
      `Invalidated Mastra API key cache for organization ${organizationId}`,
    );
  }

  clearOrganizationApiKeyCache(): void {
    this.organizationApiKeyCache.clear();
    this.organizationApiKeyCacheExpiry.clear();
    this.logger.log('Cleared Mastra API key cache');
  }

  /**
   * Get the Mastra.ai API key for an organization
   */
  async getApiKey(organizationId: OrganizationId): Promise<string | null> {
    try {
      const apiKey = await this.prisma.db.apiKey.findFirst({
        where: {
          organizationId,
          keyType: ApiKeyType.MASTRA_AI,
          serviceType: 'agent-service',
          isActive: true,
        },
      });

      if (!apiKey) {
        this.logger.warn(
          `No Mastra.ai API key found for organization ${organizationId}`,
        );
        return null;
      }

      // Decrypt the stored key and return it
      try {
        const decryptedKey = this.decryptApiKey(apiKey.keyHash);
        this.logger.debug(
          `Retrieved Mastra API key for organization ${organizationId}`,
        );
        return decryptedKey;
      } catch (decryptError) {
        this.logger.error(
          `Failed to decrypt Mastra API key for organization ${organizationId}: ${(decryptError as Error).message}`,
        );
        return null;
      }
    } catch (error) {
      this.logger.error(
        `Failed to retrieve Mastra.ai API key for organization ${organizationId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Check if an organization has a Mastra.ai API key
   */
  async hasMastraApiKey(organizationId: OrganizationId): Promise<boolean> {
    const count = await this.prisma.db.apiKey.count({
      where: {
        organizationId,
        keyType: ApiKeyType.MASTRA_AI,
        serviceType: 'agent-service',
        isActive: true,
      },
    });

    return count > 0;
  }

  async findOrganizationApiKey(
    organizationId: OrganizationId,
  ): Promise<{ id: ApiKeyId } | null> {
    const apiKey = await this.prisma.db.apiKey.findFirst({
      where: {
        organizationId,
        keyType: ApiKeyType.MASTRA_AI,
        serviceType: 'agent-service',
        isActive: true,
      },
      select: { id: true },
    });
    return apiKey ? { id: apiKey.id as ApiKeyId } : null;
  }

  /**
   * Extract API key from request headers or query parameters
   */
  extractApiKeyFromRequest(request: {
    headers?: Record<string, unknown>;
    url?: string;
  }): string | null {
    const headers = request.headers || {};

    // Check X-API-Key header (preferred)
    const headerKey = headers['x-api-key'];
    if (typeof headerKey === 'string') {
      return headerKey;
    }
    if (Array.isArray(headerKey) && headerKey.length > 0) {
      return headerKey[0];
    }

    // Check Authorization Bearer (if starts with hh_)
    const authHeader = headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token.startsWith('hh_')) {
        return token;
      }
    }

    // Last resort: query parameter
    if (request.url) {
      try {
        const url = new URL(request.url, 'http://localhost');
        const queryKey = url.searchParams.get('api_key');
        if (queryKey) {
          return queryKey;
        }
      } catch {
        // Ignore malformed URLs
      }
    }

    return null;
  }
}
