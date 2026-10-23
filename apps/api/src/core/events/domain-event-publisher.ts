import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  OutboxEventData,
  OutboxStore,
} from '../../services/outbox-store.service';
import { OUTBOX_STORE_TOKEN } from './tokens';
import { ServiceEvent } from './types/domain-events';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import { FlowContextMetadata, runWithWorkflowContext } from './context-utils';
import { ExecutionContext } from 'src/types/execution-context';
import { EventContext } from './observable-event.context';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { ReplayOutboxEventData } from '../../services/outbox-store.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../types';
import { withApiSpan } from '../../telemetry/api-tracing';

export interface ReplayEventSource {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  headers: Prisma.JsonValue;
  maxRetries: number;
  correlationId: string;
  causationId: string | null;
  organizationId: string | null;
  projectId: string | null;
  conversationId: string | null;
  workflowId: string | null;
}

/**
 * Publishes DomainEvents by persisting them in the transactional outbox and
 * returning the generated outbox id.  Transport publication is performed
 * asynchronously by OutboxDispatcher.
 */
@Injectable()
export class DomainEventPublisher {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    DomainEventPublisher.name,
  );
  constructor(
    @Inject(OUTBOX_STORE_TOKEN)
    private readonly outbox: OutboxStore,
  ) {}

  /**
   * Persist the event in the outbox and return the row id.
   */
  async publish(
    event: Omit<ServiceEvent, 'id'>,
    meta: Record<string, unknown> = {},
  ): Promise<string | null> {
    return runWithWorkflowContext(
      {
        sourceService: DomainEventPublisher.name,
        sourceMethod: 'publish',
        context: this.buildExecutionContext(event),
        metadata: this.buildMetadata(event),
        eventContext: this.buildEventContext(event),
      },
      async () => {
        this.logger.debug('Publishing domain event', {
          eventType: event.type,
          aggregateId: event.aggregateId,
        });

        const payload = {
          eventType: event.type,
          aggregateType: event.type.split('.')[0],
          aggregateId: event.aggregateId,
          payload: {
            ...event.payload,
            ...meta,
          },
        } as OutboxEventData;

        const id = await withApiSpan('domain_event.persist', () =>
          this.outbox.storeEvent(payload),
        );
        this.logger.debug('Domain event persisted to outbox', {
          eventType: event.type,
          aggregateId: event.aggregateId,
          outboxId: id,
        });
        return id;
      },
    );
  }

  /**
   * Same as publish but using a provided Prisma transaction so the aggregate
   * mutation and event insertion remain atomic.
   * Accepts both base TransactionClient and extended clients with branded types.
   */
  async publishInTransaction(
    tx: AnyTransactionClient,
    event: Omit<ServiceEvent, 'id'>,
    meta: Record<string, unknown> = {},
    options: { scheduledFor?: Date; headers?: Record<string, unknown> } = {},
  ): Promise<string | null> {
    return runWithWorkflowContext(
      {
        sourceService: DomainEventPublisher.name,
        sourceMethod: 'publishInTransaction',
        context: this.buildExecutionContext(event),
        metadata: this.buildMetadata(event),
        eventContext: this.buildEventContext(event),
      },
      async () => {
        const payload: OutboxEventData = {
          eventType: event.type,
          aggregateType: event.type.split('.')[0],
          aggregateId: event.aggregateId,
          payload: { ...event.payload, ...meta },
          headers: options.headers,
          ...(options.scheduledFor
            ? { scheduledFor: options.scheduledFor }
            : {}),
        } as OutboxEventData;

        const id = await withApiSpan('domain_event.persist', () =>
          this.outbox.storeEventInTransaction(tx, payload),
        );
        this.logger.debug('Domain event persisted in transaction', {
          eventType: event.type,
          aggregateId: event.aggregateId,
          outboxId: id,
        });
        this.logger.verbose('Domain event payload', {
          outboxId: id,
          payload,
        });
        return id;
      },
    );
  }

  /**
   * Persist a validated outbox payload as a fresh pending replay copy. Replay
   * metadata lives in headers so the event payload remains source-equivalent.
   */
  async publishReplay(
    source: ReplayEventSource,
    payload: Prisma.JsonValue,
    metadata: {
      replayMode: string;
      replayedByUserId: string;
    },
  ): Promise<string | null> {
    return runWithWorkflowContext(
      {
        sourceService: DomainEventPublisher.name,
        sourceMethod: 'publishReplay',
        context: {
          correlationId: source.correlationId,
          causationId: source.causationId ?? source.correlationId,
          organizationId: source.organizationId
            ? (source.organizationId as OrganizationId)
            : undefined,
          projectId: source.projectId
            ? (source.projectId as ProjectId)
            : undefined,
          conversationId: source.conversationId
            ? (source.conversationId as ConversationId)
            : undefined,
          workflowId: source.workflowId
            ? (source.workflowId as WorkflowId)
            : undefined,
          userId: metadata.replayedByUserId as UserId,
        },
        metadata: {
          operationType: 'event.replay',
          entityType: source.aggregateType,
          entityId: source.aggregateId,
        },
      },
      async () => {
        const headers = this.asRecord(source.headers);
        const replayEvent: ReplayOutboxEventData = {
          eventType: source.eventType,
          aggregateType: source.aggregateType,
          aggregateId: source.aggregateId,
          payload,
          headers: {
            ...headers,
            replayed: true,
            replaySourceEventId: source.id,
            replayMode: metadata.replayMode,
            replayedByUserId: metadata.replayedByUserId,
            replayedAt: new Date().toISOString(),
          },
          maxRetries: source.maxRetries,
        };

        return withApiSpan('domain_event.persist', () =>
          this.outbox.storeReplayEvent(replayEvent),
        );
      },
    );
  }

  private buildExecutionContext(
    event: Omit<ServiceEvent, 'id'>,
  ): Partial<ExecutionContext> {
    const payload = this.asObject(event.payload) as
      | Partial<ExecutionContext>
      | undefined;
    const context: Partial<ExecutionContext> = {};
    if (payload?.organizationId)
      context.organizationId = payload.organizationId;
    if (payload?.projectId) context.projectId = payload.projectId;
    if (payload?.workflowId) context.workflowId = payload.workflowId;
    if (payload?.conversationId)
      context.conversationId = payload.conversationId;
    if (payload?.userId) context.userId = payload.userId;
    if (payload?.messageId) context.messageId = payload.messageId;
    if (payload?.requestId) context.requestId = payload.requestId;
    if (payload?.nodeId) context.nodeId = payload.nodeId;
    if (payload?.correlationId) context.correlationId = payload.correlationId;
    if (payload?.causationId) context.causationId = payload.causationId;
    if (payload?.timestamp) context.timestamp = payload.timestamp;
    return context;
  }

  private buildMetadata(
    event: Omit<ServiceEvent, 'id'>,
  ): Partial<FlowContextMetadata> {
    const metadata: Partial<FlowContextMetadata> = {
      operationType: event.type,
      executionType: 'domainEvent',
      entityType: event.type.split('.')[0],
      entityId: event.aggregateId,
    };
    const payload = this.asObject(event.payload);
    const maybeSet = <K extends keyof FlowContextMetadata>(
      key: K,
      value: unknown,
    ) => {
      if (value !== undefined && value !== null) {
        metadata[key] = value as FlowContextMetadata[K];
      }
    };
    if (payload) {
      maybeSet('flowId', payload['flowId']);
      maybeSet('nodeId', payload['nodeId']);
      maybeSet('messageId', payload['messageId']);
    }
    return metadata;
  }

  private buildEventContext(
    event: Omit<ServiceEvent, 'id'>,
  ): Partial<EventContext> {
    const payload = this.asObject(event.payload) as
      | Partial<ExecutionContext>
      | undefined;
    const ctx: Partial<EventContext> = {};
    const copyIfPresent = <K extends keyof EventContext>(
      key: K,
      value?: unknown,
    ) => {
      if (value !== undefined && value !== null) {
        ctx[key] = value as EventContext[K];
      }
    };
    copyIfPresent('correlationId', payload?.correlationId);
    copyIfPresent('causationId', payload?.causationId);
    copyIfPresent('workflowId', payload?.workflowId);
    copyIfPresent('conversationId', payload?.conversationId);
    copyIfPresent('organizationId', payload?.organizationId);
    copyIfPresent('projectId', payload?.projectId);
    copyIfPresent('userId', payload?.userId);
    copyIfPresent('messageId', payload?.messageId);

    const metadata = this.buildMetadata(event);
    if (metadata && Object.keys(metadata).length > 0) {
      ctx.metadata = metadata;
    }
    return ctx;
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return this.asObject(value) ?? {};
  }
}
