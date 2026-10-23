import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AgentSessionCreatedEvent,
  AgentSessionDeletedEvent,
  AgentSessionStatusChangedEvent,
  DesignDocCreatedEvent,
  DesignDocStatusChangedEvent,
  DesignDocUpdatedEvent,
  EvalAttemptUpdatedEvent,
  EvalRunUpdatedEvent,
  InitiativeStatusChangedEvent,
  InitiativeUpdatedEvent,
  isProjectEvents,
  ProposalApprovedEvent,
  ProposalGroupLifecycleEvent,
  ServiceEvent,
  TaskContentChangedEvent,
  TaskCreatedEvent,
  TaskStatusChangedEvent,
  TaskUpdatedEvent,
} from 'src/core/events/types/domain-events';
import { ConversationId, MessageId } from 'src/types';
import {
  ConversationUpdatedEventPayload,
  MessageRealtimeEventPayload,
  WebSocketConversationCreatedEvent,
  WebSocketConversationStatusChangedEvent,
  WebSocketConversationUpdatedEvent,
  WebSocketDesignDocCreatedEvent,
  WebSocketDesignDocStatusChangedEvent,
  WebSocketDesignDocUpdatedEvent,
  WebSocketInitiativeCreatedEvent,
  WebSocketInitiativeStatusChangedEvent,
  WebSocketInitiativeUpdatedEvent,
  WebSocketMessageCreatedEvent,
  WebSocketMessageDeletedEvent,
  WebSocketMessageRealtimeEvent,
  WebSocketMessageUpdatedEvent,
  WebSocketProjectCreatedEvent,
  WebSocketProjectStatusChangedEvent,
  WebSocketProjectUpdatedEvent,
  WebSocketAgentSessionCreatedEvent,
  WebSocketAgentSessionDeletedEvent,
  WebSocketAgentSessionStatusChangedEvent,
  WebSocketProposalApprovedEvent,
  WebSocketProposalGroupLifecycleEvent,
  WebSocketTaskCreatedEvent,
  WebSocketTaskStatusChangedEvent,
  WebSocketTaskUpdatedEvent,
} from '../../generated';
import { EventRouter } from '../events/event-router';
import { EventEnvelope } from '../events/types/event-envelope';
import { EVENT_TYPES, ServiceEventType } from '../events/types/event.types';
import { extractEventIds } from '../events/utils/event-id.util';
import { TriggerEmitter } from './trigger-emitter.service';
import { WebsocketGateway } from './websocket.gateway';

@Injectable()
export class RealtimeBridge implements OnModuleInit {
  private readonly logger = new Logger(RealtimeBridge.name);
  private readonly messageRealtimeSequenceByStream = new Map<string, number>();
  private readonly messageRealtimeSequenceLimit = 5_000;
  constructor(
    private readonly eventRouter: EventRouter,
    private readonly gateway: WebsocketGateway,
    private readonly triggerEmitter: TriggerEmitter,
  ) {}

