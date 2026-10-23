import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  LlmCompleteEvent,
  LlmProgressEvent,
  LlmRequestEvent,
  QueueEvent,
} from 'src/core/events/types/domain-events';
import {
  ArtifactInsight,
  InfluenceFromSchema,
} from 'src/flows/utils/shared-schemas';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { IntentDetectorService } from 'src/services/intent-detector.service';
import { LLMClientService } from 'src/services/llm/llm-client.service';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import { MessageStatus } from '../../constants/message-status.constants';
import {
  ArtifactSourceType,
  ArtifactType,
  GenerationSystemMessageData,
  Influence,
  InsightData,
  MessageRealtimeEvent,
  SystemMessageData,
} from '../../generated';
import { MessageService } from '../../services/message.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
} from '../../types';
import { ExecutionContext as InternalExecutionContext } from '../../types/execution-context';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { WithWorkflowContext } from '../events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import { EVENT_TYPES } from '../events/types/event.types';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';

/**
 * Job Processor handles the actual processing of jobs and related events.
 * This service should only be initialized in the main application context,
 * not in the worker context to avoid duplication.
 */

export const LlmProcessorSet = new Set<LlmProcessor>();

function toWorkflowContext(
  payload:
    | LlmProgressEvent['payload']
    | LlmRequestEvent['payload']
    | LlmCompleteEvent['payload'],
): Partial<InternalExecutionContext> {
  return {
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    requestId: payload.requestId,
    workflowId: payload.workflowId,
    nodeId: payload.nodeId ?? payload.userMessage?.nodeId,
    conversationId: payload.conversationId,
    userId: payload.userId,
    messageId: payload.messageId,
    correlationId: payload.correlationId,
    causationId: payload.causationId,
    timestamp: payload.timestamp,
  };
}

