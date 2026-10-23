/**
 * SQLite-compatible OutboxStore that manages sequence numbers in application code
 * instead of relying on database triggers
 *
 * This is necessary because SQLite doesn't support PostgreSQL's BEFORE INSERT triggers
 * that can modify the NEW row before constraint checking.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  OutboxEventData,
  OutboxStore,
  OutboxEventStatus,
} from '../../../services/outbox-store.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  EventContextManager,
  getEventContext,
} from '../../../core/events/observable-event.context';

@Injectable()
export class SqliteOutboxStore extends OutboxStore {
  // In-memory sequence tracking (per aggregate_id + aggregate_type + event_type)
  private sequenceMap = new Map<string, number>();

  private getSequenceKey(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
  ): string {
    return `${aggregateType}:${aggregateId}:${eventType}`;
  }

  private getNextSequence(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
  ): number {
    const key = this.getSequenceKey(aggregateId, aggregateType, eventType);
    const current = this.sequenceMap.get(key) ?? 0;
    const next = current + 1;
    this.sequenceMap.set(key, next);
    return next;
  }

  /**
   * Override storeEvent to add sequence number before insert
   */
  async storeEvent(eventData: OutboxEventData): Promise<string> {
    const context = getEventContext();
    const eventId = uuidv4();
    const sequenceNumber = this.getNextSequence(
      eventData.aggregateId,
      eventData.aggregateType,
      eventData.eventType,
    );

    const correlationId =
      context.correlationId ??
      EventContextManager.getInstance().createCorrelationId();
    const causationId = context.causationId ?? correlationId;

    await this['prisma'].db.outboxEvent.create({
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
        maxRetries: eventData.maxRetries || 3,
        partitionKey: context.organizationId || 'default',
        sourceService: context.sourceService,
        sourceMethod: context.sourceMethod,
        sourceVersion: context.sourceVersion,
        userId: context.userId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        conversationId: context.conversationId,
        workflowId: context.workflowId,
        sequenceNumber, // Explicitly set sequence number
        createdAt: new Date(),
      },
    });

    return eventId;
  }

  /**
   * Override storeEventInTransaction to add sequence number before insert
   */
  async storeEventInTransaction(
    tx: Prisma.TransactionClient,
    eventData: OutboxEventData,
  ): Promise<string> {
    const context = getEventContext();
    const eventId = uuidv4();
    const sequenceNumber = this.getNextSequence(
      eventData.aggregateId,
      eventData.aggregateType,
      eventData.eventType,
    );

    const correlationId =
      context.correlationId ??
      EventContextManager.getInstance().createCorrelationId();
    const causationId = context.causationId ?? correlationId;

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
        maxRetries: eventData.maxRetries || 3,
        partitionKey: context.organizationId || 'default',
        sourceService: context.sourceService,
        sourceMethod: context.sourceMethod,
        sourceVersion: context.sourceVersion,
        userId: context.userId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        conversationId: context.conversationId,
        workflowId: context.workflowId,
        sequenceNumber, // Explicitly set sequence number
        createdAt: new Date(),
      },
    });

    return eventId;
  }

  /**
   * Reset sequence tracking (useful for test cleanup)
   */
  resetSequences(): void {
    this.sequenceMap.clear();
  }
}
