import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EntityType, ActivitySleepDuration } from 'src/generated';
import { RedisService } from 'src/core/redis/redis.service';
import { ActivitySleepService } from '../activity-sleep.service';

describe('ActivitySleepService', () => {
  const organizationId = 'org-1' as any;
  const userId = 'user-1' as any;

  let redisClient: {
    set: jest.Mock;
    mget: jest.Mock;
  };
  let redisService: Pick<RedisService, 'getClient'>;
  let service: ActivitySleepService;

  beforeEach(() => {
    redisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      mget: jest.fn().mockResolvedValue([]),
    };
    redisService = {
      getClient: jest.fn().mockReturnValue(redisClient),
    };
    service = new ActivitySleepService(redisService as RedisService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores sleep entries in redis with the requested ttl', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T10:00:00.000Z'));

    const result = await service.sleepActivity(organizationId, userId, {
      entityId: '11111111-1111-4111-8111-111111111111',
      entityType: EntityType.Task,
      duration: ActivitySleepDuration.OneHour,
    });

    expect(redisClient.set).toHaveBeenCalledWith(
      'activity-correlation:sleep:org-1:user-1:TASK:11111111-1111-4111-8111-111111111111',
      '2026-03-01T11:00:00.000Z',
      'PX',
      60 * 60 * 1000,
    );
    expect(result).toEqual({
      entityId: '11111111-1111-4111-8111-111111111111',
      entityType: EntityType.Task,
      duration: ActivitySleepDuration.OneHour,
      expiresAt: '2026-03-01T11:00:00.000Z',
    });
  });

  it('filters sleeping entities out of the recent activity seed set', async () => {
    redisClient.mget.mockResolvedValue(['2026-03-01T11:00:00.000Z', null]);

    const result = await service.filterAwakeEntities(organizationId, userId, [
      {
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Task,
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
      {
        entityId: '22222222-2222-4222-8222-222222222222',
        entityType: EntityType.Task,
        updatedAt: new Date('2026-03-01T09:00:00.000Z'),
      },
    ]);

    expect(redisClient.mget).toHaveBeenCalledWith([
      'activity-correlation:sleep:org-1:user-1:TASK:11111111-1111-4111-8111-111111111111',
      'activity-correlation:sleep:org-1:user-1:TASK:22222222-2222-4222-8222-222222222222',
    ]);
    expect(result).toEqual([
      {
        entityId: '22222222-2222-4222-8222-222222222222',
        entityType: EntityType.Task,
        updatedAt: new Date('2026-03-01T09:00:00.000Z'),
      },
    ]);
  });

  it('rejects entity types that are not present in the recent activity list', async () => {
    await expect(
      service.sleepActivity(organizationId, userId, {
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Message,
        duration: ActivitySleepDuration.OneHour,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('surfaces redis persistence failures', async () => {
    redisClient.set.mockRejectedValue(new Error('redis down'));

    await expect(
      service.sleepActivity(organizationId, userId, {
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Task,
        duration: ActivitySleepDuration.OneWeek,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns unsuppressed entities when redis lookup fails during feed reads', async () => {
    redisClient.mget.mockRejectedValue(new Error('redis down'));

    const result = await service.filterAwakeEntities(organizationId, userId, [
      {
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Task,
      },
      {
        entityId: '22222222-2222-4222-8222-222222222222',
        entityType: EntityType.AgentSession,
      },
    ]);

    expect(result).toEqual([
      {
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Task,
      },
      {
        entityId: '22222222-2222-4222-8222-222222222222',
        entityType: EntityType.AgentSession,
      },
    ]);
  });
});
