import { Module, Global } from '@nestjs/common';
import { OutboxStore } from '../../services/outbox-store.service';
import { DomainEventPublisher } from './domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN, OUTBOX_STORE_TOKEN } from './tokens';

@Global()
@Module({
  imports: [],
  providers: [
    OutboxStore,
    DomainEventPublisher,
    { provide: OUTBOX_STORE_TOKEN, useExisting: OutboxStore },
    {
      provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
      useExisting: DomainEventPublisher,
    },
  ],
  exports: [
    DOMAIN_EVENT_PUBLISHER_TOKEN,
    OUTBOX_STORE_TOKEN,
    DomainEventPublisher,
    OutboxStore,
  ],
})
export class DomainEventModule {}
