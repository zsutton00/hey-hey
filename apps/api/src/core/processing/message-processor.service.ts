import { Inject, Injectable } from '@nestjs/common';

import { Client } from '@temporalio/client';
import type Redis from 'ioredis';
import {
  FlowNodeCompleteEvent,
  hasOnboardingReplyDelivery,
  hasRepositoryImportReplyDelivery,
  MessageCreatedEvent,
  MessageProcessorErrorEvent,
  MessageUpdatedEvent,
} from 'src/core/events/types/domain-events';
import { RedisService } from 'src/core/redis/redis.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  WorkflowId,
} from 'src/types';
import { MessageStatus } from '../../constants/message-status.constants';
import {
  AgentSystemMessageData,
  ErrorSystemMessageData,
  ExternalAgentNodeCompletion,
  MessageRecordDto,
  MessageResponseDto,
  SystemMessage,
  SystemMessageData,
  SystemMessageResponseType,
  UserMessage,
  UserMessageData,
} from '../../generated';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import { MessageService } from '../../services/message.service';
import {
  ExternalAgentFlowData,
  QuestionsActionFlowData,
  FlowUserMessage,
  NodeType,
} from '../../types/flow-internal.types';
import { WorkflowSignals } from '../../utils/workflow-signals.util';

/**
 * Rolling-window circuit breaker for EXTERNAL_AGENT completions.
 *
 * Threshold is the maximum number of completions accepted for a given
 * (conversationId, nodeId) pair inside the rolling window before the
 * breaker opens. Subsequent completions are dropped without signaling
 * Temporal, capping token burn from any runaway self-loop that slips past
 * park logic.
 *
 * Implementation is a fixed-window counter: first INCR in a window seeds
 * an EXPIRE; the key auto-expires when the window elapses. Good enough
 * for a safety net — we don't need ZSET-level precision.
 */
const EXTERNAL_AGENT_COMPLETION_BREAKER_THRESHOLD = 3;
const EXTERNAL_AGENT_COMPLETION_BREAKER_WINDOW_SECONDS = 10;
const EXTERNAL_AGENT_COMPLETION_BREAKER_KEY_PREFIX =
  'external-agent-completion-breaker';

// Event system imports
import { ConversationStatus } from '@prisma/client';
import { ConversationService } from 'src/services/conversation.service';
import { ConversationWorkflowService } from 'src/services/workflows/conversation-workflow.service';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import { MessageResponseUtil } from 'src/utils/message-response.util';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { EventRouter } from '../events/event-router';
import { WithWorkflowContext } from '../events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import { EVENT_TYPES } from '../events/types/event.types';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import { isTimelineMessage } from 'src/mappers/message.mapper';

/**
 * Job Processor handles the actual processing of jobs and related events.
 * This service should only be initialized in the main application context,
 * not in the worker context to avoid duplication.
 */

const MessageProcessorSet = new Set<MessageProcessor>();

@Injectable()
export class MessageProcessor {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(MessageProcessor.name);

  private readonly redisClient: Redis;

  constructor(
    // Core dependencies for workflow signaling
    private messageService: MessageService,
    @InjectTemporalClient() private temporalClient: Client,
    private eventRouter: EventRouter,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    private conversationService: ConversationService,
    private flowExecutionService: FlowExecutionService,
    private conversationWorkflowService: ConversationWorkflowService,
    private nodeExecutionService: NodeExecutionService,
    private readonly redisService: RedisService,
  ) {
    this.redisClient = this.redisService.getClient();

    // Enhanced singleton validation
    if (MessageProcessorSet.has(this)) {
      throw new Error(
        'Multiple MessageProcessor instances detected. ' +
          'This service must be a singleton to prevent duplicate event processing.',
      );
    }
    MessageProcessorSet.add(this);

    // Comprehensive dependency validation
    this.validateDependencies();

    this.logger.log('MessageProcessor initialized for workflow signaling', {
      count: MessageProcessorSet.size,
    });
  }

  /**
   * Validate all required dependencies are provided
   */
  private validateDependencies(): void {
    const dependencies = {
      messageService: this.messageService,
      temporalClient: this.temporalClient,
      eventRouter: this.eventRouter,
      eventPublisher: this.eventPublisher,
      redisService: this.redisService,
    };

    const missingDependencies = Object.entries(dependencies)
      .filter(([_, service]) => !service)
      .map(([name]) => name);

    if (missingDependencies.length > 0) {
      throw new Error(
        `MessageProcessor missing required dependencies: ${missingDependencies.join(', ')}`,
      );
    }
  }

