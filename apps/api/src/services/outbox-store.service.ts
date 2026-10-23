import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { errorToLoggable } from 'src/utils/logging.util';
import { v4 as uuidv4 } from 'uuid';
import {
  EventContext,
  EventContextManager,
  getEventContext,
} from '../core/events/observable-event.context';
import { OutboxEventData } from '../core/events/outbox-event.types';
import { ContextAwareLogger } from '../core/logging/context-aware-logger.service';
import { AnyTransactionClient, PrismaService } from '../prisma/prisma.service';
import { UserId } from '../types';

// Type definitions for initiative update payloads
interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  dataType: string;
}

interface InitiativeChangeMetadata {
  timestamp: string;
  mergedAt?: string;
  mergeCount?: number;
}

interface InitiativeChangedBy {
  userId: UserId;
  email: string;
  name: string;
}

interface InitiativeUpdatePayload {
  update?: Record<string, unknown>;
  changes: FieldChange[];
  totalFieldsChanged: number;
  changedBy: InitiativeChangedBy;
  changeMetadata?: InitiativeChangeMetadata;
  organizationId?: string;
  projectId?: string;
  originatingProjectId?: string | null;
  linkedProjectIds?: string[];
}

const DEBUG_OUTBOX_EVENT_SELECT = {
  id: true,
  correlationId: true,
  causationId: true,
  sagaId: true,
  eventType: true,
  aggregateType: true,
  aggregateId: true,
  eventVersion: true,
  payload: true,
  headers: true,
  status: true,
  retryCount: true,
  maxRetries: true,
  createdAt: true,
  processedAt: true,
  nextRetryAt: true,
  scheduledFor: true,
  lastError: true,
  errorCount: true,
  partitionKey: true,
  sequenceNumber: true,
  sourceService: true,
  sourceMethod: true,
  sourceVersion: true,
  userId: true,
  organizationId: true,
  projectId: true,
  conversationId: true,
  workflowId: true,
} satisfies Prisma.OutboxEventSelect;

type DebugOutboxEventRow = Prisma.OutboxEventGetPayload<{
  select: typeof DEBUG_OUTBOX_EVENT_SELECT;
}>;

export interface DebugOutboxEventRecord {
  id: string;
  correlationId: string;
  causationId: string | null;
  sagaId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventVersion: number;
  payload: Prisma.JsonValue;
  headers: Prisma.JsonValue;
  status: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  processedAt: Date | null;
  nextRetryAt: Date | null;
  scheduledFor: Date | null;
  lastError: string | null;
  errorCount: number;
  partitionKey: string;
  sequenceNumber: string;
  sourceService: string;
  sourceMethod: string;
  sourceVersion: string | null;
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
  conversationId: string | null;
  workflowId: string | null;
}

export interface ReplayOutboxEventData {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  headers: Prisma.JsonValue;
  maxRetries: number;
}

function mapDebugOutboxEvent(
  event: DebugOutboxEventRow,
): DebugOutboxEventRecord {
  return {
    ...event,
    sequenceNumber: event.sequenceNumber.toString(),
  };
}

/**
 * Thin façade that exposes only persistence-related APIs of the Outbox.
 * All dispatch / retry logic lives in OutboxPublisher (ObservableOutboxService).
 */
