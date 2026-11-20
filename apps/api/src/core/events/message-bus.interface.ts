import { EventEnvelope } from './types/event-envelope';
import { ServiceEventType } from './types/event.types';

/**
 * MessageBus abstracts the transport layer.
 * Implementations: RedisMessageBus, KafkaMessageBus, InMemoryMessageBus (tests).
 */
export interface MessageBus {
  /**
   * Publish an envelope to the bus.
   */
  publish(envelope: EventEnvelope): Promise<void>;

  /**
   * Subscribe to an event type.
   * @param eventType  dot-notation string, e.g. "message.created"
   * @param handler    callback invoked whenever an envelope with matching type arrives
   */
  subscribe(
    eventType: ServiceEventType,
    handler: (envelope: EventEnvelope) => void,
  ): Promise<void>;

  /**
   * Observe loss and restoration of this instance's subscription to the bus.
   * While interrupted, envelopes published elsewhere are not received.
   * Transports that cannot be interrupted do not implement it.
   */
  onSubscriptionStateChange?(
    listener: (state: MessageBusSubscriptionState) => void,
  ): () => void;
}

export type MessageBusSubscriptionState = 'INTERRUPTED' | 'RESTORED';
