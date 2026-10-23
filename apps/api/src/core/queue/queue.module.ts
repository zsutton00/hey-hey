import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisQueueService } from './redis-queue.service';
import { DomainEventModule } from '../events/domain-event.module';

export const QUEUE_SERVICE_TOKEN = 'QUEUE_SERVICE';

@Module({
  imports: [ConfigModule, DomainEventModule],
  providers: [
    {
      provide: QUEUE_SERVICE_TOKEN,
      useClass: RedisQueueService,
    },
  ],
  exports: [QUEUE_SERVICE_TOKEN],
})
export class QueueModule {}