  /**
   * Helper functions to convert domain events to WebSocket event structures
   */
  private createMessageCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketMessageCreatedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    return {
      type: 'message.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      messageId: serviceEvent.aggregateId,
    };
  }

  private createMessageUpdatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketMessageUpdatedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    const updatePayload = serviceEvent.payload as {
      update?: { [key: string]: unknown };
    };
    const changedFields = updatePayload.update
      ? Object.keys(updatePayload.update)
      : [];
    return {
      type: 'message.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      messageId: serviceEvent.aggregateId,
      changedFields,
    };
  }

  private createMessageDeletedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketMessageDeletedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    return {
      type: 'message.deleted',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      messageId: serviceEvent.aggregateId,
    };
  }

  private createMessageRealtimeEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketMessageRealtimeEvent {
    const payload = serviceEvent.payload as MessageRealtimeEventPayload;
    const organizationId = payload.organizationId;
    const projectId = this.requirePayloadField(payload.projectId, 'projectId');
    const conversationId = this.requirePayloadField(
      payload.conversationId,
      'conversationId',
    );
    const messageId = this.requirePayloadField(payload.messageId, 'messageId');
    const requestId = this.requirePayloadField(payload.requestId, 'requestId');
    const sequence = this.requirePayloadField(payload.sequence, 'sequence');
    const kind = this.requirePayloadField(payload.kind, 'kind');
    const source = this.requirePayloadField(payload.source, 'source');
    const timestamp = this.requirePayloadField(payload.timestamp, 'timestamp');

    return {
      type: 'message.realtime',
      timestamp,
      organizationId,
      projectId,
      conversationId,
      userId: payload.userId,
      messageId,
      requestId,
      sequence,
      kind,
      source,
      payload: payload.payload,
    };
  }

  private createConversationCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketConversationCreatedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    if (!projectId || !conversationId) {
      throw new Error(
        'Missing projectId or conversationId for conversation.created event',
      );
    }
    return {
      type: 'conversation.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
    };
  }

  private createConversationUpdatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketConversationUpdatedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    if (!projectId || !conversationId) {
      throw new Error(
        'Missing projectId or conversationId for conversation.updated event',
      );
    }
    const updatePayload =
      serviceEvent.payload as ConversationUpdatedEventPayload;

    const changedFields = updatePayload.update
      ? Object.keys(updatePayload.update)
      : [];

    return {
      type: 'conversation.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      previousVersion: updatePayload.previousVersion || 1,
      newVersion: updatePayload.newVersion || 2,
      changeType: (updatePayload.changeType || 'system') as
        | 'user'
        | 'message_added'
        | 'status_change'
        | 'system',
      lastModifiedBy: updatePayload.lastModifiedBy || undefined,
      changedFields,
      latestMessageId: updatePayload.latestMessageId,
    };
  }

  private createConversationStatusChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketConversationStatusChangedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    if (!projectId || !conversationId) {
      throw new Error(
        'Missing projectId or conversationId for conversation.status_changed event',
      );
    }
    const statusPayload = serviceEvent.payload as {
      previousStatus?: string;
      newStatus?: string;
    };

    return {
      type: 'conversation.status_changed',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      previousStatus: statusPayload.previousStatus || 'unknown',
      newStatus: statusPayload.newStatus || 'unknown',
    };
  }

  private createProjectCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketProjectCreatedEvent {
    const { projectId, organizationId, userId } = this.extractIds(serviceEvent);
    return {
      type: 'project.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: undefined,
      userId,
    };
  }

  private createProjectUpdatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketProjectUpdatedEvent {
    const { projectId, organizationId, userId } = this.extractIds(serviceEvent);
    const updatePayload = serviceEvent.payload as {
      update?: { [key: string]: unknown };
    };
    const changedFields = updatePayload.update
      ? Object.keys(updatePayload.update)
      : [];

    return {
      type: 'project.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: undefined as ConversationId | undefined,
      userId,
      changedFields,
    };
  }

  private createProjectStatusChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketProjectStatusChangedEvent {
    const { projectId, organizationId, userId } = this.extractIds(serviceEvent);
    const statusPayload = serviceEvent.payload as {
      previousStatus?: string;
      newStatus?: string;
      status?: string;
    };

    return {
      type: 'project.status_changed',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: undefined,
      userId,
      previousStatus: statusPayload.previousStatus || 'unknown',
      newStatus: statusPayload.newStatus || statusPayload.status || 'unknown',
    };
  }

  // Helper for initiative events using generated OpenAPI types
  private createInitiativeCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketInitiativeCreatedEvent {
    const { projectId, conversationId, initiativeId, organizationId, userId } =
      this.extractIds(serviceEvent);
    return {
      type: 'initiative.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      initiativeId: initiativeId || serviceEvent.aggregateId,
    };
  }

  private createInitiativeUpdatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketInitiativeUpdatedEvent {
    const { projectId, conversationId, initiativeId, organizationId, userId } =
      this.extractIds(serviceEvent);
    // InitiativeUpdated includes change metadata from domain event
    const typedEvent = serviceEvent as InitiativeUpdatedEvent;
    const updateData = typedEvent.payload.update;
    const changes = typedEvent.payload.changes || [];
    const changedBy = typedEvent.payload.changedBy;
    const linkedProjectIds = typedEvent.payload.linkedProjectIds || [];
    const activeProjectId =
      typedEvent.payload.projectId || projectId || undefined;

    const changedFields = updateData
      ? Object.keys(updateData)
      : changes.map((c) => c.field);

    return {
      type: 'initiative.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId: activeProjectId,
      conversationId,
      userId,
      initiativeId: initiativeId || serviceEvent.aggregateId,
      originatingProjectId:
        typedEvent.payload.originatingProjectId ?? undefined,
      linkedProjectIds,
      changedFields,
      totalFieldsChanged:
        typedEvent.payload.totalFieldsChanged || changedFields.length,
      changedBy: changedBy ?? {
        userId: 'SYSTEM',
      },
    };
  }

  private createInitiativeStatusChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketInitiativeStatusChangedEvent {
    const { projectId, conversationId, initiativeId, organizationId, userId } =
      this.extractIds(serviceEvent);
    // InitiativeStatusChanged includes previous/new status
    const typedEvent = serviceEvent as InitiativeStatusChangedEvent;

    return {
      type: 'initiative.status_changed',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      initiativeId: initiativeId || serviceEvent.aggregateId,
      previousStatus: typedEvent.payload.previousStatus,
      newStatus: typedEvent.payload.newStatus,
    };
  }

  private createTaskCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketTaskCreatedEvent {
    const { projectId, organizationId, initiativeId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as TaskCreatedEvent;
    const payload = typedEvent.payload;

    return {
      type: 'task.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: payload.conversationId ?? undefined,
      userId: payload.userId ?? undefined,
      taskId: typedEvent.aggregateId,
      initiativeId: initiativeId ?? payload.initiativeId,
    };
  }

  private createTaskUpdatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketTaskUpdatedEvent {
    const { projectId, organizationId, initiativeId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as TaskUpdatedEvent;
    const payload = typedEvent.payload;
    const updateData = payload.update || {};
    const changedFields = Object.keys(updateData);

    return {
      type: 'task.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: payload.conversationId ?? undefined,
      userId: payload.userId ?? undefined,
      taskId: typedEvent.aggregateId,
      initiativeId: initiativeId ?? payload.initiativeId,
      changedFields,
      totalFieldsChanged: changedFields.length,
      changedBy: {
        userId: payload.userId ?? 'SYSTEM',
      },
    };
  }

  private createTaskContentChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketTaskUpdatedEvent {
    const { projectId, organizationId, initiativeId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as TaskContentChangedEvent;
    const payload = typedEvent.payload;
    const changedFields = Object.keys(payload.content);

    return {
      type: 'task.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: payload.conversationId ?? undefined,
      userId: payload.userId ?? undefined,
      taskId: typedEvent.aggregateId,
      initiativeId: initiativeId ?? payload.initiativeId,
      changedFields,
      totalFieldsChanged: changedFields.length,
      changedBy: {
        userId: payload.userId ?? 'SYSTEM',
      },
    };
  }

  private createTaskStatusChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketTaskStatusChangedEvent {
    const { projectId, organizationId, initiativeId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as TaskStatusChangedEvent;
    const payload = typedEvent.payload;

    return {
      type: 'task.status_changed',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId: payload.conversationId ?? undefined,
      userId: payload.userId ?? undefined,
      taskId: typedEvent.aggregateId,
      initiativeId: initiativeId ?? payload.initiativeId,
      previousStatus: payload.previousStatus,
      newStatus: payload.newStatus,
    };
  }

  private createDesignDocCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketDesignDocCreatedEvent {
    const { projectId, conversationId, organizationId, designDocId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as DesignDocCreatedEvent;

    return {
      type: 'design_doc.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: typedEvent.payload.userId ?? undefined,
      designDocId: designDocId || serviceEvent.aggregateId,
    };
  }

  private createDesignDocUpdatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketDesignDocUpdatedEvent {
    const { projectId, conversationId, organizationId, designDocId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as DesignDocUpdatedEvent;
    const payloadWithChanges =
      typedEvent.payload as DesignDocUpdatedEvent['payload'] & {
        changes?: Array<{ field: string }>;
      };
    const changedFields = payloadWithChanges.changes?.map(
      (change) => change.field,
    );
    const changedByUserId = typedEvent.payload.userId;

    return {
      type: 'design_doc.updated',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: changedByUserId ?? undefined,
      designDocId: designDocId || serviceEvent.aggregateId,
      changedFields,
      totalFieldsChanged: changedFields?.length,
      changedBy: {
        userId: changedByUserId ?? 'SYSTEM',
      },
    };
  }

  private createDesignDocStatusChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketDesignDocStatusChangedEvent {
    const { projectId, conversationId, organizationId, designDocId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as DesignDocStatusChangedEvent;

    return {
      type: 'design_doc.status_changed',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: typedEvent.payload.userId ?? undefined,
      designDocId: designDocId || serviceEvent.aggregateId,
      previousStatus: typedEvent.payload.previousStatus,
      newStatus: typedEvent.payload.newStatus,
    };
  }

  private createAgentSessionCreatedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketAgentSessionCreatedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as AgentSessionCreatedEvent;

    return {
      type: 'agent_session.created',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      agentSessionId: typedEvent.aggregateId,
    };
  }

  private createAgentSessionDeletedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketAgentSessionDeletedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as AgentSessionDeletedEvent;

    return {
      type: 'agent_session.deleted',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      agentSessionId: typedEvent.aggregateId,
    };
  }

  private createAgentSessionStatusChangedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketAgentSessionStatusChangedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as AgentSessionStatusChangedEvent;

    return {
      type: 'agent_session.status_changed',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      agentSessionId: typedEvent.aggregateId,
      previousStatus: typedEvent.payload.previousStatus,
      newStatus: typedEvent.payload.newStatus,
    };
  }

  private createProposalApprovedEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketProposalApprovedEvent {
    const { projectId, conversationId, organizationId, userId } =
      this.extractIds(serviceEvent);
    const typedEvent = serviceEvent as ProposalApprovedEvent;
    const payload = typedEvent.payload;

    return {
      type: 'proposal.approved',
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId,
      proposalId: payload.proposalId,
      targetEntityId: payload.targetEntityId,
      targetEntityType: payload.targetEntityType,
      action: payload.action,
      resultingEntityId: payload.resultingEntityId,
    };
  }

  private createProposalGroupLifecycleEvent(
    serviceEvent: ServiceEvent,
  ): WebSocketProposalGroupLifecycleEvent {
    const typedEvent = serviceEvent as ProposalGroupLifecycleEvent;
    return {
      type: 'proposal_group.lifecycle',
      timestamp: new Date().toISOString(),
      organizationId: typedEvent.payload.organizationId,
      projectId: typedEvent.payload.projectId,
      groupId: typedEvent.payload.groupId,
      revision: typedEvent.payload.revision,
      changedMemberIds: typedEvent.payload.changedMemberIds,
    };
  }

  async onModuleInit() {
    this.logger.log('RealtimeBridge initialized – registering handlers');
    const handlers: Partial<
      Record<ServiceEventType, (event: ServiceEvent) => void>
    > = {
      [EVENT_TYPES.MESSAGE.CREATED]: (event) => {
        const wsEvent = this.createMessageCreatedEvent(event);
        this.gateway.emitMessageCreated(wsEvent);
      },
      [EVENT_TYPES.MESSAGE.UPDATED]: (event) => {
        const wsEvent = this.createMessageUpdatedEvent(event);
        this.gateway.emitMessageUpdated(wsEvent);
      },
      [EVENT_TYPES.MESSAGE.DELETED]: (event) => {
        const wsEvent = this.createMessageDeletedEvent(event);
        this.gateway.emitMessageDeleted(wsEvent);
      },
      [EVENT_TYPES.MESSAGE.REALTIME]: (event) => {
        const payload = event.payload as MessageRealtimeEventPayload;
        if (!this.shouldEmitMessageRealtime(payload)) {
          this.logger.verbose(
            `Dropping stale/duplicate message.realtime event ${event.id}`,
            {
              organizationId: payload.organizationId,
              requestId: payload.requestId,
              messageId: payload.messageId,
              sequence: payload.sequence,
            },
          );
          return;
        }
        const wsEvent = this.createMessageRealtimeEvent(event);
        this.gateway.emitMessageRealtime(wsEvent);
      },
      [EVENT_TYPES.CONVERSATION.CREATED]: (event) => {
        const wsEvent = this.createConversationCreatedEvent(event);
        this.gateway.emitConversationCreated(wsEvent);
      },
      [EVENT_TYPES.CONVERSATION.UPDATED]: (event) => {
        this.logger.verbose(
          `RealtimeBridge emitting conversation updated ${event.id}`,
          {
            eventId: event.id,
          },
        );
        const wsEvent = this.createConversationUpdatedEvent(event);
        this.gateway.emitConversationUpdated(wsEvent);
        // The room-wide conversation.updated broadcast above is unchanged.
        // Additionally, if the message that drove this update is a trigger,
        // emit a signed trigger.conversation frame to the owner's machine.
        // Gate at the dispatcher on the elevated `triggersAgent` envelope
        // so non-trigger message adds skip the trigger emitter entirely
        // (which would otherwise round-trip to the DB to read the body).
        const updatePayload = event.payload as ConversationUpdatedEventPayload;
        // Diagnostic: log the gate inputs so we can see whether
        // `triggersAgent` is being set on inbound conversation.updated
        // events. If always absent here, the issue is upstream (publisher
        // not stamping the envelope); if present here but no trigger frame
        // arrives at the CLI, the issue is downstream of this gate.
        this.logger.log(
          `[trigger-gate] conversation.updated received conversationId=${String(event.aggregateId)} hasTriggersAgent=${String(Boolean(updatePayload.triggersAgent))} messageAdded=${String(updatePayload.update?.messageAdded)} eventId=${event.id}`,
        );
        this.logger.debug('[trigger-gate] conversation.updated diagnostic', {
          event: 'realtime_bridge.trigger_gate.diagnostic',
          eventId: event.id,
          conversationId: event.aggregateId,
          messageAdded: updatePayload.update?.messageAdded,
          hasTriggersAgent: Boolean(updatePayload.triggersAgent),
          triggerPromptType: updatePayload.triggersAgent?.promptType,
          triggerNodeId: updatePayload.triggersAgent?.nodeId,
          triggerMessageId: updatePayload.triggersAgent?.triggerMessageId,
        });
        if (
          updatePayload.triggersAgent &&
          !('operationId' in updatePayload.triggersAgent)
        ) {
          this.maybeEmitConversationTrigger(event);
        } else if (updatePayload.triggersAgent) {
          this.logger.debug(
            '[trigger-gate] projection-only operation trigger; durable dispatcher owns delivery',
            {
              eventId: event.id,
              operationId: updatePayload.triggersAgent.operationId,
              triggerMessageId: updatePayload.triggersAgent.triggerMessageId,
            },
          );
        }
      },
      [EVENT_TYPES.CONVERSATION.STATUS_CHANGED]: (event) => {
        const wsEvent = this.createConversationStatusChangedEvent(event);
        this.gateway.emitConversationStatusChanged(wsEvent);
      },
      [EVENT_TYPES.PROJECT.CREATED]: (event) => {
        const wsEvent = this.createProjectCreatedEvent(event);
        this.gateway.emitProjectCreated(wsEvent);
      },
      [EVENT_TYPES.PROJECT.UPDATED]: (event) => {
        if (isProjectEvents(event)) {
          const wsEvent = this.createProjectUpdatedEvent(event);
          this.gateway.emitProjectUpdated(wsEvent);
        }
      },
      [EVENT_TYPES.PROJECT.STATUS_CHANGED]: (event) => {
        if (isProjectEvents(event)) {
          const wsEvent = this.createProjectStatusChangedEvent(event);
          this.gateway.emitProjectStatusChanged(wsEvent);
        }
      },
      [EVENT_TYPES.INITIATIVE.CREATED]: (event) => {
        const wsEvent = this.createInitiativeCreatedEvent(event);
        this.gateway.emitInitiativeCreated(wsEvent);
      },
      [EVENT_TYPES.INITIATIVE.UPDATED]: (event) => {
        this.logger.log(
          '[RealtimeBridge] Processing initiative.updated domain event',
          {
            eventId: event.id,
            eventType: event.type,
            aggregateId: event.aggregateId,
            payloadKeys: Object.keys(event.payload || {}),
            extractedIds: this.extractIds(event),
          },
        );

        const wsEvent = this.createInitiativeUpdatedEvent(event);

        this.logger.log(
          '[RealtimeBridge] Created WebSocket event for initiative.updated',
          {
            wsEventType: wsEvent.type,
            wsEventInitiativeId: wsEvent.initiativeId,
            wsEventProjectId: wsEvent.projectId,
            wsEventConversationId: wsEvent.conversationId,
            wsEventTimestamp: wsEvent.timestamp,
            wsEventChangedFields: wsEvent.changedFields || [],
            wsEventTotalFieldsChanged: wsEvent.totalFieldsChanged || 0,
          },
        );

        this.gateway.emitInitiativeUpdated(wsEvent);
      },
      [EVENT_TYPES.INITIATIVE.CONTENT_CHANGED]: (event) => {
        const wsEvent = this.createInitiativeUpdatedEvent(event);
        this.gateway.emitInitiativeUpdated(wsEvent);
      },
      [EVENT_TYPES.INITIATIVE.STATUS_CHANGED]: (event) => {
        const wsEvent = this.createInitiativeStatusChangedEvent(event);
        this.gateway.emitInitiativeStatusChanged(wsEvent);
      },
      [EVENT_TYPES.TASK.CREATED]: (event) => {
        const wsEvent = this.createTaskCreatedEvent(event);
        this.gateway.emitTaskCreated(wsEvent);
      },
      [EVENT_TYPES.TASK.UPDATED]: (event) => {
        const wsEvent = this.createTaskUpdatedEvent(event);
        this.gateway.emitTaskUpdated(wsEvent);
      },
      [EVENT_TYPES.TASK.CONTENT_CHANGED]: (event) => {
        const wsEvent = this.createTaskContentChangedEvent(event);
        this.gateway.emitTaskUpdated(wsEvent);
      },
      [EVENT_TYPES.TASK.STATUS_CHANGED]: (event) => {
        const wsEvent = this.createTaskStatusChangedEvent(event);
        this.gateway.emitTaskStatusChanged(wsEvent);
      },
      [EVENT_TYPES.DESIGN_DOC.CREATED]: (event) => {
        const wsEvent = this.createDesignDocCreatedEvent(event);
        this.gateway.emitDesignDocCreated(wsEvent);
      },
      [EVENT_TYPES.DESIGN_DOC.UPDATED]: (event) => {
        const wsEvent = this.createDesignDocUpdatedEvent(event);
        this.gateway.emitDesignDocUpdated(wsEvent);
      },
      [EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED]: (event) => {
        const wsEvent = this.createDesignDocUpdatedEvent(event);
        this.gateway.emitDesignDocUpdated(wsEvent);
      },
      [EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED]: (event) => {
        const wsEvent = this.createDesignDocStatusChangedEvent(event);
        this.gateway.emitDesignDocStatusChanged(wsEvent);
      },
      [EVENT_TYPES.AGENT_SESSION.CREATED]: (event) => {
        const wsEvent = this.createAgentSessionCreatedEvent(event);
        this.gateway.emitAgentSessionCreated(wsEvent);
      },
      [EVENT_TYPES.AGENT_SESSION.DELETED]: (event) => {
        const wsEvent = this.createAgentSessionDeletedEvent(event);
        this.gateway.emitAgentSessionDeleted(wsEvent);
      },
      [EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED]: (event) => {
        const wsEvent = this.createAgentSessionStatusChangedEvent(event);
        this.gateway.emitAgentSessionStatusChanged(wsEvent);
      },
      [EVENT_TYPES.EVAL_RUN.UPDATED]: (event) => {
        this.gateway.emitEvalRunUpdated(event as EvalRunUpdatedEvent);
      },
      [EVENT_TYPES.EVAL_ATTEMPT.UPDATED]: (event) => {
        this.gateway.emitEvalAttemptUpdated(event as EvalAttemptUpdatedEvent);
      },
      [EVENT_TYPES.PROPOSAL.APPROVED]: (event) => {
        const wsEvent = this.createProposalApprovedEvent(event);
        this.gateway.emitProposalApproved(wsEvent);
      },
      [EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE]: (event) => {
        this.gateway.emitProposalGroupLifecycle(
          this.createProposalGroupLifecycleEvent(event),
        );
      },
      // TODO: Add WebSocket events for these when needed
      // [EVENT_TYPES.INITIATIVE.ARCHIVED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.INITIATIVE.PROJECT_LINKED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.INITIATIVE.PROJECT_UNLINKED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // TODO: Add WebSocket events for tasks when needed
      // [EVENT_TYPES.TASK.CREATED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.TASK.UPDATED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.TASK.STATUS_CHANGED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.TASK.ARCHIVED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.TASK.ASSIGNED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
      // [EVENT_TYPES.TASK.UNASSIGNED]: (event) => {
      //   // No corresponding WebSocket event yet
      // },
    };
    await Promise.all(
      Object.entries(handlers).map(([eventType, handler]) =>
        this.eventRouter.on(
          eventType as ServiceEventType,
          (envelope: EventEnvelope) => {
            try {
              const ids = this.extractIds(envelope.event);
              this.logger.debug(
                `RealtimeBridge processing event ${envelope.event.id}`,
                {
                  eventType,
                  eventId: envelope.event.id,
                  aggregateId: envelope.event.aggregateId,
                  projectId: ids.projectId,
                  conversationId: ids.conversationId,
                  organizationId: ids.organizationId,
                },
              );
              handler(envelope.event);
            } catch (err) {
              this.logger.error(
                `Failed to process realtime event ${eventType}`,
                err,
              );
            }
          },
        ),
      ),
    );
  }

  private extractIds(event: ServiceEvent) {
    return extractEventIds(event);
  }

  /**
   * Hand a conversation.updated event off to the trigger emitter. Callers
   * pre-gate on the payload's elevated `triggersAgent` envelope so this only
   * runs for actual trigger messages; the `messageAdded` check below is kept
   * as defense in depth. The emitter re-loads the message to read
   * `data.triggersAgent` and to resolve a recipient — so this stays a
   * fire-and-forget side channel that never blocks or breaks the
   * conversation.updated broadcast already emitted above.
   */
  private maybeEmitConversationTrigger(serviceEvent: ServiceEvent): void {
    const payload = serviceEvent.payload as ConversationUpdatedEventPayload;
    const messageAdded = payload.update?.messageAdded;
    if (!messageAdded) {
      this.logger.warn('[trigger-gate] DROP no messageAdded for trigger', {
        event: 'realtime_bridge.trigger_gate.drop',
        reason: 'missing_message_added',
        eventId: serviceEvent.id,
        conversationId: serviceEvent.aggregateId,
        hasTriggersAgent: Boolean(payload.triggersAgent),
        triggerPromptType: payload.triggersAgent?.promptType,
        triggerNodeId: payload.triggersAgent?.nodeId,
        triggerMessageId: payload.triggersAgent?.triggerMessageId,
      });
      return;
    }

    const conversationId = serviceEvent.aggregateId as ConversationId;
    this.logger.log('[trigger-gate] handing conversation trigger to emitter', {
      event: 'realtime_bridge.trigger_gate.emit_requested',
      eventId: serviceEvent.id,
      conversationId,
      messageId: messageAdded,
      triggerPromptType: payload.triggersAgent?.promptType,
      triggerNodeId: payload.triggersAgent?.nodeId,
      triggerMessageId: payload.triggersAgent?.triggerMessageId,
    });
    void this.triggerEmitter
      .emitConversationTriggerForMessage({
        conversationId,
        messageId: messageAdded as MessageId,
        organizationId: payload.organizationId,
        projectId: payload.projectId,
      })
      .catch((error) => {
        this.logger.error(
          `Failed to emit conversation trigger for conversation ${conversationId}`,
          error,
        );
      });
  }

  private shouldEmitMessageRealtime(
    payload: MessageRealtimeEventPayload,
  ): boolean {
    const sequenceKey = `${payload.organizationId}:${payload.requestId}:${payload.messageId}`;
    const lastSeenSequence =
      this.messageRealtimeSequenceByStream.get(sequenceKey);

    if (
      typeof lastSeenSequence === 'number' &&
      payload.sequence <= lastSeenSequence
    ) {
      return false;
    }

    this.messageRealtimeSequenceByStream.set(sequenceKey, payload.sequence);
    this.pruneRealtimeSequenceCache();
    return true;
  }

  private pruneRealtimeSequenceCache(): void {
    if (
      this.messageRealtimeSequenceByStream.size <=
      this.messageRealtimeSequenceLimit
    ) {
      return;
    }

    const oldestKey = this.messageRealtimeSequenceByStream.keys().next().value;
    if (oldestKey) {
      this.messageRealtimeSequenceByStream.delete(oldestKey);
    }
  }

  private requirePayloadField<T>(
    value: T | null | undefined,
    fieldName: string,
  ): T {
    if (value === undefined || value === null) {
      throw new Error(`message.realtime missing required field: ${fieldName}`);
    }
    return value;
  }
}
