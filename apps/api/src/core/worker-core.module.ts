import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '../common/logger/logger.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TemporalModule } from '../prisma/temporal.module';
import { QueueModule } from './queue/queue.module';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from './events/tokens';
import { DomainEventPublisher } from './events/domain-event-publisher';
import { DomainEventModule } from './events/domain-event.module';
import { RedisModule } from './redis/redis.module';

/**
 * WorkerCoreModule – stripped-down variant of CoreModule for Temporal worker processes.
 * Removes EventRouterModule (websocket fan-out etc.) to avoid duplicate EventRouter
 * instantiation while still exposing everything activities need (Prisma, Queue, Events).
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule,
    PrismaModule,
    TemporalModule,
    DomainEventModule,
    RedisModule,
    QueueModule,
  ],
  providers: [],
  exports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    TemporalModule,
    DomainEventModule,
    RedisModule,
    QueueModule,
  ],
})
export class WorkerCoreModule {}