  /**
   * Single entry point for handling MESSAGE.CREATED events
   * Routes user messages to workflow signaling
   *
   * @param envelope - Event envelope containing the MessageCreatedEvent
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [MessageCreatedEvent];
    return {
      sourceService: 'MessageProcessor',
      sourceMethod: 'handleMessageCreatedEvent',
      context: event.payload,
      metadata: {
        nodeId: event.payload.nodeId,
        requestId: event.payload.requestId,
      },
    };
  })
  async handleMessageCreatedEvent(event: MessageCreatedEvent): Promise<void> {
    this.logger.log('Processing MESSAGE.CREATED event', {
      eventId: event.id,
      messageId: event.aggregateId,
      messageType: event.payload.message.type,
      conversationId: event.payload.message.conversationId,
      organizationId: event.payload.organizationId,
      workflowId: event.payload.workflowId,
    });

    // Route based on message type
    if (event.payload.message.type === 'USER') {
      // Handle user messages - workflow signaling only
      // Each workflow handles its own classification needs
      await this.handleUserMessageCreated(event);
    } else if (event.payload.message.type === 'SYSTEM') {
      // Workflow-emitted SYSTEM messages must stay a no-op — signaling them
      // would ricochet LLM-classified AGENT messages back into the workflow.
      // Only messages that carry the typed completesExternalAgentNode
      // discriminator re-enter the signaling rail. The producer elevates
      // that envelope onto the event root at publish time, so this is a
      // typed top-level read — no `data` blob unpacking, no structural probe.
      const completion = event.payload.completesExternalAgentNode;
      if (completion) {
        await this.handleExternalAgentCompletionCreated(event, completion);
      } else {
        this.logger.debug('System message created - no processing needed', {
          eventId: event.id,
          messageId: event.aggregateId,
        });
      }
    }
  }

  @WithWorkflowContext((...args) => {
    const [event] = args as [FlowNodeCompleteEvent];
    return {
      sourceService: 'MessageProcessor',
      sourceMethod: 'handleFlowNodeCompletedEvent',
      context: event.payload,
      metadata: {
        nodeId: event.payload.nodeId,
        nodeType: event.payload.nodeType,
        requestId: event.payload.requestId,
      },
    };
  })
  async handleFlowNodeCompletedEvent(
    event: FlowNodeCompleteEvent,
  ): Promise<void> {
    const {
      systemMessageData,
      organizationId,
      requestId,
      nodeId,
      status,
      conversationId,
      workflowId,
    } = event.payload;

    let requiredRequestId: string | undefined;
    let requiredOrganizationId: OrganizationId | undefined;
    let requiredConversationId: ConversationId | undefined;
    let requiredWorkflowId: WorkflowId | undefined;

    try {
      this.logger.debug(`handleFlowNodeCompletedEvent for eventId ${event.id}`);

      if (!systemMessageData) {
        this.logger.warn(
          `No system message data found for flow node completion event ${event.payload.requestId}`,
        );
        return;
      }

      systemMessageData.nodeId = nodeId;

      // Determine final message status
      const messageStatus =
        status === 'success'
          ? MessageResponseUtil.determineMessageStatus(systemMessageData)
          : MessageStatus.Failed;

      if (!requestId || !organizationId || !conversationId || !workflowId) {
        this.logger.error(
          'Missing required identifiers for flow node completion handling',
          { requestId, organizationId, conversationId, workflowId },
        );
        return;
      }

      requiredRequestId = requestId;
      requiredOrganizationId = organizationId;
      requiredConversationId = conversationId;
      requiredWorkflowId = workflowId;

      await this.messageService.updateSystemMessageWithLLMResponse({
        systemMessageData,
        organizationId: requiredOrganizationId,
        requestId: requiredRequestId,
        status: messageStatus,
      });

      await this.conversationService.updateConversationInternal(
        requiredConversationId,
        requiredOrganizationId,
        {
          status: ConversationStatus.IN_PROGRESS,
        },
      );
    } catch (error) {
      if (
        !requiredRequestId ||
        !requiredOrganizationId ||
        !requiredConversationId ||
        !requiredWorkflowId
      ) {
        this.logger.error(
          'Missing required identifiers while handling flow node completion error',
          { requestId, organizationId, conversationId, workflowId },
        );
        return;
      }

      this.logger.error(
        `Error handling flow node completion event for request ${event.payload.requestId}:`,
        error,
      );

      // Publish error event for timeline tracking
      const errorEvent: Omit<MessageProcessorErrorEvent, 'id'> = {
        type: EVENT_TYPES.MESSAGE_PROCESSOR.ERROR,
        aggregateId: requiredRequestId,
        payload: {
          payloadType: EVENT_TYPES.MESSAGE_PROCESSOR.ERROR,
          requestId: requiredRequestId,
          organizationId: requiredOrganizationId,
          conversationId: requiredConversationId,
          workflowId: requiredWorkflowId,
          nodeId: event.payload.nodeId,
          projectId: event.payload.projectId,
          error: (error as Error).message,
          errorStack: (error as Error).stack,
          errorName: (error as Error).name,
          operation: 'handleFlowNodeCompletedEvent',
          timestamp: new Date().toISOString(),
        },
      };
      await this.eventPublisher.publish(errorEvent);
    }
  }

  /**
   * Handle user message creation - workflow signaling only
   * Each workflow handles its own classification needs
   *
   * @param event - MessageCreatedEvent
   */
  private async handleUserMessageCreated(
    event: MessageCreatedEvent,
  ): Promise<void> {
    const messageCreateData = event.payload?.message;
    const workflowId = event.payload?.workflowId;

    if (!messageCreateData || messageCreateData.type !== 'USER') {
      this.logger.debug(
        '[handleUserMessageCreated] skipping - not a USER message or missing data',
        {
          messageId: event.aggregateId,
          messageType: messageCreateData?.type,
          hasMessageData: !!messageCreateData,
        },
      );
      return;
    }

    this.logger.log('[handleUserMessageCreated] starting', {
      messageId: event.aggregateId,
      workflowId,
      conversationId: messageCreateData.conversationId,
      parentMessageId: messageCreateData.parentMessageId,
      messageType: messageCreateData.type,
    });

    if (
      hasOnboardingReplyDelivery(event) ||
      hasRepositoryImportReplyDelivery(event)
    ) {
      const organizationId = event.payload.organizationId;
      const storedMessage = await this.messageService.getMessage(
        event.aggregateId,
        organizationId,
      );
      if (!storedMessage) {
        throw new Error(
          `Admitted workflow reply message ${event.aggregateId} was not found`,
        );
      }
      // Workflow replies are written dated; only executable inputs queue.
      if (!isTimelineMessage(storedMessage)) {
        throw new Error(
          `Admitted workflow reply message ${event.aggregateId} is an undated queued input`,
        );
      }
      await this.handleParentMessageCompletion(storedMessage, organizationId);
      const delivery = hasOnboardingReplyDelivery(event)
        ? event.payload.onboardingReplyDelivery
        : (
            event.payload as unknown as {
              repositoryImportReplyDelivery: {
                workflowId?: WorkflowId;
                nodeId: string;
              };
            }
          ).repositoryImportReplyDelivery;
      const { workflowId } = delivery;
      if (workflowId) {
        await this.signalWorkflow(
          storedMessage,
          event.aggregateId,
          workflowId,
          organizationId,
          true,
        );
      } else {
        const conversation = await this.conversationService.findOne(
          storedMessage.conversationId as ConversationId,
          organizationId,
        );
        if (conversation?.workflowId) {
          await this.signalWorkflow(
            storedMessage,
            event.aggregateId,
            conversation.workflowId as WorkflowId,
            organizationId,
            true,
          );
        } else {
          const resumed = await this.attemptResumeFromPaused(
            storedMessage,
            event.aggregateId,
            organizationId,
          );
          if (!resumed) {
            throw new Error(
              `Admitted workflow reply ${event.aggregateId} could not resume its workflow`,
            );
          }
        }
      }
      return;
    }

    try {
      const organizationId = event.payload.organizationId;
      const storedMessage = await this.messageService.getMessage(
        event.aggregateId,
        organizationId,
      );

      if (!storedMessage) {
        this.logger.error('❌ STORED MESSAGE NOT FOUND', {
          messageId: event.aggregateId,
        });
        return;
      }

      await this.handleParentMessageCompletion(storedMessage, organizationId);
    } catch (error) {
      this.logger.error(
        `[handleUserMessageCreated] FAILED TO PROCESS USER MESSAGE EVENT ${event.aggregateId}:`,
        error,
      );
    }
  }

