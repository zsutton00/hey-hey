import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { MessageBus } from './message-bus.interface';
import { EventEnvelope } from './types/event-envelope';
import { EVENT_TYPES } from './types/event.types';

const redisMessageBusSet = new Set<RedisMessageBus>();

/**
 * RedisMessageBus is a thin implementation of the transport-agnostic MessageBus
 * contract backed by Redis Pub/Sub. It provides:
 *
 * • Fire-and-forget `publish` – the caller does not wait for any subscribers.
 * • `subscribe` – handlers are invoked in-process whenever a matching envelope
 *   arrives.
 * • Deduplication window (default 5 seconds) to guarantee «at-most-once»
 *   delivery across a cluster when the same envelope is published twice.
 *
 * NOTE: this class purposefully keeps the feature-set minimal – only what is
 * required by the current codebase and the unit tests.  It can be enhanced
 * later with patterns such as consumer groups, persisted streams, etc.
 */
@Injectable()
export class RedisMessageBus
  implements MessageBus, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisMessageBus.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<
    string,
    Set<(env: EventEnvelope) => void>
  >();

  private readonly EVENTS_CHANNEL_PREFIX = 'hey-hey:bus:';
  private readonly DEDUPLICATION_WINDOW_MS = 5000; // 5-second window
  private readonly DEDUP_KEY_PREFIX = 'bus:dedup:';

  constructor(redisUrl?: string) {
    redisMessageBusSet.add(this);
    if (process.env.NODE_ENV !== 'test' && redisMessageBusSet.size > 1) {
      throw new Error(
        'Duplicate RedisMessageBus instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
      );
    }

    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';

    const options: RedisOptions = {
      // Disable ready-checks so the client is usable instantly (handy for tests)
      enableReadyCheck: false,
      showFriendlyErrorStack: true,
      // Simple retry strategy – exponential back-off up to 2 seconds
      retryStrategy: (times) => Math.min(times * 50, 2000),
    } as RedisOptions;

    this.publisher = new Redis(url, options);
    this.subscriber = new Redis(url, options);

    // Fan all messages from Redis to local in-memory handlers
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.subscriber.on('message', (channel, message) =>
      this.handleMessage(channel, message),
    );
  }

  /* ----------------------------------------------------------------------- */
  /*  Lifecycle                                                               */
  /* ----------------------------------------------------------------------- */

  async onModuleInit() {
    // no-op – connections are established in the constructor
  }

  async onModuleDestroy() {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  /* ----------------------------------------------------------------------- */
  /*  MessageBus                                                              */
  /* ----------------------------------------------------------------------- */

  async publish(envelope: EventEnvelope): Promise<void> {
    const channel = this.getChannelForEventType(envelope.event.type);
    const payload = JSON.stringify(envelope);
    this.logger.debug(`[publish] ${channel}`, payload);
    await this.publisher.publish(channel, payload);
  }

  async subscribe(
    eventType: string,
    handler: (envelope: EventEnvelope) => void,
  ): Promise<void> {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      throw new Error(
        `RedisMessageBus failed to register handler for ${eventType}`,
      );
    }
    handlers.add(handler);

    // Subscribe lazily – only once per channel regardless of #handlers
    const channel = this.getChannelForEventType(eventType);
    // Redis throws if we subscribe to the same channel twice – guard against that
    if (!this.subscribedChannels.has(channel)) {
      await this.subscriber.subscribe(channel);
      this.subscribedChannels.add(channel);
      this.logger.debug(`Subscribed to redis channel ${channel}`);
    }
  }

  /* ----------------------------------------------------------------------- */
  /*  Internals                                                               */
  /* ----------------------------------------------------------------------- */

  private readonly subscribedChannels = new Set<string>();

  private getChannelForEventType(eventType: string): string {
    return `${this.EVENTS_CHANNEL_PREFIX}${eventType}`;
  }

  private async handleMessage(channel: string, message: string) {
    // Deduplicate first (best-effort – at-most-once semantics)
    if (await this.isDuplicate(channel, message)) {
      return; // already processed within the window
    }

    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(message);
    } catch (err) {
      this.logger.warn('Failed to parse envelope from Redis', err as Error);
      return;
    }

    const localHandlers = this.handlers.get(envelope.event.type);
    if (!localHandlers || localHandlers.size === 0) return;

    for (const h of localHandlers) {
      this.logger.verbose(
        `Handling message ${envelope.event.type} ${envelope.event.aggregateId}`,
      );
      try {
        h(envelope);
      } catch (error) {
        this.logger.error(
          `Handler for ${envelope.event.type} threw – swallowed by bus`,
          error as Error,
        );
      }
    }
  }

  /**
   * Return true if an identical message was already seen within the dedup window.
   */
  private async isDuplicate(
    channel: string,
    message: string,
  ): Promise<boolean> {
    // Each API owns a snapshot, so every subscriber must receive invalidations.
    if (
      channel ===
      this.getChannelForEventType(EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED)
    ) {
      return false;
    }
    const hash = this.hashString(message);
    const key = `${this.DEDUP_KEY_PREFIX}${channel}:${hash}`;
    // SET key NX PX <ms> – only succeeds if key does not yet exist
    const res = await this.publisher.set(
      key,
      '1',
      'PX',
      this.DEDUPLICATION_WINDOW_MS,
      'NX',
    );
    // Redis returns null on duplicate
    return res === null;
  }

  /**
   * Simple DJB2 hash – good enough for deduplication keys.
   */
  private hashString(input: string): number {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }

    return hash >>> 0; // convert to unsigned 32-bit int
  }
}
