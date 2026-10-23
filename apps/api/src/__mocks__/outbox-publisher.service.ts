import { Injectable } from '@nestjs/common';
import { ContextAwareLogger } from '../core/logging/context-aware-logger.service';

@Injectable()
export class OutboxPublisher {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    OutboxPublisher.name,
  );
  private publisherInterval: NodeJS.Timeout | null = null;

  constructor(
    readonly _prisma: unknown,
    readonly _messageBus: unknown,
    readonly _config: unknown,
  ) {
    // Mock constructor - don't start any timers or processes
  }

  async onModuleInit() {
    // Mock implementation - don't start publisher
    this.logger.debug('OutboxPublisher mock initialized - no polling started');
  }

  async startPublisher() {
    // Mock implementation - don't start any intervals
    this.logger.debug('OutboxPublisher mock startPublisher called');
  }

  async stopPublisher() {
    // Mock implementation - clean up if needed
    if (this.publisherInterval) {
      clearInterval(this.publisherInterval);
      this.publisherInterval = null;
    }
    this.logger.debug('OutboxPublisher mock stopPublisher called');
  }

  async onModuleDestroy() {
    // Mock implementation - ensure cleanup
    await this.stopPublisher();
  }

  private async processOutboxEvents(): Promise<void> {
    // Mock implementation - don't process any events
    this.logger.debug('OutboxPublisher mock processOutboxEvents called');
    return Promise.resolve();
  }

  async publishEvent(event: unknown): Promise<void> {
    // Mock implementation - don't actually publish
    this.logger.debug('OutboxPublisher mock publishEvent called', event);
    return Promise.resolve();
  }

  async publishEvents(events: unknown[]): Promise<void> {
    // Mock implementation - don't actually publish
    this.logger.debug('OutboxPublisher mock publishEvents called', events);
    return Promise.resolve();
  }
}