  /**
   * Handle an EXTERNAL_AGENT completion message posted by an external agent
   * (e.g. the CLI) via POST /message. Verifies the conversation is paused on
   * the declared EXTERNAL_AGENT node, then reuses the existing signaling
   * infrastructure (signalWorkflow / attemptResumeFromPaused) so the
   * workflow-side validator (validateExternalAgentCompletion /
   * resolveExternalAgentRouting) receives the message.
   */
  private async handleExternalAgentCompletionCreated(
    event: MessageCreatedEvent,
    completion: ExternalAgentNodeCompletion,
  ): Promise<void> {
    const organizationId = event.payload.organizationId;

    this.logger.log('[handleExternalAgentCompletionCreated] starting', {
      messageId: event.aggregateId,
      conversationId: event.payload.message.conversationId,
      declaredNodeId: completion.nodeId,
      action: completion.action,
      hasPayload: completion.payload !== undefined,
    });

    try {
      const storedMessage = await this.messageService.getMessage(
        event.aggregateId,
        organizationId,
      );

      if (!storedMessage) {
        this.logger.error(
          '[handleExternalAgentCompletionCreated] stored message not found',
          { messageId: event.aggregateId },
        );
        return;
      }
      // Agent-posted completions are written dated; only executable inputs queue.
      if (!isTimelineMessage(storedMessage)) {
        throw new Error(
          `External agent completion ${event.aggregateId} is an undated queued input`,
        );
      }

      const conversationId = storedMessage.conversationId as ConversationId;

      // Server-side guard: completion is only valid if the conversation has a
      // resumable flow execution on an EXTERNAL_AGENT node whose id matches
      // the declared nodeId. An EXTERNAL_AGENT workflow is typically
      // IN_PROGRESS (blocked inside Temporal on `condition()`); PAUSED
      // occurs after a user-wait timeout, and COMPLETED+resumable after a
      // long pause was wound down to save Temporal resources. All four
      // states are accepted here — when the live workflow is gone, the
      // signal-path falls through to attemptResumeFromPaused. Mismatches
      // (stale CLI, wrong node, node type drift) are rejected without
      // signaling.
      const activeExecution =
        await this.flowExecutionService.findActiveByConversation(
          conversationId,
          organizationId,
        );

      if (!activeExecution) {
        await this.rejectExternalAgentCompletion(
          storedMessage,
          organizationId,
          'no_active_execution',
          {
            declaredNodeId: completion.nodeId,
            conversationId,
          },
        );
        return;
      }

      if (activeExecution.currentNode !== completion.nodeId) {
        await this.rejectExternalAgentCompletion(
          storedMessage,
          organizationId,
          'node_id_mismatch',
          {
            declaredNodeId: completion.nodeId,
            currentNodeId: activeExecution.currentNode,
            executionId: activeExecution.id,
          },
        );
        return;
      }

      const nodeData = this.nodeExecutionService.getNode(
        activeExecution.flowId,
        completion.nodeId,
      );

      if (!nodeData || nodeData.node.type !== NodeType.EXTERNAL_AGENT) {
        await this.rejectExternalAgentCompletion(
          storedMessage,
          organizationId,
          'node_not_external_agent',
          {
            declaredNodeId: completion.nodeId,
            resolvedNodeType: nodeData?.node.type ?? null,
            flowId: activeExecution.flowId,
            executionId: activeExecution.id,
          },
        );
        return;
      }

      // Rolling-window circuit breaker: count completions that pass all
      // validity guards and would actually signal Temporal. Rejections
      // above are not counted so a legitimate stream of stale CLI
      // messages cannot trip the breaker on its own.
      const breakerState = await this.registerCompletionAndCheckBreaker(
        conversationId,
        completion.nodeId,
      );
      if (breakerState.open) {
        await this.rejectExternalAgentCompletion(
          storedMessage,
          organizationId,
          'circuit_breaker_open',
          {
            declaredNodeId: completion.nodeId,
            conversationId,
            count: breakerState.count,
            thresholdPerWindow: EXTERNAL_AGENT_COMPLETION_BREAKER_THRESHOLD,
            windowSeconds: EXTERNAL_AGENT_COMPLETION_BREAKER_WINDOW_SECONDS,
          },
        );
        await this.writeCircuitBreakerSystemMessage(
          storedMessage,
          organizationId,
          completion.nodeId,
          breakerState.count,
        );
        return;
      }

      const conversation = await this.conversationService.findOne(
        conversationId,
        organizationId,
      );

      // Flatten the typed API discriminator (data.completesExternalAgentNode)
      // onto the top-level engine wire shape (data.action / data.payload)
      // that validateExternalAgentCompletion and node processUserResponse
      // expect. The stored DB row keeps the typed shape; only the in-memory
      // signal payload is flattened.
      const signalMessage = this.buildExternalAgentSignalMessage(
        storedMessage,
        completion,
      );

      if (conversation?.workflowId) {
        this.logger.log(
          '[handleExternalAgentCompletionCreated] signaling active workflow',
          {
            messageId: event.aggregateId,
            conversationId,
            workflowId: conversation.workflowId,
            nodeId: completion.nodeId,
            action: completion.action,
            executionStatus: activeExecution.status,
          },
        );
        await this.signalWorkflow(
          signalMessage,
          event.aggregateId,
          conversation.workflowId as WorkflowId,
          organizationId,
        );
        return;
      }

      this.logger.log(
        '[handleExternalAgentCompletionCreated] no active workflow - resuming from paused execution',
        {
          messageId: event.aggregateId,
          conversationId,
          executionId: activeExecution.id,
          executionStatus: activeExecution.status,
          nodeId: completion.nodeId,
          action: completion.action,
        },
      );
      const resumed = await this.attemptResumeFromPaused(
        signalMessage,
        event.aggregateId,
        organizationId,
      );
      if (!resumed) {
        this.logger.warn(
          '[handleExternalAgentCompletionCreated] resume from paused failed',
          {
            messageId: event.aggregateId,
            conversationId,
            executionId: activeExecution.id,
          },
        );
      }
    } catch (error) {
      this.logger.error(
        `[handleExternalAgentCompletionCreated] FAILED TO PROCESS EXTERNAL_AGENT COMPLETION ${event.aggregateId}:`,
        error,
      );
    }
  }