@Injectable()
export class OutboxStore {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    OutboxStore.name,
  );
  private readonly DEFAULT_MAX_RETRIES = 3;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a new event in the outbox table and return its id.
   */
  async storeEvent(eventData: OutboxEventData): Promise<string> {
    const context = getEventContext();
    const eventId = uuidv4();

    // Sequence number now handled by database trigger

    const correlationId =
      context.correlationId ??
      EventContextManager.getInstance().createCorrelationId();
    const causationId = context.causationId ?? correlationId;
    await this.prisma.outboxEvent.create({
      data: {
        id: eventId,
        correlationId,
        causationId,
        sagaId: context.sagaId,
        eventType: eventData.eventType,
        aggregateType: eventData.aggregateType,
        aggregateId: eventData.aggregateId,
        payload: eventData.payload as unknown as Prisma.InputJsonValue,
        headers: {
          ...(eventData.headers ?? {}),
          traceId: correlationId,
          causationId,
          sourceService: context.sourceService,
        } as Prisma.InputJsonValue,
        status: eventData.scheduledFor
          ? OutboxEventStatus.SCHEDULED
          : OutboxEventStatus.PENDING,
        scheduledFor: eventData.scheduledFor,
        maxRetries: eventData.maxRetries || this.DEFAULT_MAX_RETRIES,
        partitionKey: context.organizationId || 'default',
        sourceService: context.sourceService,
        sourceMethod: context.sourceMethod,
        sourceVersion: context.sourceVersion,
        userId: context.userId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        conversationId: context.conversationId,
        workflowId: context.workflowId,
        // sequenceNumber removed - database trigger assigns it
        createdAt: new Date(),
      },
    });

    this.logger.debug('Event stored in outbox', {
      eventId,
      eventType: eventData.eventType,
      correlationId,
    });

    return eventId;
  }

  /**
   * Persist a replay copy through the same outbox insertion path as ordinary
   * domain events. The event registry owns validation; this boundary only
   * preserves the source event's transport shape while assigning a new row id.
   */
  async storeReplayEvent(eventData: ReplayOutboxEventData): Promise<string> {
    return this.storeEvent({
      eventType: eventData.eventType,
      aggregateType: eventData.aggregateType,
      aggregateId: eventData.aggregateId,
      payload: eventData.payload as Prisma.InputJsonValue,
      headers: eventData.headers as Record<string, unknown>,
      maxRetries: eventData.maxRetries,
    } as OutboxEventData);
  }

  /**
   * Persist an event as part of a client-supplied Prisma transaction.
   * For initiative.updated events, implements smart merging with recent events from the same user.
   * Accepts both base TransactionClient and extended clients with branded types.
   */
  async storeEventInTransaction(
    tx: AnyTransactionClient,
    eventData: OutboxEventData,
  ): Promise<string> {
    const context = getEventContext();

    // Smart event merging for initiative updates within 5-minute window
    if (
      eventData.eventType === 'initiative.updated' &&
      context.userId &&
      context.organizationId &&
      eventData.aggregateId
    ) {
      const mergedEventId = await this.tryMergeWithRecentEvent(
        tx,
        eventData,
        context,
      );
      if (mergedEventId) {
        return mergedEventId;
      }
    }

    // Create new event if no merge occurred
    return this.createNewOutboxEvent(tx, eventData, context);
  }

  /**
   * Attempt to merge with a recent initiative.updated event from the same user within 5 minutes
   */
  private async tryMergeWithRecentEvent(
    tx: Prisma.TransactionClient,
    eventData: OutboxEventData,
    context: EventContext,
  ): Promise<string | null> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const correlationId =
      context.correlationId ??
      EventContextManager.getInstance().createCorrelationId();
    const causationId = context.causationId ?? correlationId;

    try {
      // Find recent initiative.updated event from same user for same initiative
      const existingEvent = await tx.outboxEvent.findFirst({
        where: {
          eventType: 'initiative.updated',
          aggregateId: eventData.aggregateId,
          userId: context.userId,
          organizationId: context.organizationId,
          createdAt: {
            gte: fiveMinutesAgo,
          },
          status: {
            in: ['PENDING', 'SCHEDULED'], // Only merge with events that haven't been processed yet
          },
        },
        orderBy: {
          createdAt: 'desc', // Get the most recent one
        },
      });

      if (!existingEvent) {
        return null; // No recent event to merge with
      }

      this.logger.debug('Found recent initiative.updated event to merge', {
        existingEventId: existingEvent.id,
        aggregateId: eventData.aggregateId,
        userId: context.userId,
        ageMinutes:
          (Date.now() - existingEvent.createdAt.getTime()) / (1000 * 60),
      });

      // Merge the payloads
      const mergedPayload = this.mergeInitiativeUpdatePayloads(
        existingEvent.payload as unknown as InitiativeUpdatePayload,
        eventData.payload as unknown as InitiativeUpdatePayload,
      );

      // Update the existing event with merged payload and reset timestamp
      await tx.outboxEvent.update({
        where: { id: existingEvent.id },
        data: {
          payload: mergedPayload as unknown as Prisma.InputJsonValue,
          // Update timestamp to reflect latest change
          createdAt: new Date(),
          // Update correlation context to latest
          correlationId,
          causationId,
          headers: {
            ...(existingEvent.headers as Record<string, unknown>),
            traceId: correlationId,
            causationId,
            sourceService: context.sourceService,
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.debug('Successfully merged initiative.updated event', {
        mergedEventId: existingEvent.id,
        aggregateId: eventData.aggregateId,
        totalFieldsChanged: mergedPayload.totalFieldsChanged,
      });

      return existingEvent.id;
    } catch (error) {
      this.logger.warn('Failed to merge with recent event, creating new one', {
        error: error instanceof Error ? error.message : errorToLoggable(error),
        aggregateId: eventData.aggregateId,
        userId: context.userId,
      });
      return null; // Fall back to creating new event
    }
  }

  /**
   * Merge two initiative.updated payloads intelligently
   */
  private mergeInitiativeUpdatePayloads(
    existingPayload: InitiativeUpdatePayload,
    newPayload: InitiativeUpdatePayload,
  ): InitiativeUpdatePayload {
    // Start with existing payload as base
    const merged = { ...existingPayload };

    // Update the legacy format (for backward compatibility)
    if (newPayload.update) {
      merged.update = {
        ...merged.update,
        ...newPayload.update,
      };
    }

    // Merge changes arrays intelligently
    const existingChanges = merged.changes || [];
    const newChanges = newPayload.changes || [];

    // Create a map of field changes for efficient merging
    const changesByField = new Map<string, FieldChange>();

    // Add existing changes to map
    existingChanges.forEach((change: FieldChange) => {
      changesByField.set(change.field, change);
    });

    // Overlay new changes (latest value wins)
    newChanges.forEach((change: FieldChange) => {
      const existingChange = changesByField.get(change.field);
      if (existingChange) {
        // Keep original oldValue, update to new newValue
        changesByField.set(change.field, {
          ...change,
          oldValue: existingChange.oldValue, // Preserve original value
        });
      } else {
        changesByField.set(change.field, change);
      }
    });

    // Convert map back to array
    merged.changes = Array.from(changesByField.values());

    // Update metadata
    merged.totalFieldsChanged = merged.changes.length;
    merged.changeMetadata = {
      ...merged.changeMetadata,
      timestamp: new Date().toISOString(),
      mergedAt: new Date().toISOString(),
      mergeCount: (merged.changeMetadata?.mergeCount || 0) + 1,
    };

    // Update changedBy to latest user (should be same user in practice)
    if (newPayload.changedBy) {
      merged.changedBy = newPayload.changedBy;
    }

    // Keep latest organizationId and projectId
    if (newPayload.organizationId) {
      merged.organizationId = newPayload.organizationId;
    }
    if (newPayload.projectId) {
      merged.projectId = newPayload.projectId;
    }
    if (newPayload.originatingProjectId !== undefined) {
      merged.originatingProjectId = newPayload.originatingProjectId;
    }
    if (newPayload.linkedProjectIds) {
      const combined = [
        ...(merged.linkedProjectIds || []),
        ...newPayload.linkedProjectIds,
      ];
      merged.linkedProjectIds = Array.from(new Set(combined));
    }

    return merged;
  }

  /**
   * Create a new outbox event (extracted from original method)
   */
  private async createNewOutboxEvent(
    tx: Prisma.TransactionClient,
    eventData: OutboxEventData,
    context: EventContext,
  ): Promise<string> {
    const eventId = uuidv4();

    // Sequence number now handled by database trigger

    const correlationId =
      context.correlationId ??
      EventContextManager.getInstance().createCorrelationId();
    const causationId = context.causationId ?? correlationId;

    try {
      await tx.outboxEvent.create({
        data: {
          id: eventId,
          correlationId,
          causationId,
          sagaId: context.sagaId,
          eventType: eventData.eventType,
          aggregateType: eventData.aggregateType,
          aggregateId: eventData.aggregateId,
          payload: eventData.payload as unknown as Prisma.InputJsonValue,
          headers: {
            ...(eventData.headers ?? {}),
            traceId: correlationId,
            causationId,
            sourceService: context.sourceService,
          } as Prisma.InputJsonValue,
          status: eventData.scheduledFor
            ? OutboxEventStatus.SCHEDULED
            : OutboxEventStatus.PENDING,
          scheduledFor: eventData.scheduledFor,
          maxRetries: eventData.maxRetries || this.DEFAULT_MAX_RETRIES,
          partitionKey: context.organizationId || 'default',
          sourceService: context.sourceService,
          sourceMethod: context.sourceMethod,
          sourceVersion: context.sourceVersion,
          userId: context.userId,
          organizationId: context.organizationId,
          projectId: context.projectId,
          conversationId: context.conversationId,
          workflowId: context.workflowId,
          // sequenceNumber removed - database trigger assigns it
          createdAt: new Date(),
        },
      });

      this.logger.debug('New outbox event created', {
        eventId,
        eventType: eventData.eventType,
        aggregateId: eventData.aggregateId,
      });

      return eventId;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        // Duplicate sequence number - should never happen with database-managed sequences
        this.logger.warn('Unexpected P2002 with database-managed sequences', {
          eventType: eventData.eventType,
          aggregateId: eventData.aggregateId,
        });
        return eventId;
      }
      throw error;
    }
  }

  /**
   * High-level statistics helpful for monitoring/alerting.
   */
  async getEventsForEntity(params: {
    entityType: string;
    entityId: string;
  }): Promise<DebugOutboxEventRecord[]> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        aggregateType: params.entityType,
        aggregateId: params.entityId,
      },
      orderBy: [{ createdAt: 'desc' }, { sequenceNumber: 'desc' }],
      select: DEBUG_OUTBOX_EVENT_SELECT,
    });

    return events.map(mapDebugOutboxEvent);
  }

  /**
   * High-level statistics helpful for monitoring/alerting.
   */
  async getOutboxStats() {
    const stats = await this.prisma.outboxEvent.groupBy({
      by: ['status'],
      _count: true,
    });

    const totalEvents = await this.prisma.outboxEvent.count();
    const oldestPending = await this.prisma.outboxEvent.findFirst({
      where: { status: OutboxEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    return {
      total: totalEvents,
      byStatus: stats.reduce(
        (
          acc: Record<string, number>,
          stat: { status: string; _count: number },
        ) => {
          acc[stat.status] = stat._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      oldestPendingAge: oldestPending
        ? Date.now() - oldestPending.createdAt.getTime()
        : null,
    };
  }

  /**
   * Reset failed events back to PENDING for manual retry.
   */
  async retryFailedEvents(eventIds?: string[]): Promise<number> {
    const where = eventIds
      ? { id: { in: eventIds }, status: OutboxEventStatus.FAILED }
      : { status: OutboxEventStatus.FAILED };

    const updated = await this.prisma.outboxEvent.updateMany({
      where,
      data: {
        status: OutboxEventStatus.PENDING,
        nextRetryAt: null,
        retryCount: 0,
        lastError: null,
      },
    });

    this.logger.log(`Manually retrying ${updated.count} failed events`);
    return updated.count;
  }
}

// Re-export event typings for external consumers
export {
  EventPayload,
  isConversationEvent,
  isMessageEvent,
  isProjectEvent,
  isSystemEvent,
  isWorkflowEvent,
  OutboxEventData,
} from '../core/events/outbox-event.types';

// Expose enum so callers can inspect statuses without pulling prisma models
export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
}
