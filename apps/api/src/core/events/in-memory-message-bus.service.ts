import { Injectable, Logger } from '@nestjs/common';
import { MessageBus } from './message-bus.interface';
import { EventEnvelope } from './types/event-envelope';

const busses = new Set<InMemoryMessageBus>();

// Export for testing
export { busses };

/**
 * Very small in-process message bus used in test/dev scenarios where an
 * external transport (Redis, Kafka, etc.) is not required.
 */
@Injectable()
export class InMemoryMessageBus implements MessageBus {
  private readonly logger = new Logger(InMemoryMessageBus.name);
  private readonly handlers = new Map<
    string,
    Set<(env: EventEnvelope) => void>
  >();

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      busses.add(this);
      if (busses.size > 1) {
        throw new Error(
          'Duplicate InMemoryMessageBus instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
        );
      }
    }
  }

  async publish(envelope: EventEnvelope): Promise<void> {
    const set = this.handlers.get(envelope.event.type);
    this.logger.debug(
      `InMemoryMessageBus publishing event ${envelope.event.id} of type ${envelope.event.type}`,
      {
        envelope,
        handlers: set?.size,
        busses: busses.size,
        exists: busses.has(this),
      },
    );
    if (!set) return;
    for (const h of set) {
      try {
        h(envelope);
      } catch (error) {
        this.logger.debug('InMemoryMessageBus error', {
          envelope,
          error,
        });
        /* swallow */
      }
    }
  }

  async subscribe(
    eventType: string,
    handler: (envelope: EventEnvelope) => void,
  ): Promise<void> {
    this.logger.debug('InMemoryMessageBus subscribing to event', {
      eventType,
    });
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      throw new Error(
        `InMemoryMessageBus failed to register handler for ${eventType}`,
      );
    }
    handlers.add(handler);
  }
}