  /**
   * Translate the typed API discriminator into the engine-local wire shape.
   *
   * The stored message carries `data.completesExternalAgentNode` (typed
   * `ExternalAgentNodeCompletion`); the engine reads `data.action` and
   * `data.payload` at the top level via `ExternalAgentFlowData`. We build a
   * shallow-cloned message whose `data` satisfies both shapes: the typed
   * fields are flattened for the engine, and all other fields (including
   * the original `completesExternalAgentNode`) pass through untouched.
   */
  private buildExternalAgentSignalMessage(
    storedMessage: MessageResponseDto,
    completion: ExternalAgentNodeCompletion,
  ): MessageResponseDto {
    const existingData = storedMessage.data as AgentSystemMessageData;
    const payload = this.normalizeExternalAgentCompletionPayload(
      existingData,
      completion,
    );
    const flattenedData: ExternalAgentFlowData = {
      ...existingData,
      action: completion.action,
      payload,
    };
    return {
      ...storedMessage,
      data: flattenedData,
    } as unknown as MessageResponseDto;
  }

  private normalizeExternalAgentCompletionPayload(
    existingData: AgentSystemMessageData,
    completion: ExternalAgentNodeCompletion,
  ): ExternalAgentNodeCompletion['payload'] {
    if (completion.payload !== undefined) {
      return completion.payload;
    }

    if (completion.action !== 'ERROR') {
      return undefined;
    }

    const message =
      typeof existingData.response === 'string'
        ? existingData.response.trim()
        : '';
    if (message.length === 0) {
      return undefined;
    }

    return {
      reason: 'agent_submission_error',
      message,
    };
  }

