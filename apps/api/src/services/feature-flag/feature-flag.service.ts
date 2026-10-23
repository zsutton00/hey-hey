import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FeatureFlagType, FeatureFlagScope } from '@prisma/client';
import { OrganizationId, UserId, FeatureFlagId } from '../../types';
import { PrismaService } from '../../prisma/prisma.service';

export interface FeatureFlagContext {
  organizationId: OrganizationId;
  userId?: UserId;
  projectId?: string;
  conversationId?: string;
}

export interface CreateFeatureFlagDto {
  organizationId: OrganizationId;
  flagKey: string;
  name: string;
  description?: string;
  type: FeatureFlagType;
  scope: FeatureFlagScope;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateFeatureFlagDto {
  name?: string;
  description?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface FeatureFlagResponseDto {
  id: FeatureFlagId;
  organizationId: OrganizationId;
  flagKey: string;
  name: string;
  description: string | null;
  type: FeatureFlagType;
  scope: FeatureFlagScope;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly flagCache = new Map<string, FeatureFlagResponseDto>();
  private readonly cacheExpiryMs = 5 * 60 * 1000; // 5 minutes
  private readonly cacheTimestamps = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a feature flag is enabled for the given context
   */
  async isEnabled(
    flagKey: string,
    context: FeatureFlagContext,
  ): Promise<boolean> {
    try {
      this.logger.debug('[isEnabled] Checking feature flag', {
        flagKey,
        organizationId: context.organizationId,
        userId: context.userId,
      });

      const flag = await this.getFlag(flagKey, context.organizationId);

      if (!flag) {
        this.logger.debug(
          '[isEnabled] Feature flag not found, defaulting to false',
          {
            flagKey,
            organizationId: context.organizationId,
          },
        );
        return false;
      }

      if (!flag.enabled) {
        this.logger.debug('[isEnabled] Feature flag disabled', {
          flagKey,
          organizationId: context.organizationId,
        });
        return false;
      }

      // For now, we just return the enabled status
      // In the future, we could add more complex logic based on scope, user roles, etc.
      return true;
    } catch (error) {
      this.logger.error('[isEnabled] Error checking feature flag', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        flagKey,
        organizationId: context.organizationId,
      });
      // Default to false on error
      return false;
    }
  }

  /**
   * Get feature flag configuration for the given context
   */
  async getConfig<T extends Record<string, unknown>>(
    flagKey: string,
    context: FeatureFlagContext,
  ): Promise<T | null> {
    try {
      this.logger.debug('[getConfig] Getting feature flag config', {
        flagKey,
        organizationId: context.organizationId,
      });

      const flag = await this.getFlag(flagKey, context.organizationId);

      if (!flag || !flag.enabled) {
        return null;
      }

      return (flag.config as T) || null;
    } catch (error) {
      this.logger.error('[getConfig] Error getting feature flag config', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        flagKey,
        organizationId: context.organizationId,
      });
      return null;
    }
  }

