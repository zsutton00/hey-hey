import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventRouter } from './event-router';
import { EVENT_ROUTER_TOKEN } from './tokens';
import { RedisMessageBus } from './redis-message-bus.service';
import { MESSAGE_BUS_TOKEN } from './tokens';

@Global()
@Module({
  providers: [
    EventRouter,
    ConfigService,
    {
      provide: RedisMessageBus,
      // Keep a single Redis client per process (handy for hot-reload & tests)
      useFactory: (configService: ConfigService) => {
        const redisUrl = process.env.REDIS_URL;
        const redisHost =
          configService.get<string>('REDIS_HOST') ?? 'localhost';
        const redisPort = Number(
          configService.get<number>('REDIS_PORT') ?? 6379,
        );
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        const fallbackUrl = redisPassword
          ? `redis://:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
          : `redis://${redisHost}:${redisPort}`;
        const resolvedRedisUrl = redisUrl ?? fallbackUrl;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = global as any;
        if (!g.__REDIS_MESSAGE_BUS__) {
          g.__REDIS_MESSAGE_BUS__ = new RedisMessageBus(resolvedRedisUrl);
        }
        return g.__REDIS_MESSAGE_BUS__ as RedisMessageBus;
      },
      inject: [ConfigService],
    },
    // Re-export under DI token for easier injection in legacy services
    {
      provide: EVENT_ROUTER_TOKEN,
      useExisting: EventRouter,
    },
    {
      provide: MESSAGE_BUS_TOKEN,
      useExisting: RedisMessageBus,
    },
  ],
  exports: [EventRouter, EVENT_ROUTER_TOKEN, MESSAGE_BUS_TOKEN],
})
export class EventRouterModule {}