  /**
   * Translate a QUESTIONS field-action submission into the engine-local wire
   * shape AND classify what shape the submission arrived in. The browser
   * submits a button click as
   *   data: { [fieldId]: { action, payload } }
   * keyed by the rendered UIElement's id. The engine reads `data.action`
   * and `data.payload` at the top level via `QuestionsActionFlowData`. We
   * find the single field-keyed entry whose value carries an `action`
   * string and lift its `action` / `payload` to top-level.
   *
   * The return carries both the (possibly rewritten) signal message and a
   * `kind` discriminator so consumers don't have to re-inspect `data` to
   * answer "is this action-bearing?". Centralizing the classification here
   * keeps every downstream decision — the signal Temporal receives, the
   * triggersAgent emit gate, any future routing — in lockstep with one
   * source of truth. Idempotent:
   * - already-flat data (top-level `action` set) returns `kind: 'flat-action'`
   *   and the message unchanged so the EXTERNAL_AGENT pre-flatten path
   *   passes through;
   * - field-keyed action data returns `kind: 'lifted-action'` and the
   *   rewritten message;
   * - non-action submissions (e.g. free-text only) return `kind: 'no-action'`
   *   and the message unchanged so QUESTIONS gates without buttons are
   *   unaffected.
   * The DB row is never mutated; only the in-memory signal payload changes.
   */
  private classifyAndBuildQuestionsActionSignalMessage(
    storedMessage: MessageResponseDto,
  ): {
    message: MessageResponseDto;
    kind: 'flat-action' | 'lifted-action' | 'no-action';
  } {
    const data = storedMessage.data as
      | Partial<QuestionsActionFlowData>
      | undefined;
    if (!data) return { message: storedMessage, kind: 'no-action' };
    if (typeof data.action === 'string') {
      return { message: storedMessage, kind: 'flat-action' };
    }
    for (const value of Object.values(data)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as Partial<QuestionsActionFlowData>).action === 'string'
      ) {
        const entry = value as { action: string; payload?: unknown };
        const flattened: QuestionsActionFlowData = {
          ...data,
          action: entry.action,
          payload: entry.payload,
        };
        return {
          message: {
            ...storedMessage,
            data: flattened,
          } as unknown as MessageResponseDto,
          kind: 'lifted-action',
        };
      }
    }
    return { message: storedMessage, kind: 'no-action' };
  }

  /**
   * Mark an EXTERNAL_AGENT completion message as failed so the CLI/UI can
   * surface the rejection reason, and emit a structured warn log. No
   * Temporal signal is sent; the workflow remains on its current node.
   */
  private async rejectExternalAgentCompletion(
    storedMessage: MessageResponseDto,
    organizationId: OrganizationId,
    reason:
      | 'no_active_execution'
      | 'node_id_mismatch'
      | 'node_not_external_agent'
      | 'circuit_breaker_open',
    details: Record<string, unknown>,
  ): Promise<void> {
    this.logger.warn(
      '[handleExternalAgentCompletionCreated] rejecting completion',
      {
        messageId: storedMessage.id,
        conversationId: storedMessage.conversationId,
        reason,
        ...details,
      },
    );

    try {
      await this.messageService.updateMessage(
        storedMessage.id,
        organizationId,
        { status: MessageStatus.Failed },
        { source: 'handleExternalAgentCompletionCreated' },
      );
    } catch (error) {
      this.logger.error(
        '[handleExternalAgentCompletionCreated] failed to mark message as failed',
        {
          messageId: storedMessage.id,
          reason,
          error: error instanceof Error ? error.message : error,
        },
      );
    }
  }

  /**
   * Increment the (conversationId, nodeId) completion counter in Redis
   * and report whether the rolling-window threshold has been exceeded.
   *
   * Uses a fixed-window counter: the first INCR of a window seeds a TTL
   * via EXPIRE; subsequent increments share the remaining window before
   * the key auto-expires. A Redis outage fails open (returns count=0,
   * open=false) so the breaker can never be the sole reason a completion
   * fails — the signal path remains the primary failure surface.
   */
  private async registerCompletionAndCheckBreaker(
    conversationId: ConversationId,
    nodeId: string,
  ): Promise<{ open: boolean; count: number }> {
    const key = `${EXTERNAL_AGENT_COMPLETION_BREAKER_KEY_PREFIX}:${conversationId}:${nodeId}`;
    try {
      const count = await this.redisClient.incr(key);
      if (count === 1) {
        await this.redisClient.expire(
          key,
          EXTERNAL_AGENT_COMPLETION_BREAKER_WINDOW_SECONDS,
        );
      }
      const open = count > EXTERNAL_AGENT_COMPLETION_BREAKER_THRESHOLD;
      if (open) {
        this.logger.warn(
          '[handleExternalAgentCompletionCreated] circuit breaker open',
          {
            conversationId,
            nodeId,
            count,
            thresholdPerWindow: EXTERNAL_AGENT_COMPLETION_BREAKER_THRESHOLD,
            windowSeconds: EXTERNAL_AGENT_COMPLETION_BREAKER_WINDOW_SECONDS,
          },
        );
      }
      return { open, count };
    } catch (error) {
      this.logger.error(
        '[handleExternalAgentCompletionCreated] circuit breaker redis failure — failing open',
        {
          conversationId,
          nodeId,
          error: error instanceof Error ? error.message : error,
        },
      );
      return { open: false, count: 0 };
    }
  }

  /**
   * Write a SYSTEM error message to the conversation when the circuit
   * breaker fires, so the UI/CLI have a visible breadcrumb explaining
   * why the completion was not signaled to Temporal.
   */
  private async writeCircuitBreakerSystemMessage(
    storedMessage: MessageResponseDto,
    organizationId: OrganizationId,
    nodeId: string,
    count: number,
  ): Promise<void> {
    try {
      const errorData: ErrorSystemMessageData & {
        externalAgentCircuitBreaker: {
          reason: 'completion_rate_exceeded';
          count: number;
          thresholdPerWindow: number;
          windowSeconds: number;
          conversationId: ConversationId;
          nodeId: string;
        };
      } = {
        type: SystemMessageResponseType.Error,
        nodeId,
        response:
          'External agent completion rate exceeded the safety threshold — ' +
          'further completions for this node will be dropped for a short ' +
          'cooldown. This usually indicates a loop in the agent.',
        detectedIntent: 'external_agent_circuit_breaker',
        intentConfidence: 1.0,
        reasoning:
          `Received more than ${EXTERNAL_AGENT_COMPLETION_BREAKER_THRESHOLD} ` +
          `EXTERNAL_AGENT completions for the same node within ` +
          `${EXTERNAL_AGENT_COMPLETION_BREAKER_WINDOW_SECONDS}s.`,
        errorType: 'external_agent_circuit_breaker_open',
        temporary: true,
        externalAgentCircuitBreaker: {
          reason: 'completion_rate_exceeded',
          count,
          thresholdPerWindow: EXTERNAL_AGENT_COMPLETION_BREAKER_THRESHOLD,
          windowSeconds: EXTERNAL_AGENT_COMPLETION_BREAKER_WINDOW_SECONDS,
          conversationId: storedMessage.conversationId as ConversationId,
          nodeId,
        },
      };

      await this.messageService.appendMessageToConversation(
        storedMessage.conversationId as ConversationId,
        {
          type: 'SYSTEM',
          projectId: storedMessage.projectId,
          userId: 'system',
          status: MessageStatus.Completed,
          data: errorData as unknown as SystemMessageData,
        },
        organizationId,
        'handleExternalAgentCompletionCreated:circuit_breaker_open',
      );
    } catch (error) {
      this.logger.error(
        '[handleExternalAgentCompletionCreated] failed to write circuit breaker SYSTEM message',
        {
          messageId: storedMessage.id,
          conversationId: storedMessage.conversationId,
          nodeId,
          error: error instanceof Error ? error.message : error,
        },
      );
    }
  }

  @WithWorkflowContext((...args) => {
    const [event] = args as [MessageUpdatedEvent];
    return {
      sourceService: 'MessageProcessor',
      sourceMethod: 'handleUserMessageUpdatedEvent',
      context: event.payload,
      metadata: {
        operationType: 'userMessageUpdate',
        requestId: event.payload.requestId,
      },
    };
  })
  async handleUserMessageUpdatedEvent(
    _event: MessageUpdatedEvent,
  ): Promise<void> {
    // STUB
  }

  /**
   * Runs for every message type. Status, execution projection, cancellation
   * and parent rewiring publish without content changes and must not make an
   * older message the session's latest.
   */
  async advanceContentUpdatedAtOnContentChange(
    event: MessageUpdatedEvent,
  ): Promise<void> {
    if (!event.payload.update?.contentChanged) {
      this.logger.debug(
        '[MESSAGE_PROCESSOR] Message update has no content change; contentUpdatedAt unchanged',
        { messageId: event.aggregateId },
      );
      return;
    }

    await this.messageService.advanceContentUpdatedAt(
      event.aggregateId as MessageId,
      event.payload.organizationId,
    );
  }

  @WithWorkflowContext((...args) => {
    const [event] = args as [MessageUpdatedEvent];
    return {
      sourceService: 'MessageProcessor',
      sourceMethod: 'handleSystemMessageUpdatedEvent',
      context: event.payload,
      metadata: {
        nodeId: event.payload.nodeId,
        requestId: event.payload.requestId,
        operationType: 'systemMessageUpdate',
      },
    };
  })
  async handleSystemMessageUpdatedEvent(
    event: MessageUpdatedEvent,
  ): Promise<void> {
    const messageUpdateData = event.payload?.update;

    if (!messageUpdateData || !event.payload.organizationId) {
      this.logger.debug(
        '[MESSAGE_PROCESSOR] Skipping system message update - missing data',
        {
          messageId: event.aggregateId,
          hasUpdateData: !!messageUpdateData,
          hasOrganizationId: !!event.payload.organizationId,
        },
      );
      return;
    }

    this.logger.log(
      '[MESSAGE_PROCESSOR] Processing system message updated event',
      {
        messageId: event.aggregateId,
        updateData: messageUpdateData,
        organizationId: event.payload.organizationId,
        updateFields: Object.keys(messageUpdateData),
        timestamp: new Date().toISOString(),
      },
    );

    try {
      // Get the updated system message
      const organizationId = event.payload.organizationId;

      this.logger.debug('[MESSAGE_PROCESSOR] Fetching updated system message', {
        messageId: event.aggregateId,
        organizationId,
      });

      const updatedMessage = await this.messageService.getMessage(
        event.aggregateId,
        organizationId,
      );

      if (!updatedMessage || updatedMessage.type !== 'SYSTEM') {
        this.logger.debug(
          '[MESSAGE_PROCESSOR] Skipping - not a system message or not found',
          {
            messageId: event.aggregateId,
            messageFound: !!updatedMessage,
            messageType: updatedMessage?.type,
          },
        );
        return;
      }

      this.logger.debug(
        '[MESSAGE_PROCESSOR] System message retrieved for processing',
        {
          messageId: updatedMessage.id,
          status: updatedMessage.status,
          type: updatedMessage.type,
          hasParentMessage: !!updatedMessage.parentMessageId,
          parentMessageId: updatedMessage.parentMessageId,
          conversationId: updatedMessage.conversationId,
        },
      );

      // Check if this system message was updated from system_processing to open/completed
      // AND it has a parent message that should be marked complete
      if (
        updatedMessage.status === MessageStatus.Open ||
        updatedMessage.status === MessageStatus.Completed ||
        updatedMessage.status === MessageStatus.StreamingReady
      ) {
        if (updatedMessage.parentMessageId) {
          const parentMessage = await this.messageService.getMessage(
            updatedMessage.parentMessageId,
            organizationId,
          );

          this.logger.debug(
            `Found parent message ${parentMessage?.id} for updated system message`,
            {
              parentMessageType: parentMessage?.type,
              parentMessageStatus: parentMessage?.status,
              awaitingResponse: (parentMessage as SystemMessage)
                ?.awaitingResponse,
            },
          );

          // If the parent is a system message that isn't completed, mark it as completed
          if (
            parentMessage?.type === 'SYSTEM' &&
            parentMessage?.status !== MessageStatus.Completed
          ) {
            await this.messageService.updateMessage(
              parentMessage.id,
              organizationId,
              {
                status: MessageStatus.Completed,
              },
              {
                source: 'handleSystemMessageUpdatedEvent',
                suppressConversationEvent: true,
              },
            );

            this.logger.log(
              '[MESSAGE_PROCESSOR] Marked parent system message as completed',
              {
                parentMessageId: parentMessage.id,
                updatedSystemMessageId: updatedMessage.id,
                reason: 'system_message_processing_complete',
                parentPreviousStatus: parentMessage.status,
                conversationId: updatedMessage.conversationId,
                timestamp: new Date().toISOString(),
              },
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `[MESSAGE_PROCESSOR] Failed to process system message update event`,
        {
          messageId: event.aggregateId,
          error: (error as Error).message,
          errorStack: (error as Error).stack,
          organizationId: event.payload.organizationId,
          updateData: messageUpdateData,
          timestamp: new Date().toISOString(),
        },
      );
    }
  }

  @WithWorkflowContext((...args) => {
    const [messageId, organizationId] = args as [string, OrganizationId];
    return {
      sourceService: 'MessageProcessor',
      sourceMethod: 'getMessageType',
      context: {
        organizationId,
        messageId: messageId as MessageId,
      },
      metadata: {
        operationType: 'getMessageType',
      },
    };
  })
  async getMessageType(
    messageId: string,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    const message = await this.messageService.getMessage(
      messageId,
      organizationId,
    );
    return message?.type || null;
  }

  private async handleParentMessageCompletion(
    storedMessage: MessageRecordDto,
    organizationId: OrganizationId,
  ): Promise<MessageRecordDto | null> {
    if (!storedMessage.parentMessageId) {
      this.logger.debug('[handleParentMessageCompletion] no parentMessageId', {
        messageId: storedMessage.id,
      });
      return null;
    }

    const parentMessage = await this.messageService.getMessage(
      storedMessage.parentMessageId,
      organizationId,
    );

    if (!parentMessage) {
      this.logger.warn(
        '[handleParentMessageCompletion] parent message not found',
        {
          messageId: storedMessage.id,
          parentMessageId: storedMessage.parentMessageId,
        },
      );
      return null;
    }

    this.logger.debug(`Found parent message ${parentMessage.id}`, {
      parentMessageType: parentMessage.type,
      parentMessageStatus: parentMessage.status,
      awaitingResponse: (parentMessage as SystemMessage)?.awaitingResponse,
    });

    if (
      parentMessage.type === 'SYSTEM' &&
      parentMessage.status !== MessageStatus.Completed
    ) {
      await this.messageService.updateMessage(
        parentMessage.id,
        organizationId,
        {
          status: MessageStatus.Completed,
        },
        {
          source: 'handleUserMessageCreatedEvent',
          suppressConversationEvent: true,
        },
      );
    }

    return parentMessage;
  }

  /**
   * Check if the conversation has a PAUSED flow execution and resume it by
   * starting a new Temporal workflow. The existing initializeWorkflowState
   * restore path rebuilds full state from the saved flowState.
   *
   * Uses an atomic compare-and-swap (PAUSED → IN_PROGRESS) to prevent
   * duplicate workflows when concurrent messages arrive.
   */
  private async attemptResumeFromPaused(
    storedMessage: MessageResponseDto,
    messageId: string,
    organizationId: OrganizationId,
  ): Promise<boolean> {
    const conversationId = storedMessage.conversationId as ConversationId;

    const pausedExecution =
      await this.flowExecutionService.findPausedByConversation(
        conversationId,
        organizationId,
      );

    if (!pausedExecution) {
      return false;
    }

    if (!pausedExecution.flowState) {
      this.logger.warn(
        '[attemptResumeFromPaused] Paused execution has no saved flowState',
        { executionId: pausedExecution.id, conversationId },
      );
      return false;
    }

    this.logger.log(
      '[attemptResumeFromPaused] Found paused flow execution - resuming',
      {
        executionId: pausedExecution.id,
        conversationId,
        messageId,
        currentNode: pausedExecution.currentNode,
      },
    );

    const conversation = await this.conversationService.findOne(
      conversationId,
      organizationId,
    );

    if (!conversation?.workflowName) {
      this.logger.warn(
        '[attemptResumeFromPaused] Conversation missing workflowName',
        { conversationId },
      );
      return false;
    }

    // Atomically claim the paused execution (PAUSED → IN_PROGRESS).
    // If another message already claimed it, this returns null.
    const claimed = await this.flowExecutionService.tryClaimPausedExecution(
      pausedExecution.id,
      organizationId,
    );

    if (!claimed) {
      this.logger.debug(
        '[attemptResumeFromPaused] Another message already claimed this execution',
        { executionId: pausedExecution.id, conversationId },
      );
      return false;
    }

    try {
      // Start a new Temporal workflow — this hits the isResuming path
      // in initializeWorkflowState which restores full state
      const workflowResult =
        await this.conversationWorkflowService.startWorkflowForExistingConversation(
          conversationId,
          conversation.workflowName,
          organizationId,
        );

      if (!workflowResult?.workflowId) {
        throw new Error('No workflowId returned from workflow start');
      }

      this.logger.log(
        '[attemptResumeFromPaused] Resumed workflow - signaling with user message',
        {
          conversationId,
          newWorkflowId: workflowResult.workflowId,
          executionId: pausedExecution.id,
          messageId,
        },
      );

      // Signal the new workflow with the user's message
      const newWorkflowHandle = this.temporalClient.workflow.getHandle(
        workflowResult.workflowId,
      );
      // Same field-action flatten the active-workflow signal path applies —
      // the resume-from-paused path must produce an identically-shaped
      // FlowUserMessage or QUESTIONS nodes would see two different shapes
      // depending on how the workflow was reached.
      const { message: bridged } =
        this.classifyAndBuildQuestionsActionSignalMessage(storedMessage);
      const userMessage = bridged as UserMessage;
      const flowUserMessage: FlowUserMessage = {
        ...userMessage,
        timestamp: userMessage.createdAt,
        workflowId: workflowResult.workflowId as WorkflowId,
      };
      const signalName = WorkflowSignals.getWorkflowUserMessageSignalName(
        workflowResult.workflowId,
      );
      await newWorkflowHandle.signal(signalName, flowUserMessage);

      return true;
    } catch (error) {
      // Revert to PAUSED so the next message can retry resumption
      this.logger.error(
        '[attemptResumeFromPaused] Failed to resume, reverting to PAUSED',
        {
          executionId: pausedExecution.id,
          conversationId,
          error: error instanceof Error ? error.message : error,
        },
      );

      await this.flowExecutionService.markPaused(
        pausedExecution.id,
        organizationId,
      );
      return false;
    }
  }

  private async signalWorkflow(
    storedMessage: MessageResponseDto,
    messageId: string,
    workflowId: WorkflowId,
    organizationId: OrganizationId,
    requireDelivery = false,
  ): Promise<void> {
    const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);

    this.logger.log('[signalWorkflow] starting...', {
      workflowId,
      messageId,
      conversationId: storedMessage.conversationId,
      messageType: storedMessage.type,
      hasData: !!storedMessage.data,
    });

    try {
      // Flatten field-action submissions (data keyed by UI-element fieldId)
      // onto the engine-local wire shape (data.action / data.payload) the
      // QUESTIONS validator and node code expect. Idempotent — no-op on
      // EXTERNAL_AGENT or already-flattened payloads.
      const { message: bridged } =
        this.classifyAndBuildQuestionsActionSignalMessage(storedMessage);
      const userMessage = bridged as UserMessage;
      const flowUserMessage: FlowUserMessage = {
        ...userMessage,
        timestamp: userMessage.createdAt,
        workflowId,
      };

      // Use dynamic signal name with workflowId to ensure proper isolation
      const signalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
      await workflowHandle.signal(signalName, flowUserMessage);

      this.logger.log(`[signalWorkflow] signaled workflow`, {
        workflowId,
        messageId,
        conversationId: storedMessage.conversationId,
        signalName,
      });
    } catch (signalError: unknown) {
      const errorName = (signalError as { name?: string })?.name ?? 'unknown';
      const errorMessage =
        (signalError as { message?: string })?.message ?? String(signalError);
      const errorConstructor =
        signalError?.constructor?.name ?? 'unknown_constructor';

      this.logger.warn('[signalWorkflow] Signal failed', {
        workflowId,
        messageId,
        conversationId: storedMessage.conversationId,
        errorName,
        errorConstructor,
        errorMessage,
      });

      // Temporal may return WorkflowNotFoundError or other errors for
      // completed/terminated workflows. Attempt resume for any signal failure
      // that indicates the workflow is no longer running.
      const isWorkflowGone =
        errorName === 'WorkflowNotFoundError' ||
        errorMessage.includes('workflow execution already completed') ||
        errorMessage.includes('workflow not found');

      if (isWorkflowGone) {
        const conversation = await this.conversationService.findOne(
          storedMessage.conversationId as ConversationId,
          organizationId,
        );
        const currentWorkflowId = conversation?.workflowId as
          | WorkflowId
          | undefined;
        if (currentWorkflowId && currentWorkflowId !== workflowId) {
          await this.signalWorkflow(
            storedMessage,
            messageId,
            currentWorkflowId,
            organizationId,
            requireDelivery,
          );
          return;
        }

        this.logger.log(
          '[signalWorkflow] Workflow gone - attempting resume from paused state',
          {
            workflowId,
            messageId,
            conversationId: storedMessage.conversationId,
            errorName,
            errorConstructor,
          },
        );

        // Workflow may have been paused and exited — attempt resumption
        const resumed = await this.attemptResumeFromPaused(
          storedMessage,
          messageId,
          organizationId,
        );
        if (!resumed && requireDelivery) {
          throw signalError;
        }
      } else {
        this.logger.error(
          '[signalWorkflow] Unexpected signal error - not a workflow-gone error',
          {
            workflowId,
            messageId,
            conversationId: storedMessage.conversationId,
            errorName,
            errorConstructor,
            errorMessage,
            fullError: signalError,
          },
        );
        throw signalError;
      }
    }
  }
}
