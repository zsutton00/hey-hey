import { RedisService } from '../../src/core/redis/redis.service';

export function createRedisServiceMock() {
  return {
    provide: RedisService,
    useValue: {
      getClient: jest.fn().mockReturnValue({
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(1),
        incr: jest.fn().mockResolvedValue(1),
        decr: jest.fn().mockResolvedValue(0),
        setex: jest.fn().mockResolvedValue('OK'),
        mget: jest.fn().mockResolvedValue([]),
        publish: jest.fn().mockResolvedValue(1),
        pipeline: jest.fn().mockReturnValue({
          setex: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        }),
        disconnect: jest.fn().mockResolvedValue(undefined),
        exists: jest.fn().mockResolvedValue(0),
        hset: jest.fn().mockResolvedValue(1),
        hget: jest.fn().mockResolvedValue(null),
        hdel: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        ttl: jest.fn().mockResolvedValue(-1),
      }),
      onModuleDestroy: jest.fn(),
    },
  };
}
