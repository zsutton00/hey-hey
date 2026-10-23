import { Injectable, Logger } from '@nestjs/common';
import { MessageBus } from './message-bus.interface';
import { Inject } from '@nestjs/common';
import { MESSAGE_BUS_TOKEN } from './tokens';
import { EventEnvelope } from './types/event-envelope';
import { EventContextManager } from 'src/core/events/observable-event.context';
import { OrganizationId, ProjectId } from 'src/types';
import { ServiceEventType } from './types/event.types';

const eventRouterSet = new Set<EventRouter>();

// Export for testing
export { eventRouterSet };

/**
 * EventRouter is the in-process dispatcher for domain events.
 *
 * – Subscribes once per event type to the underlying MessageBus.
 * – Fans out envelopes to all registered handlers in-memory.
 * – Provides simple idempotency by skipping duplicate event IDs (prevent same event processed twice).
 */
@Injectable()
export class EventRouter {
  private readonly logger = new Logger(EventRouter.name);

  // map<eventType, Set<handler>>
  private readonly handlers = new Map<
    string,
    Set<(e: EventEnvelope) => void>
  >();

  // dedup cache per handler key (worst case a few thousand recent events)
  private readonly processed = new Set<string>();
  private readonly DEDUP_LIMIT = 10_000;

  constructor(@Inject(MESSAGE_BUS_TOKEN) private readonly bus: MessageBus) {
    if (process.env.NODE_ENV !== 'test') {
      eventRouterSet.add(this);
      if (eventRouterSet.size > 1) {
        throw new Error(
          'Duplicate EventRouter instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
        );
      }
    }
  }

  /**
   * Register a handler for an event type.
   * The handler will be invoked for every envelope of that type.
   */
  async on(
    eventType: ServiceEventType,
    handler: (envelope: EventEnvelope) => unknown,
  ): Promise<void> {
    this.logger.debug(`EventRouter subscribing to event type ${eventType}`);
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
      // first registration – wire underlying bus subscription
      await this.bus.subscribe(eventType, (env) => this.dispatch(env));
    }
    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      throw new Error(
        `EventRouter failed to register handler for ${eventType}: missing handler set`,
      );
    }
    handlers.add(handler);
  }

  /* ---------------- internal ---------------- */

  private dispatch(env: EventEnvelope) {
    const set = this.handlers.get(env.event.type);
    this.logger.debug(
      `dispatching event ${env.event.id} for ${env.event.type}:${env.event.aggregateId}`,
    );
    if (!set) return;

    if (!env.event.id) {
      this.logger.error('EventRouter received event without id', {
        event: env.event,
      });

      throw new Error('EventRouter received event without id');
    }

    if (this.processed.has(env.event.id)) {
      this.logger.debug(`EventRouter skipping duplicate event ${env.event.id}`);
      return;
    }
    this.processed.add(env.event.id);
    if (this.processed.size > this.DEDUP_LIMIT) {
      // remove oldest – naive: clear half
      const half = this.DEDUP_LIMIT / 2;
      let i = 0;
      for (const key of this.processed) {
        this.processed.delete(key);
        if (++i >= half) break;
      }
    }

    const ctxMgr = EventContextManager.getInstance();
    const busCtx = ctxMgr.createInitialContext(
      (env.headers?.sourceService as string | undefined) ?? 'event-bus',
      env.event.type,
      {
        correlationId: env.correlationId,
        causationId: env.headers?.eventId as string | undefined,
        organizationId: env.organizationId as OrganizationId,
        projectId: env.projectId as ProjectId,
        metadata: env.headers,
      },
    );

    void ctxMgr.runWithContext(busCtx, async () => {
      for (const h of set) {
        try {
          h(env);
        } catch (err) {
          this.logger.error(
            `EventRouter handler threw for ${env.event.type}`,
            err,
          );
        }
      }
    });
  }
}
