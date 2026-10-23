import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import {
  ActivitySleepDto,
  ActivitySleepDuration,
  CreateActivitySleepDto,
} from 'src/generated';
import { RedisService } from 'src/core/redis/redis.service';
import { OrganizationId, UserId } from 'src/types';
import { isRecentAllowedEntityType } from './activity-correlation.graph-mappers';

type SleepableEntityRef = {
  entityId: string;
  entityType: CreateActivitySleepDto['entityType'];
};

@Injectable()
export class ActivitySleepService {
  private readonly logger = new Logger(ActivitySleepService.name);
  private readonly redisClient: Redis;
  private readonly keyPrefix = 'activity-correlation:sleep';

  constructor(private readonly redisService: RedisService) {
    this.redisClient = this.redisService.getClient();
  }

  async sleepActivity(
    organizationId: OrganizationId,
    userId: UserId,
    input: CreateActivitySleepDto,
  ): Promise<ActivitySleepDto> {
    if (!isRecentAllowedEntityType(input.entityType)) {
      throw new BadRequestException(
        `entityType is not supported for recent activity sleep: ${input.entityType}`,
      );
    }

    const ttlMs = this.resolveDurationMs(input.duration);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const key = this.buildKey(organizationId, userId, input);

    try {
      await this.redisClient.set(key, expiresAt, 'PX', ttlMs);
    } catch (error) {
      this.logger.error('Failed to persist activity sleep state', {
        organizationId,
        userId,
        entityId: input.entityId,
        entityType: input.entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableException(
        'Activity suppression store is unavailable',
      );
    }

    return {
      entityId: input.entityId,
      entityType: input.entityType,
      duration: input.duration,
      expiresAt,
    } satisfies ActivitySleepDto;
  }

  async filterAwakeEntities<T extends SleepableEntityRef>(
    organizationId: OrganizationId,
    userId: UserId,
    entities: T[],
  ): Promise<T[]> {
    if (entities.length === 0) {
      return [];
    }

    const entitiesByKey = new Map<string, T>();
    entities.forEach((entity) => {
      const key = this.buildKey(organizationId, userId, entity);
      if (!entitiesByKey.has(key)) {
        entitiesByKey.set(key, entity);
      }
    });

    const keys = [...entitiesByKey.keys()];
    let values: Array<string | null>;

    try {
      values = await this.redisClient.mget(keys);
    } catch (error) {
      this.logger.warn(
        'Failed to read activity sleep state; returning unsuppressed results',
        {
          organizationId,
          userId,
          entityCount: entities.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return entities;
    }

    const sleepingKeys = new Set<string>();
    values.forEach((value, index) => {
      const key = keys[index];
      if (value !== null && key) {
        sleepingKeys.add(key);
      }
    });

    return entities.filter(
      (entity) =>
        !sleepingKeys.has(this.buildKey(organizationId, userId, entity)),
    );
  }

  private buildKey(
    organizationId: OrganizationId,
    userId: UserId,
    entity: SleepableEntityRef,
  ): string {
    return [
      this.keyPrefix,
      organizationId,
      userId,
      entity.entityType,
      entity.entityId,
    ].join(':');
  }

  private resolveDurationMs(duration: ActivitySleepDuration): number {
    switch (duration) {
      case ActivitySleepDuration.OneHour:
        return 60 * 60 * 1000;
      case ActivitySleepDuration.TwentyFourHours:
        return 24 * 60 * 60 * 1000;
      case ActivitySleepDuration.OneWeek:
        return 7 * 24 * 60 * 60 * 1000;
      default:
        throw new BadRequestException(
          `Unsupported activity sleep duration: ${duration}`,
        );
    }
  }
}
