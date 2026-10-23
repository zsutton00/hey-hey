import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { OutboxStore } from '../../services/outbox-store.service';
import { EventRouterModule } from './event-router.module';
import { OutboxPublisher } from './outbox-publisher.service';
import { OUTBOX_PUBLISHER_TOKEN, OUTBOX_STORE_TOKEN } from './tokens';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [EventRouterModule, MetricsModule],
  providers: [
    PrismaService,
    ConfigService,
    OutboxStore,
    OutboxPublisher,
    { provide: OUTBOX_STORE_TOKEN, useExisting: OutboxStore },
    { provide: OUTBOX_PUBLISHER_TOKEN, useExisting: OutboxPublisher },
  ],
  exports: [OUTBOX_STORE_TOKEN, OUTBOX_PUBLISHER_TOKEN, EventRouterModule],
})
export class OutboxPublisherModule {}
