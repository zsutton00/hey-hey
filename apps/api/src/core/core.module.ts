import { Global, Module } from '@nestjs/common';
import { LoggerModule } from '../common/logger/logger.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TemporalModule } from '../prisma/temporal.module';
import { DomainEventModule } from './events/domain-event.module';
import { QueueModule } from './queue/queue.module';
import { EventRouterModule } from './events/event-router.module';
import { RedisModule } from './redis/redis.module';

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
    QueueModule,
    EventRouterModule,
    RedisModule,
  ],
  exports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    TemporalModule,
    DomainEventModule,
    QueueModule,
    RedisModule,
  ],
})
export class CoreModule {}