@Injectable()
export class LlmProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(LlmProcessor.name);

  // Redis key prefixes for tracking pending messages

  // Track active LLM requests so dev endpoints/tests can query status without touching Redis
  private readonly activeRequests = new Map<string, Date>();
  private readonly realtimeSequenceByStream = new Map<string, number>();
  private readonly realtimeMessageIdByRequest = new Map<string, MessageId>();

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    private messageService: MessageService,
    private intentDetector: IntentDetectorService,
    private flowEngineService: NodeExecutionService,
    private llmClientService: LLMClientService,
    private artifactService: ArtifactService,
  ) {
    LlmProcessorSet.add(this);
    if (process.env.NODE_ENV !== 'test' && LlmProcessorSet.size > 1) {
      throw new Error(
        'Duplicate LlmProcessor instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
      );
    }
    this.logger.log('LlmProcessor initialized', {
      count: LlmProcessorSet.size,
    });
  }

  onModuleInit() {
    this.logger.log(
      'LLM Job Service initialized with scalable LLM processing (streaming + dedicated workers) and Redis message tracking',
    );
  }

  onModuleDestroy() {
    // Redis connection is managed by RedisService
    this.logger.log('LlmProcessor cleanup complete');
  }

  @WithWorkflowContext((...args) => {
    const [event] = args as [LlmProgressEvent];
    return {
      sourceService: 'LlmProcessor',
      sourceMethod: 'updateSystemMessageWithProgress',
      context: toWorkflowContext(event.payload),
      metadata: {
        operationType: 'llmProgress',
        requestId: event.payload.requestId,
      },
    };
  })
  async updateSystemMessageWithProgress(
    event: LlmProgressEvent,
  ): Promise<void> {
    try {
      if (!event.payload.requestId) {
        this.logger.warn('Missing requestId in LLM progress event payload');
        return;
      }
      if (!event.payload.projectId || !event.payload.conversationId) {
        this.logger.warn(
          'Missing realtime context fields in LLM progress event payload',
        );
        return;
      }

      const messageId = await this.messageService.getPendingMessageByRequest(
        event.payload.requestId,
      );
      if (!messageId) return;

      await this.messageService.updateMessage(
        messageId,
        event.payload.organizationId,
        {
          status: MessageStatus.SystemProcessing,
          data: {
            type: 'QUESTIONS',
            response: `Processing... ${event.payload.chunk}`,
            uiElements: [],
            detectedIntent: '',
            intentConfidence: 0,
          },
        },
        {
          source: 'updateSystemMessageWithProgress',
          suppressConversationEvent: true,
        },
      );

      await this.publishMessageRealtimeUpdate({
        organizationId: event.payload.organizationId,
        projectId: event.payload.projectId,
        conversationId: event.payload.conversationId,
        requestId: event.payload.requestId as RequestId,
        messageId: messageId as MessageId,
        kind: 'response.delta',
        payload: {
          responseDelta: event.payload.chunk,
        },
      });
    } catch (error) {
      this.logger.error(
        `Error updating system message with progress for request ${event.payload.requestId}:`,
        error,
      );
    }
  }

  @WithWorkflowContext((...args) => {
    const [event] = args as [QueueEvent];
    return {
      sourceService: 'LlmProcessor',
      sourceMethod: 'updateSystemMessageFromJobCompletion',
      context: {
        organizationId: event.payload.organizationId,
        queueName: event.payload.queueName,
        jobType: event.payload.jobType,
      },
      metadata: {
        operationType: 'jobCompletion',
        jobId: event.aggregateId,
      },
    };
  })
  async updateSystemMessageFromJobCompletion(event: QueueEvent): Promise<void> {
    try {
      const messageId = await this.messageService.getPendingMessageByJob(
        event.aggregateId,
      );
      if (!messageId) return;

      await this.messageService.updateMessage(
        messageId,
        event.payload.organizationId,
        {
          status: MessageStatus.Completed,
          data: {
            type: 'QUESTIONS',
            response: `${event.payload.jobType} processing completed successfully.`,
            uiElements: [],
            detectedIntent: '',
            intentConfidence: 0,
          },
        },
        { source: 'updateSystemMessageFromJobCompletion' },
      );
    } catch (error) {
      this.logger.error(
        `Error updating system message for completed job ${event.aggregateId}:`,
        error,
      );
    }
  }

  @WithWorkflowContext((...args) => {
    const [event] = args as [QueueEvent];
    return {
      sourceService: 'LlmProcessor',
      sourceMethod: 'updateSystemMessageFromJobFailure',
      context: {
        organizationId: event.payload.organizationId,
        queueName: event.payload.queueName,
        jobType: event.payload.jobType,
      },
      metadata: {
        operationType: 'jobFailure',
        jobId: event.aggregateId,
        error: event.payload.error,
      },
    };
  })
  async updateSystemMessageFromJobFailure(event: QueueEvent): Promise<void> {
    try {
      const messageId = await this.messageService.getPendingMessageByJob(
        event.aggregateId,
      );
      if (!messageId) return;

      await this.messageService.updateMessage(
        messageId,
        event.payload.organizationId,
        {
          status: MessageStatus.Failed,
          data: {
            type: 'ERROR',
            response: `${event.payload.jobType} processing failed: ${event.payload.error || 'Unknown error'}`,
            detectedIntent: '',
            intentConfidence: 0,
          },
        },
        { source: 'updateSystemMessageFromJobFailure' },
      );
    } catch (error) {
      this.logger.error(
        `Error updating system message for failed job ${event.aggregateId}:`,
        error,
      );
    }
  }

  /**
   * Handle LLM request events when LLM processing starts
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [LlmRequestEvent];
    return {
      sourceService: 'LlmProcessor',
      sourceMethod: 'handleLLMRequestEvent',
      context: toWorkflowContext(event.payload),
      metadata: {
        operationType: 'llmRequest',
        requestId: event.payload.requestId,
        model: event.payload.model,
      },
    };
  })
  async handleLLMRequestEvent(event: LlmRequestEvent): Promise<void> {
    try {
      const requestId = event.payload.requestId;
      if (!requestId) {
        this.logger.warn('Missing requestId in LLM request event payload');
        return;
      }
      if (!event.payload.projectId || !event.payload.conversationId) {
        this.logger.warn(
          'Missing realtime context fields in LLM request event payload',
        );
        return;
      }

      this.logger.debug(`handleLLMRequestEvent for requestId ${requestId}`);

      // Track that LLM request has started
      this.activeRequests.set(requestId, new Date());

      // Get the pending message to update
      const messageId =
        await this.messageService.getPendingMessageByRequest(requestId);

      if (!messageId) {
        this.logger.warn(
          `No pending message found for LLM request ${requestId}`,
        );
        return;
      }

      // Update message to indicate LLM is being queried
      await this.messageService.updateMessage(
        messageId,
        event.payload.organizationId,
        {
          status: MessageStatus.SystemProcessing,
          data: {
            type: 'QUESTIONS',
            response: 'Querying AI...',
            uiElements: [],
            detectedIntent: '',
            intentConfidence: 0,
          },
        },
        {
          source: 'handleLLMRequestEvent',
          suppressConversationEvent: true, // Don't spam events during processing
        },
      );

      await this.publishMessageRealtimeUpdate({
        organizationId: event.payload.organizationId,
        projectId: event.payload.projectId,
        conversationId: event.payload.conversationId,
        requestId: requestId as RequestId,
        messageId: messageId as MessageId,
        kind: 'loading.update',
        payload: {
          loadingText: 'Querying AI...',
          status: 'Querying AI...',
        },
      });

      this.logger.log(`Updated message for LLM request start`, {
        requestId: event.payload.requestId,
        messageId,
        model: event.payload.model,
      });
    } catch (error) {
      this.logger.error(
        `Error handling LLM request event for request ${event.payload.requestId}:`,
        error,
      );
    }
  }

  /**
   * Handle LLM completion events from real LLM API responses
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [LlmCompleteEvent];
    return {
      sourceService: 'LlmProcessor',
      sourceMethod: 'handleLLMCompletionEvent',
      context: toWorkflowContext(event.payload),
      metadata: {
        operationType: 'llmCompletion',
        requestId: event.payload.requestId,
        status: event.payload.status,
      },
    };
  })
  async handleLLMCompletionEvent(event: LlmCompleteEvent): Promise<void> {
    try {
      this.logger.debug(`handleLLMCompletionEvent for eventId ${event.id}`);
      // Prepare system message data
      const { systemMessageData } = event.payload;
      if (!systemMessageData) {
        this.logger.warn(
          `No system message data found for LLM completion event ${event.payload.requestId}`,
        );
        return;
      }

      await this.processInsightsFromLLMResponse(event, systemMessageData);
    } catch (error) {
      this.logger.error(
        `Error handling LLM completion event for request ${event.payload.requestId}:`,
        error,
      );
    }
  }

  private async publishMessageRealtimeUpdate(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: ConversationId;
    requestId: RequestId;
    messageId: MessageId;
    kind: MessageRealtimeEvent['payload']['kind'];
    payload: MessageRealtimeEvent['payload']['payload'];
  }): Promise<void> {
    const {
      organizationId,
      projectId,
      conversationId,
      requestId,
      messageId,
      kind,
      payload,
    } = params;

    const sequence = this.nextRealtimeSequence({
      organizationId,
      requestId,
      messageId,
    });

    await this.eventPublisher.publish({
      type: EVENT_TYPES.MESSAGE.REALTIME,
      aggregateId: messageId,
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.REALTIME,
        organizationId,
        projectId,
        conversationId,
        messageId,
        requestId,
        sequence,
        kind,
        source: 'api',
        timestamp: new Date().toISOString(),
        payload,
      },
    } satisfies Omit<MessageRealtimeEvent, 'id'>);
  }

  private nextRealtimeSequence(params: {
    organizationId: OrganizationId;
    requestId: RequestId;
    messageId: MessageId;
  }): number {
    const requestKey = `${params.organizationId}:${params.requestId}`;
    const existingMessageId = this.realtimeMessageIdByRequest.get(requestKey);
    if (existingMessageId && existingMessageId !== params.messageId) {
      throw new Error(
        `Realtime invariant violation: requestId ${params.requestId} mapped to multiple messageIds (${existingMessageId}, ${params.messageId})`,
      );
    }
    this.realtimeMessageIdByRequest.set(requestKey, params.messageId);

    const key = `${params.organizationId}:${params.requestId}:${params.messageId}`;
    const next = (this.realtimeSequenceByStream.get(key) ?? 0) + 1;
    this.realtimeSequenceByStream.set(key, next);
    return next;
  }

  /**
   * Send LLM response signal to workflow
   */

  /**
   * Process insights from LLM response and create artifacts
   */
  private async processInsightsFromLLMResponse(
    event: LlmCompleteEvent,
    systemMessageData: SystemMessageData,
  ): Promise<void> {
    try {
      // Check if this response has insights array (indicates ARTIFACTS_GENERATION)
      const artifactsResponse = systemMessageData as SystemMessageData & {
        insights?: GenerationSystemMessageData['insights'];
      };

      if (
        !artifactsResponse.insights ||
        artifactsResponse.insights.length === 0
      ) {
        return; // No insights to process
      }

      this.logger.log(
        `Processing ${artifactsResponse.insights.length} insights from LLM response`,
        {
          eventId: event.id,
          nodeId: event.payload.flowConfig?.nodeId,
        },
      );

      // Process each insight and create artifacts
      for (const insight of artifactsResponse.insights) {
        if (!insight.category || !insight.content) {
          this.logger.warn(
            'Skipping insight with missing category or content',
            {
              eventId: event.id,
              nodeId: event.payload.flowConfig?.nodeId,
              hasCategory: !!insight.category,
              hasContent: !!insight.content,
            },
          );
          continue;
        }

        if (!event.payload.messageId) {
          throw new Error('Missing event.payload.messageId');
        }

        // Create artifact with InsightData format
        const insightArtifactData: InsightData = {
          type: 'INSIGHT',
          nodeId: event.payload.flowConfig?.nodeId,
          ...insight,
        };

        await this.artifactService.create(
          {
            type: ArtifactType.Insight,
            title: insight.title,
            data: insightArtifactData,
            category: insight.category, // Set category for template retrieval
            tags: insight.tags ?? undefined,
            sourceId: event.payload.messageId,
            sourceType: ArtifactSourceType.Message,
            projectId: event.payload.projectId,
            organizationId: event.payload.organizationId,
            status: 'ACTIVE',
            generateEmbedding: true,
            influences: (insight as ArtifactInsight).influences
              ?.filter((inf: InfluenceFromSchema) =>
                Boolean(inf.entityId && inf.reasoning && inf.reasonType),
              )
              ?.map(
                (inf): Influence => ({
                  entityId: inf.entityId,
                  entityType: inf.entityType,
                  reasoning: inf.reasoning,
                  reasonType: inf.reasonType,
                  confidence: inf.confidence ?? undefined,
                }),
              ),
          },
          {
            workflowId: event.payload.workflowId,
            nodeId: event.payload.flowConfig?.nodeId,
          },
        );

        this.logger.log(`Created artifact for category ${insight.category}`, {
          eventId: event.id,
          nodeId: event.payload.flowConfig?.nodeId,
          category: insight.category,
          title: insight.title,
          confidence: insight.confidence,
        });
      }
    } catch (error) {
      this.logger.error('Failed to process insights from LLM response', {
        eventId: event.id,
        nodeId: event.payload.flowConfig?.nodeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - insight processing failure shouldn't break the main flow
    }
  }
}
