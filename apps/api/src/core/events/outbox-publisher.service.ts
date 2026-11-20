import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { OutboxEvent, Prisma } from '@prisma/client';
import { ExecutionContext } from 'src/types/execution-context';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxEventStatus } from '../../services/outbox-store.service';
import { MessageBus } from './message-bus.interface';
import { MESSAGE_BUS_TOKEN } from './tokens';
import { ServiceEvent } from './types/domain-events';
import { EventEnvelope } from './types/event-envelope';
import { runWithWorkflowContext } from './context-utils';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from 'src/types';
import { EventContext, FlowContextMetadata } from './observable-event.context';
import { ApiMetricsService } from '../metrics/api-metrics.service';

function uniqBy<T>(array: T[], iteratee: (item: T) => string): T[] {
  const seen = new Set();
  const result: T[] = [];

  for (const item of array) {
    const key = iteratee(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export const outboxPublisers = new Set<OutboxPublisher>();

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    OutboxPublisher.name,
  );
  private publisherInterval: NodeJS.Timeout | null = null;
  private publisherRunning = false;
  private pollInProgress = false;
  private readonly PUBLISH_INTERVAL_MS: number;
  private readonly BATCH_SIZE: number;
  private readonly CLAIM_LEASE_MS = 60_000;
  private readonly DEFAULT_MAX_RETRIES: number;
  private readonly RETRY_DELAY_BASE_MS: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_BUS_TOKEN) private readonly messageBus: MessageBus,
    private readonly config: ConfigService,
    private readonly metrics: ApiMetricsService,
  ) {
    // Load tunables from configuration with sensible defaults
    this.PUBLISH_INTERVAL_MS =
      Number(this.config.get('OUTBOX_PUBLISH_INTERVAL_MS')) || 100;
    this.BATCH_SIZE = Number(this.config.get('OUTBOX_BATCH_SIZE')) || 10;
    this.DEFAULT_MAX_RETRIES =
      Number(this.config.get('OUTBOX_DEFAULT_MAX_RETRIES')) || 3;
    this.RETRY_DELAY_BASE_MS =
      Number(this.config.get('OUTBOX_RETRY_BASE_MS')) || 1000;
    this.logger.log('OutboxPublisher created', {
      processId: process.pid,
      timestamp: new Date().toISOString(),
    });

    if (process.env.NODE_ENV !== 'test') {
      outboxPublisers.add(this);
      if (outboxPublisers.size > 1) {
        throw new Error(
          'Duplicate OutboxPublisher instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
        );
      }
    }
  }

  onModuleInit() {
    this.startPublisher();
    this.logger.log('OutboxPublisher initialised and polling loop started');
  }

  startPublisher() {
    if (this.publisherRunning) {
      return;
    }
    this.publisherRunning = true;
    this.schedulePoll();
  }

  private schedulePoll() {
    this.publisherInterval = setTimeout(() => {
      void this.poll();
    }, this.PUBLISH_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (this.pollInProgress) {
      return;
    }
    this.pollInProgress = true;
    try {
      await this.processOutboxEvents();
    } catch (err) {
      this.logger.error('Unhandled error processing outbox events', err);
    } finally {
      this.pollInProgress = false;
      if (this.publisherRunning) {
        this.schedulePoll();
      }
    }
  }

  onModuleDestroy() {
    this.stopPublisher();
    outboxPublisers.delete(this);
  }

  stopPublisher() {
    this.publisherRunning = false;
    if (this.publisherInterval) {
      clearTimeout(this.publisherInterval);
      this.publisherInterval = null;
    }
  }

  private async processOutboxEvents(): Promise<void> {
    const due: Prisma.OutboxEventWhereInput = {
      OR: [
        {
          status: OutboxEventStatus.PROCESSING,
          claimExpiresAt: { lte: new Date() },
        },
        { status: OutboxEventStatus.PENDING, scheduledFor: null },
        {
          status: OutboxEventStatus.SCHEDULED,
          scheduledFor: { lte: new Date() },
        },
        {
          status: OutboxEventStatus.FAILED,
          nextRetryAt: { lte: new Date() },
        },
      ],
    };
    const events = await this.prisma.outboxEvent.findMany({
      where: due,
      orderBy: [{ partitionKey: 'asc' }, { sequenceNumber: 'asc' }],
      take: this.BATCH_SIZE,
    });

    if (events.length === 0) return;
    this.logger.debug('Outbox publisher count', {
      count: outboxPublisers.size,
    });

    const uniqueEvents = uniqBy(events, (evt) => evt.id);

    if (uniqueEvents.length !== events.length) {
      this.logger.warn('Duplicate events found in outbox batch', {
        duplicateCount: events.length - uniqueEvents.length,
      });
    }

    for (const evt of uniqueEvents) {
      await this.runWithOutboxContext(evt, 'processOutboxEvent', async () => {
        this.logger.debug('Processing outbox event', {
          eventId: evt.id,
          aggregateId: evt.aggregateId,
          aggregateType: evt.aggregateType,
          partitionKey: evt.partitionKey,
        });
        const start = Date.now();
        const claimToken = randomUUID();
        const claim = await this.prisma.outboxEvent.updateMany({
          where: { id: evt.id, retryCount: evt.retryCount, ...due },
          data: {
            status: OutboxEventStatus.PROCESSING,
            claimToken,
            claimExpiresAt: new Date(Date.now() + this.CLAIM_LEASE_MS),
          },
        });
        if (claim.count !== 1) {
          return;
        }

        let publishedEvent = evt;
        try {
          // A merge may have committed after the initial candidate read.
          const claimedEvent = await this.prisma.outboxEvent.findUniqueOrThrow({
            where: {
              id: evt.id,
              claimToken,
              status: OutboxEventStatus.PROCESSING,
            },
          });
          publishedEvent = claimedEvent;
          await this.publishEvent(claimedEvent);
          const completed = await this.prisma.outboxEvent.updateMany({
            where: {
              id: evt.id,
              claimToken,
              status: OutboxEventStatus.PROCESSING,
            },
            data: {
              status: OutboxEventStatus.PUBLISHED,
              claimToken: null,
              claimExpiresAt: null,
              processedAt: new Date(),
              nextRetryAt: null,
            },
          });
          if (completed.count !== 1) {
            this.logger.warn('Outbox claim lost before completion', {
              eventId: evt.id,
            });
            return;
          }
        } catch (err) {
          await this.handleEventError(evt, err as Error, claimToken);
          return;
        }

        // Observability failures must never retry an already published event.
        try {
          await this.logEventProcessed(publishedEvent, start);
        } catch (err) {
          this.logger.error('Failed to record published outbox event', {
            eventId: evt.id,
            error: err,
          });
        }
      });
    }

    // Refresh lag gauge (oldest pending age)
    try {
      const oldest = await this.prisma.outboxEvent.findFirst({
        where: { status: OutboxEventStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (oldest) {
        this.metrics.setOutboxLagSeconds(
          (Date.now() - oldest.createdAt.getTime()) / 1000,
        );
      } else {
        this.metrics.setOutboxLagSeconds(0);
      }
    } catch (e) {
      this.logger.debug('Error refreshing outbox lag gauge', e);
      // ignore gauge errors
    }
  }

  private async publishEvent(evt: OutboxEvent): Promise<void> {
    const envelope: EventEnvelope<ServiceEvent> = {
      event: {
        id: evt.id,
        type: evt.eventType,
        aggregateId: evt.aggregateId,
        payload: evt.payload as unknown as ExecutionContext,
      } as ServiceEvent,
      timestamp: new Date().toISOString(),
      correlationId: evt.correlationId,
      causationId: evt.causationId ?? undefined,
      headers: { ...(evt.headers as Record<string, unknown>), eventId: evt.id },
    };
    await this.messageBus.publish(envelope);
  }

  private async handleEventError(
    evt: OutboxEvent,
    error: Error,
    claimToken: string,
  ) {
    const retryCount = evt.retryCount + 1;
    const maxRetries = evt.maxRetries || this.DEFAULT_MAX_RETRIES;
    if (retryCount >= maxRetries) {
      const failed = await this.prisma.outboxEvent.updateMany({
        where: { id: evt.id, claimToken, status: OutboxEventStatus.PROCESSING },
        data: {
          status: OutboxEventStatus.FAILED,
          claimToken: null,
          claimExpiresAt: null,
          retryCount,
          nextRetryAt: null,
          lastError: error.message,
          errorCount: evt.errorCount + 1,
        },
      });
      if (failed.count !== 1) {
        this.logger.warn('Outbox claim lost after publish failure', {
          eventId: evt.id,
          error: error.message,
        });
        return;
      }
      this.logger.error(`Permanent failure publishing event ${evt.id}`, {
        eventId: evt.id,
        correlationId: evt.correlationId,
        retryCount,
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      this.metrics.recordOutboxFailed();
      return;
    }
    const delay = Math.min(
      this.RETRY_DELAY_BASE_MS * Math.pow(2, retryCount - 1),
      30_000,
    );
    const failed = await this.prisma.outboxEvent.updateMany({
      where: { id: evt.id, claimToken, status: OutboxEventStatus.PROCESSING },
      data: {
        status: OutboxEventStatus.FAILED,
        claimToken: null,
        claimExpiresAt: null,
        retryCount,
        nextRetryAt: new Date(Date.now() + delay),
        lastError: error.message,
        errorCount: evt.errorCount + 1,
      },
    });
    if (failed.count !== 1) {
      this.logger.warn('Outbox claim lost after publish failure', {
        eventId: evt.id,
        error: error.message,
      });
      return;
    }
    this.logger.warn('Outbox publish failed; retry scheduled', {
      eventId: evt.id,
      correlationId: evt.correlationId,
      retryCount,
      retryDelayMs: delay,
      message: error.message,
      name: error.name,
    });
  }

  private async logEventProcessed(evt: OutboxEvent, startTime: number) {
    const processingTime = Date.now() - startTime;
    await this.prisma.eventLog.create({
      data: {
        correlationId: evt.correlationId,
        causationId: evt.causationId,
        sagaId: evt.sagaId,
        eventType: evt.eventType,
        aggregateType: evt.aggregateType,
        aggregateId: evt.aggregateId,
        payload: evt.payload as Prisma.InputJsonValue,
        metadata: {
          outboxEventId: evt.id,
          retryCount: evt.retryCount,
          partitionKey: evt.partitionKey,
        },
        processingTime,
        sourceService: evt.sourceService,
        sourceMethod: evt.sourceMethod,
        sourceVersion: evt.sourceVersion,
        userId: evt.userId,
        organizationId: evt.organizationId,
        projectId: evt.projectId,
        conversationId: evt.conversationId,
        workflowId: evt.workflowId,
        publishedTo: ['redis'],
        publishedAt: new Date(),
        publishLatency: processingTime,
      },
    });
    this.metrics.recordOutboxProcessed();
  }

  private async runWithOutboxContext<T>(
    event: OutboxEvent,
    method: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const context = this.buildExecutionContext(event);
    const metadata = this.buildMetadata(event);
    return runWithWorkflowContext(
      {
        sourceService: OutboxPublisher.name,
        sourceMethod: method,
        context,
        metadata,
        eventContext: this.buildEventContext(event, context, metadata),
      },
      fn,
    );
  }

  private buildExecutionContext(event: OutboxEvent): Partial<ExecutionContext> {
    const context: Partial<ExecutionContext> = {};
    if (event.organizationId)
      context.organizationId = event.organizationId as OrganizationId;
    if (event.projectId) context.projectId = event.projectId as ProjectId;
    if (event.workflowId) context.workflowId = event.workflowId as WorkflowId;
    if (event.conversationId)
      context.conversationId = event.conversationId as ConversationId;
    if (event.userId) context.userId = event.userId as UserId;
    if (event.correlationId) context.correlationId = event.correlationId;
    if (event.causationId) context.causationId = event.causationId ?? undefined;

    const payload = this.asObject(event.payload);
    if (payload?.['messageId']) {
      context.messageId = payload['messageId'] as MessageId;
    }
    if (payload?.['requestId']) {
      context.requestId = payload['requestId'] as RequestId;
    }
    if (payload?.['nodeId']) {
      context.nodeId = String(payload['nodeId']);
    }
    return context;
  }

  private buildMetadata(event: OutboxEvent): Partial<FlowContextMetadata> {
    const payload = this.asObject(event.payload);
    const headerObj = this.asObject(event.headers);
    const metadata: Partial<FlowContextMetadata> = {
      operationType: event.eventType,
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      executionType: 'outboxDispatch',
    };

    const setIfPresent = <K extends keyof FlowContextMetadata>(
      key: K,
      value: unknown,
    ) => {
      if (value !== undefined && value !== null) {
        metadata[key] = value as FlowContextMetadata[K];
      }
    };

    setIfPresent('flowId', headerObj?.['flowId'] || payload?.['flowId']);
    setIfPresent('nodeId', headerObj?.['nodeId'] || payload?.['nodeId']);
    setIfPresent(
      'messageId',
      headerObj?.['messageId'] || payload?.['messageId'],
    );

    return metadata;
  }

  private buildEventContext(
    event: OutboxEvent,
    context?: Partial<ExecutionContext>,
    metadata?: Partial<FlowContextMetadata>,
  ): Partial<EventContext> {
    const baseContext = context ?? this.buildExecutionContext(event);
    const meta = metadata ?? this.buildMetadata(event);
    const ctx: Partial<EventContext> = {};
    const setIfPresent = <K extends keyof EventContext>(
      key: K,
      value: unknown,
    ) => {
      if (value !== undefined && value !== null) {
        ctx[key] = value as EventContext[K];
      }
    };

    setIfPresent('correlationId', baseContext.correlationId);
    setIfPresent('causationId', baseContext.causationId);
    setIfPresent('workflowId', baseContext.workflowId);
    setIfPresent('conversationId', baseContext.conversationId);
    setIfPresent('organizationId', baseContext.organizationId);
    setIfPresent('projectId', baseContext.projectId);
    setIfPresent('userId', baseContext.userId);
    setIfPresent('messageId', baseContext.messageId);

    if (meta && Object.keys(meta).length > 0) {
      ctx.metadata = meta;
    }
    return ctx;
  }

  private asObject(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }
}
