import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ContextModule } from '../context/context.module';
import { DomainEventModule } from '../core/events/domain-event.module';
import { OutboxPublisher } from '../core/events/outbox-publisher.service';
import { OUTBOX_PUBLISHER_TOKEN } from '../core/events/tokens';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowModule } from '../services/workflows/workflow.module';
import { DOMAIN_EXPORTS, DOMAIN_SERVICES } from './domain.providers';

class NoopOutboxPublisher {
  constructor(readonly prisma: PrismaService) {}
  startPublisher(): void {}
  stopPublisher(): void {}
}

@Global()
@Module({
  imports: [
    HttpModule,
    ConfigModule,
    PrismaModule,
    DomainEventModule,
    WorkflowModule,
    ContextModule,
  ],
  providers: [
    ...DOMAIN_SERVICES,
    {
      provide: OUTBOX_PUBLISHER_TOKEN,
      useClass: NoopOutboxPublisher,
    },
    {
      provide: OutboxPublisher,
      useClass: NoopOutboxPublisher,
    },
    {
      provide: 'APP_CONTEXT',
      useFactory: (moduleRef: ModuleRef) => ({
        get: <T>(token: any) => moduleRef.get(token, { strict: false }),
      }),
      inject: [ModuleRef],
    },
  ],
  exports: [
    ...DOMAIN_EXPORTS,
    OUTBOX_PUBLISHER_TOKEN,
    OutboxPublisher,
    'APP_CONTEXT',
  ],
})
export class WorkerDomainModule {}