  /**
   * Create a new feature flag
   */
  async createFlag(
    data: CreateFeatureFlagDto,
  ): Promise<FeatureFlagResponseDto> {
    try {
      this.logger.debug('[createFlag] Creating feature flag', {
        flagKey: data.flagKey,
        organizationId: data.organizationId,
        type: data.type,
        scope: data.scope,
      });

      // Check if flag already exists
      const existingFlag = await this.prisma.db.featureFlag.findUnique({
        where: {
          organizationId_flagKey: {
            organizationId: data.organizationId,
            flagKey: data.flagKey,
          },
        },
      });

      if (existingFlag) {
        throw new BadRequestException(
          'Feature flag with this key already exists',
        );
      }

      const flag = await this.prisma.db.featureFlag.create({
        data: {
          organizationId: data.organizationId,
          flagKey: data.flagKey,
          name: data.name,
          description: data.description,
          type: data.type,
          scope: data.scope,
          enabled: data.enabled,
          config: data.config || {},
        },
      });

      const response = this.mapToResponseDto(flag);

      // Update cache
      this.updateCache(data.flagKey, data.organizationId, response);

      this.logger.log('[createFlag] Feature flag created successfully', {
        flagId: flag.id,
        flagKey: data.flagKey,
        organizationId: data.organizationId,
      });

      return response;
    } catch (error) {
      this.logger.error('[createFlag] Error creating feature flag', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        flagKey: data.flagKey,
        organizationId: data.organizationId,
      });
      throw error;
    }
  }

  /**
   * Update an existing feature flag
   */
  async updateFlag(
    flagKey: string,
    organizationId: OrganizationId,
    data: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagResponseDto> {
    try {
      this.logger.debug('[updateFlag] Updating feature flag', {
        flagKey,
        organizationId,
        updateData: Object.keys(data),
      });

      const flag = await this.prisma.db.featureFlag.update({
        where: {
          organizationId_flagKey: {
            organizationId,
            flagKey,
          },
        },
        data: {
          name: data.name,
          description: data.description,
          enabled: data.enabled,
          config: data.config,
        },
      });

      const response = this.mapToResponseDto(flag);

      // Update cache
      this.updateCache(flagKey, organizationId, response);

      this.logger.log('[updateFlag] Feature flag updated successfully', {
        flagId: flag.id,
        flagKey,
        organizationId,
      });

      return response;
    } catch (error) {
      this.logger.error('[updateFlag] Error updating feature flag', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        flagKey,
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Get all feature flags for an organization
   */
  async getOrganizationFlags(
    organizationId: OrganizationId,
  ): Promise<FeatureFlagResponseDto[]> {
    try {
      this.logger.debug('[getOrganizationFlags] Getting organization flags', {
        organizationId,
      });

      const flags = await this.prisma.db.featureFlag.findMany({
        where: {
          organizationId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return flags.map((flag) => this.mapToResponseDto(flag));
    } catch (error) {
      this.logger.error(
        '[getOrganizationFlags] Error getting organization flags',
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          organizationId,
        },
      );
      throw error;
    }
  }

  /**
   * Delete a feature flag
   */
  async deleteFlag(
    flagKey: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    try {
      this.logger.debug('[deleteFlag] Deleting feature flag', {
        flagKey,
        organizationId,
      });

      await this.prisma.db.featureFlag.delete({
        where: {
          organizationId_flagKey: {
            organizationId,
            flagKey,
          },
        },
      });

      // Remove from cache
      this.removeFromCache(flagKey, organizationId);

      this.logger.log('[deleteFlag] Feature flag deleted successfully', {
        flagKey,
        organizationId,
      });
    } catch (error) {
      this.logger.error('[deleteFlag] Error deleting feature flag', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        flagKey,
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Get a specific feature flag with caching
   */
  private async getFlag(
    flagKey: string,
    organizationId: OrganizationId,
  ): Promise<FeatureFlagResponseDto | null> {
    const cacheKey = `${organizationId}:${flagKey}`;
    const cachedFlag = this.getCachedFlag(cacheKey);

    if (cachedFlag) {
      return cachedFlag;
    }

    try {
      const flag = await this.prisma.db.featureFlag.findUnique({
        where: {
          organizationId_flagKey: {
            organizationId,
            flagKey,
          },
        },
      });

      if (!flag) {
        return null;
      }

      const response = this.mapToResponseDto(flag);
      this.updateCache(flagKey, organizationId, response);

      return response;
    } catch (error) {
      this.logger.error('[getFlag] Error fetching feature flag from database', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        flagKey,
        organizationId,
      });
      return null;
    }
  }

  /**
   * Get flag from cache if not expired
   */
  private getCachedFlag(cacheKey: string): FeatureFlagResponseDto | null {
    const timestamp = this.cacheTimestamps.get(cacheKey);

    if (!timestamp || Date.now() - timestamp > this.cacheExpiryMs) {
      // Cache expired
      this.flagCache.delete(cacheKey);
      this.cacheTimestamps.delete(cacheKey);
      return null;
    }

    return this.flagCache.get(cacheKey) || null;
  }

  /**
   * Update cache with flag data
   */
  private updateCache(
    flagKey: string,
    organizationId: OrganizationId,
    flag: FeatureFlagResponseDto,
  ): void {
    const cacheKey = `${organizationId}:${flagKey}`;
    this.flagCache.set(cacheKey, flag);
    this.cacheTimestamps.set(cacheKey, Date.now());
  }

  /**
   * Remove flag from cache
   */
  private removeFromCache(
    flagKey: string,
    organizationId: OrganizationId,
  ): void {
    const cacheKey = `${organizationId}:${flagKey}`;
    this.flagCache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
  }

  /**
   * Map database entity to response DTO
   */
  private mapToResponseDto(flag: {
    id: string;
    organizationId: string;
    flagKey: string;
    name: string;
    description: string | null;
    type: FeatureFlagType;
    scope: FeatureFlagScope;
    enabled: boolean;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): FeatureFlagResponseDto {
    return {
      id: flag.id as FeatureFlagId,
      organizationId: flag.organizationId as OrganizationId,
      flagKey: flag.flagKey,
      name: flag.name,
      description: flag.description,
      type: flag.type,
      scope: flag.scope,
      enabled: flag.enabled,
      config: (flag.config as Record<string, unknown>) || {},
      createdAt: flag.createdAt.toISOString(),
      updatedAt: flag.updatedAt.toISOString(),
    };
  }
}
