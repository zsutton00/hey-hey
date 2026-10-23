import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EntityType } from '@prisma/client';
import {
  AgentExecutionResult,
  AgentResponseShape,
  MastraAgentMessagesRequest,
  MastraAgentResponse,
  MastraAgentStructuredRequest,
  MastraClientService,
} from 'src/services/agents/mastra-client.service';
import { ConversationService } from 'src/services/conversation.service';
import { EntityRegistryService } from 'src/services/entity-registry/entity-registry.service';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { AgentWorkflowJobData } from 'src/services/interfaces/job-enqueuer.interface';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { MessageService } from 'src/services/message.service';
import { TaskService } from 'src/services/tasks/task.service';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
} from 'src/types';
import {
  AgentNodeBase,
  FlowContext,
  hasBeforeGeneration,
  InitiativeRefinementFlowContext,
  INode,
  isAgentNode,
  NodeType,
} from 'src/types/flow-internal.types';
import { isDefaultConversationTitle } from 'src/utils/conversation-title';
import { formatMention } from 'src/utils/mentionFormatting';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import {
  createMutableContextHandle,
  MutableContext,
} from 'src/utils/mutable-context';
import { z } from 'zod';
import { MessageStatus } from '../../constants/message-status.constants';
import {
  ErrorSystemMessageData,
  MessageRealtimeEvent,
  SystemMessageData,
  SystemMessageResponseType,
} from '../../generated';
import { FlowNodeErrorRecoveryService } from '../../services/workflows/flow-node-error-recovery.service';
import { addToServiceChain, enrichEventContext } from '../events/context-utils';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { WithWorkflowContext } from '../events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import {
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentProgressEvent,
  AgentRequestEvent,
} from '../events/types/domain-events';
import { EVENT_TYPES } from '../events/types/event.types';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import { AgentQueueJob } from '../queue/interfaces/queue.interface';

/**
 * Agent Processor handles the processing of agent workflow jobs.
 * This service creates a dedicated processing pipeline for agent nodes,
 * separate from LLM processing to prevent special-case complexity.
 */

export const AgentProcessorSet = new Set<AgentProcessor>();

/**
 * Type guard to check if context is InitiativeRefinementFlowContext
 */
function isInitiativeRefinementFlowContext(
  context: unknown,
): context is InitiativeRefinementFlowContext {
  return (
    typeof context === 'object' &&
    context !== null &&
    'initiativeId' in context &&
    typeof (context as InitiativeRefinementFlowContext).initiativeId ===
      'string'
  );
}

function normalizeEntityTypeForAgent(entityType: string): string {
  return entityType.toLowerCase().replace(/_/g, '-');
}

@Injectable()
export class AgentProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(AgentProcessor.name);

  private static readonly BRACKETED_UUID_REGEX =
    /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

  // Track active agent requests for monitoring
  private readonly activeRequests = new Map<string, Date>();
  private readonly realtimeSequenceByStream = new Map<string, number>();
  private readonly realtimeMessageIdByRequest = new Map<string, MessageId>();

  private getConversationTitleFromResult(
    result?: AgentExecutionResult<AgentResponseShape>,
  ): string | undefined {
    if (!result) {
      return undefined;
    }
    const payload = (result.data ?? result) as Record<string, unknown>;
    const conversationTitle = payload?.conversationTitle;
    if (typeof conversationTitle !== 'string') {
      return undefined;
    }
    const trimmed = conversationTitle.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private async updateConversationTitleIfNeeded({
    conversationId,
    organizationId,
    flowId,
    nodeId,
    title,
  }: {
    conversationId: ConversationId;
    organizationId: OrganizationId;
    flowId: string;
    nodeId: string;
    title: string;
  }): Promise<void> {
    const conversation = await this.conversationService.findOne(
      conversationId,
      organizationId,
    );
    const shouldUpdateTitle =
      !conversation?.title ||
      isDefaultConversationTitle(conversation.title, flowId);

    if (!shouldUpdateTitle || conversation?.title === title) {
      return;
    }

    await this.conversationService.updateConversationInternal(
      conversationId,
      organizationId,
      { title },
      'system',
    );
  }

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    private messageService: MessageService,
    private mastraClientService: MastraClientService,
    private taskService: TaskService,
    private promptBuilderService: PromptBuilderService,
    private nodeExecutionService: NodeExecutionService,
    private flowExecutionService: FlowExecutionService,
    private conversationService: ConversationService,
    private entityRegistryService: EntityRegistryService,
    private entitySummaryService: EntitySummaryService,
    private flowRecoverySerivce: FlowNodeErrorRecoveryService,
  ) {
    AgentProcessorSet.add(this);
    if (process.env.NODE_ENV !== 'test' && AgentProcessorSet.size > 1) {
      throw new Error(
        'Duplicate AgentProcessor instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
      );
    }
    this.logger.log('AgentProcessor initialized', {
      count: AgentProcessorSet.size,
    });
  }

  onModuleInit() {
    this.logger.log(
      'Agent Processor initialized with dedicated agent processing pipeline',
    );
  }

  onModuleDestroy() {
    this.logger.log('AgentProcessor cleanup complete');
  }

  /**
   * Process an agent workflow job
   */
  @WithWorkflowContext((...args) => {
    const [job] = args as [AgentQueueJob];
    return {
      sourceService: 'AgentProcessor',
      sourceMethod: 'processAgentWorkflow',
      context: job,
      metadata: {
        flowId: job.data.context?.flowId,
        nodeType: NodeType.AGENT,
        requestId: job.requestId,
        nodeId: job.data.nodeId,
      },
    };
  })
  async processAgentWorkflow(job: AgentQueueJob): Promise<void> {
    const requestId = job.requestId;

    if (!requestId) {
      throw new Error(`Agent Job ${job.id} is missing requestId`);
    }
    if (!job.workflowId) {
      throw new Error(`Agent Job ${job.id} is missing workflowId`);
    }

    const data = job.data;

    this.logger.log(
      `Processing agent workflow job ${job.id} for agent ${data.agentId}`,
      {
        requestId,
        agentId: data.agentId,
        nodeId: data.nodeId,
        conversationId: data.conversationId,
      },
    );

    // Emit AGENT.REQUEST at the beginning of processing
    const requestEvent: Omit<AgentRequestEvent, 'id'> = this.createRequestEvent(
      requestId,
      job,
    );
    await this.eventPublisher.publish(requestEvent);

    const node = this.nodeExecutionService.getNode(
      data.context.flowId,
      data.nodeId,
    )?.node;
    if (!node) {
      const flow = this.nodeExecutionService.getFlow(data.context.flowId);
      const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
      throw new Error(
        `Could not find node ${data.nodeId}. Available nodes: ${availableNodes.join(', ')}`,
      );
    }

    try {
      this.activeRequests.set(requestId, new Date());

      // Execute agent through Mastra with proper tool integration
      const { agentResult, tracker } = await this.executeAgentWithProgress(
        job,
        data,
      );

      this.logger.log(`Agent workflow job ${job.id} completed successfully`, {
        requestId,
        agentId: data.agentId,
        confidence: agentResult.confidence,
      });

      // Remove from active map
      this.activeRequests.delete(requestId);

      const start = this.activeRequests.get(requestId)?.getTime() ?? 0;

      const completeEvent: Omit<AgentCompleteEvent, 'id'> =
        this.createCompleteEvent(
          requestId,
          job,
          data,
          node,
          agentResult,
          start,
          tracker,
        );

      // Publish AGENT.COMPLETE event
      await this.eventPublisher.publish(completeEvent);
    } catch (error) {
      this.logger.error(`Agent workflow job ${job.id} failed:`, error);

      // Remove from active map
      this.activeRequests.delete(requestId);

      // Emit AGENT.ERROR event
      const errorEvent: Omit<AgentErrorEvent, 'id'> = this.createErrorEvent(
        requestId,
        job,
        data,
        node,
        error,
      );
      await this.eventPublisher.publish(errorEvent);

      throw error;
    }
  }

  private createErrorEvent(
    requestId: string,
    job: AgentQueueJob,
    data: AgentWorkflowJobData,
    node: INode<Readonly<FlowContext>>,
    error: unknown,
  ): Omit<AgentErrorEvent, 'id'> {
    const workflowId = job.workflowId;
    if (!workflowId) {
      throw new Error(`Agent Job ${job.id} is missing workflowId`);
    }

    return {
      type: EVENT_TYPES.AGENT.ERROR,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.AGENT.ERROR,
        // Spread all ExecutionContext properties from job
        organizationId: job.organizationId,
        projectId: job.projectId,
        requestId,
        workflowId,
        conversationId: data.conversationId,
        nodeId: node.id,
        userId: job.userId,
        messageId: job.messageId,
        userMessage: job.userMessage,
        // Error specific properties
        error: {
          code: 'AGENT_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'RETRYABLE',
        },
        flowConfig: {
          jobId: job.id,
          nodeId: node.id,
          nodeType: node.type,
          context: data.context,
        },
      },
    };
  }

  private createCompleteEvent(
    requestId: string,
    job: AgentQueueJob,
    data: AgentWorkflowJobData,
    node: INode<Readonly<FlowContext>>,
    agentResult: AgentExecutionResult<AgentResponseShape>,
    start: number,
    tracker: MutableContext<Readonly<FlowContext>>,
  ): Omit<AgentCompleteEvent, 'id'> {
    const workflowId = job.workflowId;
    if (!workflowId) {
      throw new Error(`Agent Job ${job.id} is missing workflowId`);
    }

    return {
      type: EVENT_TYPES.AGENT.COMPLETE,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.AGENT.COMPLETE,
        // Spread all ExecutionContext properties from job
        organizationId: job.organizationId,
        projectId: job.projectId,
        requestId,
        workflowId,
        conversationId: data.conversationId,
        userId: job.userId,
        messageId: job.messageId,
        userMessage: job.userMessage,
        // Agent completion specific properties
        status: 'success',
        nodeId: node.id,
        result: agentResult,
        executionTime: Date.now() - start,
        contextUpdates: tracker.getPatch(),
        cost: 0, // TODO: Get cost from Mastra response
        flowConfig: {
          jobId: job.id,
          nodeId: node.id,
          nodeType: node.type,
          context: data.context,
        },
      },
    };
  }

  private createRequestEvent(
    requestId: string,
    job: AgentQueueJob,
  ): Omit<AgentRequestEvent, 'id'> {
    const workflowId = job.workflowId;
    if (!workflowId) {
      throw new Error(`Agent Job ${job.id} is missing workflowId`);
    }

    return {
      type: EVENT_TYPES.AGENT.REQUEST,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.AGENT.REQUEST,
        // Spread all ExecutionContext properties from job
        organizationId: job.organizationId,
        projectId: job.projectId,
        requestId,
        workflowId,
        conversationId: job.data.conversationId,
        userId: job.userId,
        messageId: job.messageId,
        userMessage: job.userMessage,
        // Agent-specific properties
        agentId: job.data.agentId,
        nodeId: job.data.nodeId,
        flowConfig: {
          jobId: job.id,
          nodeId: job.data.nodeId,
          nodeType: NodeType.AGENT,
          context: job.data.context,
        },
      },
    };
  }

  /**
   * Execute agent with progress reporting
   */
  private async executeAgentWithProgress(
    job: AgentQueueJob,
    data: AgentWorkflowJobData,
  ): Promise<{
    tracker: MutableContext<FlowContext>;
    agentResult: AgentExecutionResult;
  }> {
    this.logger.debug('[executeAgentWithProgress] starting...', {
      job,
    });

    const requestId = job.requestId;

    if (!requestId) {
      throw new Error(`Agent Job ${job.id} is missing requestId`);
    }

    // Extract initiative context if available
    const isInitiativeRefinement = isInitiativeRefinementFlowContext(
      data.context,
    );
    const initiativeId = isInitiativeRefinement
      ? (data.context as unknown as InitiativeRefinementFlowContext)
          .initiativeId
      : undefined;

    const latestUserMessage = data.userMessage || job.userMessage;

    // Build domain-relevant context (exclude workflow internals)
    const agentContext: MastraAgentMessagesRequest['context'] = {
      projectId: job.projectId,
      organizationId: job.organizationId,
      conversationId: data.conversationId,
      nodeId: data.nodeId,
      workflowAboutId: data.workflowAboutId,
      workflowAboutType: data.workflowAboutType,
      messageId: job.messageId,
    };

    const messageId = latestUserMessage?.id ?? job.messageId;
    if (messageId) {
      agentContext.messageId = messageId;
    }

    // Add initiative-specific context if available
    if (initiativeId) {
      agentContext.initiativeId = initiativeId;
    } else if (data.workflowAboutType === 'task') {
      agentContext.initiativeId = await this.loadTaskInitiativeId(
        data.workflowAboutId,
        job.organizationId,
      );
    }

    try {
      const conversationMentions =
        await this.messageService.getMentionsForConversation(
          data.conversationId,
          job.organizationId,
        );

      if (conversationMentions && conversationMentions.length > 0) {
        const uniqueEntities = new Map<
          string,
          { entityId: string; entityType: EntityType }
        >();

        for (const mention of conversationMentions) {
          const key = `${mention.entityType}:${mention.entityId}`;
          if (!uniqueEntities.has(key)) {
            uniqueEntities.set(key, {
              entityId: mention.entityId,
              entityType: mention.entityType,
            });
          }
        }

        const summaries =
          await this.entitySummaryService.getCurrentSummariesForEntities({
            organizationId: job.organizationId,
            projectId: job.projectId,
            entities: Array.from(uniqueEntities.values()),
          });

        const summariesByKey = new Map<string, string>();
        for (const summary of summaries) {
          summariesByKey.set(
            `${summary.entityType}:${summary.entityId}`,
            summary.summary,
          );
        }

        this.logger.debug('[executeAgentWithProgress] adding mentions?', {
          mentionCount: conversationMentions.length,
        });

        agentContext.mentions = conversationMentions.map((mention) => ({
          entityId: mention.entityId,
          entityType: normalizeEntityTypeForAgent(String(mention.entityType)),
          messageId: mention.messageId,
          summary: summariesByKey.get(
            `${mention.entityType}:${mention.entityId}`,
          ),
        }));
      }
    } catch (error) {
      this.logger.debug(
        '[executeAgentWithProgress] Failed to load conversation mention summaries',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }

    const nodeEntry = this.nodeExecutionService.getNode(
      data.context.flowId,
      data.nodeId,
    );
    if (!nodeEntry) {
      throw new Error(
        `Node ${data.nodeId} not found in flow ${data.context.flowId}`,
      );
    }
    const node = nodeEntry.node as AgentNodeBase;
    const responseSchema =
      node.responseSchema ??
      (z
        .object({
          summary: z.string(),
        })
        .passthrough() as z.ZodSchema<AgentResponseShape>);
    let structuredInput: Record<string, unknown> | undefined;
    const tracker = new MutableContext(data.context);
    if (hasBeforeGeneration(node)) {
      try {
        this.logger.debug(
          '[executeAgentWithProgress] calling beforeGeneration',
          {
            nodeId: data.nodeId,
            agentId: data.agentId,
          },
        );
        await node.beforeGeneration(tracker, latestUserMessage ?? undefined);
        this.logger.debug(
          '[executeAgentWithProgress] beforeGeneration completed',
          {
            nodeId: data.nodeId,
            agentId: data.agentId,
          },
        );
      } catch (error) {
        this.logger.error(
          '[executeAgentWithProgress] beforeGeneration failed',
          {
            nodeId: data.nodeId,
            agentId: data.agentId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        );
        throw error;
      }
    }
    if (typeof node.agentInput === 'function') {
      try {
        const maybeInput = (await node.agentInput(
          tracker,
          latestUserMessage ?? undefined,
        )) as Record<string, unknown> | undefined;

        if (maybeInput) {
          structuredInput = maybeInput;
          this.logger.debug(
            '[executeAgentWithProgress] using structured agent input',
            {
              agentId: data.agentId,
              nodeId: data.nodeId,
              structuredKeys: Object.keys(structuredInput),
            },
          );
        }
      } catch (error) {
        this.logger.error(
          '[executeAgentWithProgress] failed to build structured agent input',
          {
            agentId: data.agentId,
            nodeId: data.nodeId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        );
        throw error;
      }
    }

    const workflowId = job.workflowId;
    if (!workflowId) {
      throw new Error(`Agent Job ${job.id} is missing workflowId`);
    }
    const executionMetadata = {
      nodeId: job.data.nodeId,
      workflowId,
    };

    let agentResponse: MastraAgentResponse<AgentResponseShape>;

    if (structuredInput) {
      const structuredRequest: MastraAgentStructuredRequest<
        Record<string, unknown>
      > = {
        agentId: data.agentId,
        requestId,
        input: structuredInput,
        context: agentContext,
        maxExecutionTime: data.options?.maxExecutionTime,
        temperature: data.options?.temperature,
      };

      agentResponse = await this.mastraClientService.executeAgentStructured(
        structuredRequest,
        responseSchema,
        executionMetadata,
      );
    } else {
      // TODO: remove this code path
      let resolvedUserPrompt: string | undefined;

      try {
        const resolvedPrompts =
          await this.promptBuilderService.buildAgentPrompts(
            data.context,
            data.userPrompt,
            latestUserMessage,
          );
        resolvedUserPrompt = resolvedPrompts.userPrompt;
      } catch (error) {
        this.logger.warn(
          'Failed to resolve agent prompts via PromptBuilderService',
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            nodeId: data.nodeId,
            agentId: data.agentId,
          },
        );
      }

      let userContent: string;
      if (resolvedUserPrompt !== undefined) {
        userContent = resolvedUserPrompt;
      } else if (data.userPrompt) {
        userContent = data.userPrompt;
      } else if (latestUserMessage) {
        userContent =
          MessageContentExtractor.extractMessageContent(latestUserMessage);
      } else if (isInitiativeRefinement) {
        userContent =
          'Please analyze the current state of this initiative and provide recommendations for refinement. Focus on identifying gaps, risks, and improvement opportunities.';
      } else {
        userContent =
          'Please analyze the current context and provide relevant insights and recommendations.';
      }

      const messageRequest: MastraAgentMessagesRequest = {
        agentId: data.agentId,
        requestId,
        messages: [
          {
            role: 'user',
            content: userContent,
          },
        ],
        context: agentContext,
        maxExecutionTime: data.options?.maxExecutionTime,
        temperature: data.options?.temperature,
      };

      agentResponse = await this.mastraClientService.executeAgent(
        messageRequest,
        responseSchema,
        executionMetadata,
      );
    }

    if (agentResponse.status === 'failed') {
      throw new Error(
        `Agent execution failed: ${agentResponse.error?.message || 'Unknown error'}`,
      );
    }

    if (!agentResponse.result) {
      throw new Error('Agent execution completed but no result returned');
    }

    return { agentResult: agentResponse.result, tracker };
  }

  /**
   * Handle agent request events when agent processing starts
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [AgentRequestEvent];
    return {
      sourceService: 'AgentProcessor',
      sourceMethod: 'handleAgentRequestEvent',
      context: event.payload,
      metadata: {
        nodeId: event.payload.flowConfig?.nodeId ?? event.payload.nodeId,
        operationType: 'agentRequest',
        agentId: event.payload.agentId,
        requestId: event.payload.requestId,
      },
    };
  })
  async handleAgentRequestEvent(event: AgentRequestEvent): Promise<void> {
    try {
      this.logger.debug(
        `handleAgentRequestEvent for requestId ${event.payload.requestId}`,
        {
          agentId: event.payload.agentId,
          nodeId: event.payload.nodeId,
        },
      );

      if (
        !event.payload.requestId ||
        !event.payload.projectId ||
        !event.payload.conversationId
      ) {
        throw new Error(
          `Agent request event ${event.id} is missing realtime context fields`,
        );
      }

      // Track that agent request has started
      this.activeRequests.set(event.payload.requestId, new Date());

      // Get the pending message to update
      const messageId = await this.messageService.getPendingMessageByRequest(
        event.payload.requestId,
      );

      if (!messageId) {
        this.logger.warn(
          `No pending message found for agent request ${event.payload.requestId}`,
        );
        return;
      }

      // Update message to indicate agent is being executed
      await this.messageService.updateMessage(
        messageId,
        event.payload.organizationId,
        {
          status: MessageStatus.SystemProcessing,
          data: {
            type: 'QUESTIONS',
            response: `Executing agent ${event.payload.agentId}...`,
            detectedIntent: '',
            intentConfidence: 0,
            uiElements: [],
          },
        },
        {
          source: 'handleAgentRequestEvent',
          suppressConversationEvent: true, // Don't spam events during processing
        },
      );

      await this.publishMessageRealtimeUpdate({
        organizationId: event.payload.organizationId,
        projectId: event.payload.projectId,
        conversationId: event.payload.conversationId,
        requestId: event.payload.requestId,
        messageId: messageId as MessageId,
        kind: 'loading.update',
        payload: {
          loadingText: `Executing agent ${event.payload.agentId}...`,
          status: `Executing agent ${event.payload.agentId}...`,
        },
      });

      this.logger.log(`Updated message for agent request start`, {
        requestId: event.payload.requestId,
        messageId,
        agentId: event.payload.agentId,
      });
    } catch (error) {
      this.logger.error(
        `Error handling agent request event for request ${event.payload.requestId}:`,
        error,
      );
    }
  }

  /**
   * Handle agent progress events
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [AgentProgressEvent];
    return {
      sourceService: 'AgentProcessor',
      sourceMethod: 'handleAgentProgressEvent',
      context: event.payload,
      metadata: {
        operationType: 'agentProgress',
        requestId: event.payload.requestId,
      },
    };
  })
  async handleAgentProgressEvent(event: AgentProgressEvent): Promise<void> {
    try {
      if (
        !event.payload.requestId ||
        !event.payload.projectId ||
        !event.payload.conversationId
      ) {
        throw new Error(
          `Agent progress event ${event.id} is missing realtime context fields`,
        );
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
            response: event.payload.status,
            detectedIntent: '',
            intentConfidence: 0,
            uiElements: [],
          },
        },
        {
          source: 'handleAgentProgressEvent',
          suppressConversationEvent: true,
        },
      );

      await this.publishMessageRealtimeUpdate({
        organizationId: event.payload.organizationId,
        projectId: event.payload.projectId,
        conversationId: event.payload.conversationId,
        requestId: event.payload.requestId,
        messageId: messageId as MessageId,
        kind: 'tool.progress',
        payload: {
          loadingText: event.payload.status,
          currentStep: event.payload.currentStep,
          status: event.payload.status,
          progress: event.payload.progress,
        },
      });
    } catch (error) {
      this.logger.error(
        `Error updating system message with agent progress for request ${event.payload.requestId}:`,
        error,
      );
    }
  }

  private async publishMessageRealtimeUpdate(params: {
    organizationId: string;
    projectId: string;
    conversationId: string;
    requestId: string;
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
        organizationId: organizationId as OrganizationId,
        projectId: projectId as ProjectId,
        conversationId: conversationId as ConversationId,
        messageId,
        requestId: requestId as RequestId,
        sequence,
        kind,
        source: 'api',
        timestamp: new Date().toISOString(),
        payload,
      },
    } satisfies Omit<MessageRealtimeEvent, 'id'>);
  }

  private nextRealtimeSequence(params: {
    organizationId: string;
    requestId: string;
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
   * Handle agent completion events
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [AgentCompleteEvent];
    return {
      sourceService: 'AgentProcessor',
      sourceMethod: 'handleAgentCompletionEvent',
      context: event.payload,
      metadata: {
        nodeId: event.payload.flowConfig?.nodeId ?? event.payload.nodeId,
        operationType: 'agentCompletion',
        requestId: event.payload.requestId,
        status: event.payload.status,
      },
    };
  })
  async handleAgentCompletionEvent(event: AgentCompleteEvent): Promise<void> {
    try {
      let systemMessageData: SystemMessageData | undefined;
      // If this agent job was triggered by a flow node, complete the flow node
      if (event.payload.requestId && event.payload.flowConfig) {
        systemMessageData = await this.completeAgentNode(event);
      } else {
        this.logger.warn(
          '[handleAgentCompletionEvent] Skipping completeAgentNode - missing requestId or flowConfig',
          {
            requestId: event.payload.requestId,
            hasFlowConfig: !!event.payload.flowConfig,
            workflowId: event.payload.workflowId,
            status: event.payload.status,
          },
        );
      }
      if (!systemMessageData) {
        this.logger.warn(
          '[handleAgentCompletionEvent] No systemMessageData after agent completion',
          {
            requestId: event.payload.requestId,
            hasFlowConfig: !!event.payload.flowConfig,
            workflowId: event.payload.workflowId,
            status: event.payload.status,
          },
        );
        return;
      }

      await this.updateSystemMessageWithAgentResponse(event, systemMessageData);
    } catch (error) {
      this.logger.error(
        `Error handling agent completion event for request ${event.payload.requestId}:`,
        error,
      );
    }
  }

  /**
   * Complete a flow node that was waiting for agent completion
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [AgentCompleteEvent];
    return {
      sourceService: 'FlowNodeProcessor',
      sourceMethod: 'completeAgentNode',
      context: {
        organizationId: event.payload.organizationId,
        projectId: event.payload.projectId,
        workflowId: event.payload.workflowId,
        conversationId: event.payload.conversationId,
        userId: event.payload.userId,
        requestId: event.payload.requestId,
        messageId: event.payload.messageId,
        correlationId: event.payload.correlationId,
        causationId: event.payload.causationId,
      },
      metadata: {
        nodeId: event.payload.flowConfig?.nodeId,
        nodeType: event.payload.flowConfig?.nodeType,
        requestId: event.payload.requestId,
      },
    };
  })
  private async completeAgentNode(
    event: AgentCompleteEvent,
  ): Promise<SystemMessageData | undefined> {
    // Enrich context with agent completion metadata
    enrichEventContext({
      requestId: event.payload.requestId,
      nodeId: event.payload.flowConfig?.nodeId,
      nodeType: event.payload.flowConfig?.nodeType,
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('AgentNodeProcessor');

    let systemMessageData: SystemMessageData | undefined;

    this.logger.debug(`[completeAgentNode] starting`, {
      requestId: event.payload.requestId,
      agentStatus: event.payload.status,
      nodeId: event.payload.flowConfig?.nodeId,
      nodeType: event.payload.flowConfig?.nodeType,
      ...event.payload.flowConfig.context.core,
    });

    const { requestId, status, organizationId } = event.payload;
    if (!requestId) {
      this.logger.error(
        '[completeAgentNode] Agent completion event missing requestId',
        {
          workflowId: event.payload.workflowId,
          status: event.payload.status,
          nodeId: event.payload.flowConfig?.nodeId,
        },
      );
      return;
    }

    try {
      const {
        nodeId,
        nodeType,
        jobId,
        context: rawContext,
      } = event.payload.flowConfig;
      const context = rawContext as FlowContext;
      const tracker = event.payload.contextUpdates
        ? MutableContext.fromPatch(context, event.payload.contextUpdates)
        : createMutableContextHandle<FlowContext>(context);
      this.logger.log(`Completing agent flow node`, {
        requestId,
        jobId,
        nodeId,
        nodeType,
      });

      if (status === 'success') {
        const nodeData = this.nodeExecutionService.getNode(
          context.flowId,
          nodeId,
        );
        if (!nodeData) {
          throw new Error(`Node ${nodeId} not found in flow ${context.flowId}`);
        }
        const { node, routing } = nodeData;
        let nextNodeId: string | null = null;
        let agentErrored = false;
        let agentErrorMsg: string | undefined;
        let conversationTitle: string | undefined;

        // Check if AGENT node has processAgentResponse handler
        if (isAgentNode(node)) {
          this.logger.debug(
            '[completeAgentNode] Using processAgentResponse handler',
            {
              nodeId: node.id,
            },
          );
          try {
            // Construct complete MastraAgentResponse from event payload
            const mastraAgentResponse: MastraAgentResponse = {
              executionId: event.payload.requestId ?? '',
              status:
                event.payload.status === 'success'
                  ? ('completed' as const)
                  : ('failed' as const),
              result: event.payload
                .result as import('../../services/agents/mastra-client.service').AgentExecutionResult,
              executionTime: event.payload.executionTime,
              cost: event.payload.cost,
            };

            // Get both nextNodeId and optional systemMessageData
            const agentResult = await node.processAgentResponse(
              mastraAgentResponse,
              tracker,
            );
            conversationTitle = this.getConversationTitleFromResult(
              mastraAgentResponse.result,
            );

            if ('errorMsg' in agentResult) {
              agentErrored = true;
              agentErrorMsg = agentResult.errorMsg;
              nextNodeId = agentResult.nextNodeId ?? null;
              if (agentResult.systemMessageData) {
                this.logger.log(
                  '[completeAgentNode] Merging custom systemMessageData from processAgentResponse',
                  {
                    nodeId: node.id,
                  },
                );
                systemMessageData = {
                  ...(agentResult.systemMessageData ?? {}),
                  type: 'QUESTIONS',
                  title: agentResult.systemMessageData?.title ?? '',
                } as SystemMessageData;
              }
            } else {
              nextNodeId = agentResult.nextNodeId;
              systemMessageData = {
                ...(agentResult.systemMessageData ?? {}),
                type: 'QUESTIONS',
                title: agentResult.systemMessageData?.title ?? '',
              } as SystemMessageData;
            }
          } catch (error) {
            this.logger.error(
              '[completeAgentNode] Error in processAgentResponse:',
              error,
            );
            // Fall through to routing config check
          }
        }

        if (
          !agentErrored &&
          conversationTitle &&
          context.core.conversationId &&
          context.flowId
        ) {
          try {
            await this.updateConversationTitleIfNeeded({
              conversationId: context.core.conversationId,
              organizationId,
              flowId: context.flowId,
              nodeId: node.id,
              title: conversationTitle,
            });
          } catch (error) {
            this.logger.warn(
              '[completeAgentNode] Failed to update conversation title',
              {
                conversationId: context.core.conversationId,
                nodeId: node.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            );
          }
        }

        if (!systemMessageData && !agentErrored) {
          throw new Error(
            `[completeAgentNode] Missing systemMessageData for node ${nodeId}`,
          );
        }

        if (!systemMessageData && agentErrored) {
          systemMessageData = {
            type: 'ERROR',
            response: agentErrorMsg || 'Agent processing error',
            detectedIntent: 'agent_execution_error',
            intentConfidence: 1.0,
            errorType: 'agent_execution_error',
            temporary: true,
            context: agentErrorMsg,
          } as ErrorSystemMessageData;
        }

        // If the agent node reported an error, overwrite system message data accordingly
        if (agentErrored) {
          systemMessageData = {
            nodeId: systemMessageData?.nodeId ?? nodeId,
            flowId: systemMessageData?.flowId,
            title: systemMessageData?.title,
            type: 'ERROR',
            response: agentErrorMsg || 'Agent processing error',
            detectedIntent: 'agent_execution_error',
            intentConfidence: 1.0,
            reasoning:
              systemMessageData && 'reasoning' in systemMessageData
                ? systemMessageData.reasoning
                : undefined,
            errorType: 'agent_execution_error',
            temporary: true,
            context: agentErrorMsg,
          } as ErrorSystemMessageData;
        }

        if (!systemMessageData) {
          throw new Error(
            `[completeAgentNode] Missing systemMessageData for node ${nodeId}`,
          );
        }
        // If no agent-specific routing, check routing config
        if (!nextNodeId && 'nextNode' in routing && routing.nextNode) {
          this.logger.debug(
            '[completeAgentNode] Using simple nextNode configuration',
            {
              nodeId: node.id,
              nextNode: routing.nextNode,
            },
          );
          nextNodeId = routing.nextNode;
        }

        if (!nextNodeId) {
          // Execute previous node routing logic
          const routedNodeId =
            await this.nodeExecutionService.executePreviousNodePostProcess(
              node.id,
              systemMessageData,
              context,
            );
          nextNodeId = routedNodeId ?? null;

          this.logger.debug(
            '[completeAgentNode] agent node did not define nextNode via routing or processAgentResponse, using previous node',
            {
              nodeId: node.id,
              nextNodeId,
            },
          );
        }

        systemMessageData = await this.convertBracketedIdsToMentions(
          systemMessageData,
          organizationId,
        );

        // Emit FLOW_NODE.COMPLETE event
        await this.eventPublisher.publish({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          aggregateId: requestId,
          payload: {
            payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,
            organizationId,
            projectId: event.payload.projectId,
            requestId,
            workflowId: event.payload.workflowId,
            conversationId: event.payload.conversationId,
            userId: event.payload.userId,
            nodeId,
            nodeType,
            status: 'success',
            flowPath: context.flowPath,
            systemMessageData,
          },
        });

        this.logger.debug(
          '[completeAgentNode] calling sendNodeResponseToWorkflow',
          {
            nextNodeId,
          },
        );

        // Send LLM response signal to workflow with the result
        await this.flowExecutionService.sendNodeResponseToWorkflow(
          requestId as RequestId,
          event.payload.workflowId,
          systemMessageData,
          nextNodeId,
          undefined,
          tracker,
        );

        // Record success for circuit breaker
        const circuitKey = this.flowRecoverySerivce.getCircuitBreakerKey(
          nodeType,
          organizationId,
        );
        this.flowRecoverySerivce.recordCircuitBreakerSuccess(circuitKey);

        this.logger.log(`Agent flow node ${nodeId} completed successfully`, {
          requestId,
          jobId,
          nextNodeId,
        });
      } else {
        // Handle agent execution failure
        const error = event.payload.result
          ? new Error(
              `Agent execution failed: ${JSON.stringify(event.payload.result)}`,
            )
          : new Error('Agent execution failed with unknown error');

        this.logger.error(`Agent flow node ${nodeId} failed`, {
          requestId,
          jobId,
          error: error.message,
        });

        // Send failure signal to workflow
        const errorMessageData: ErrorSystemMessageData = {
          type: SystemMessageResponseType.Error,
          nodeId,
          response: 'Agent execution failed',
          detectedIntent: 'error',
          intentConfidence: 1.0,
          reasoning: error.message,
          errorType: 'agent_execution_error',
          temporary: true,
          context: error.message,
        };
        const sanitizedErrorMessageData =
          await this.convertBracketedIdsToMentions(
            errorMessageData,
            organizationId,
          );

        await this.flowExecutionService.sendNodeResponseToWorkflow(
          requestId as RequestId,
          event.payload.workflowId,
          sanitizedErrorMessageData,
          null, // no next node on failure
          true, // errorHolding flag for agent failure recovery
          tracker,
        );

        // Record failure for circuit breaker so repeated agent issues open the circuit
        const circuitKey = this.flowRecoverySerivce.getCircuitBreakerKey(
          nodeType,
          organizationId,
        );
        this.flowRecoverySerivce.recordCircuitBreakerFailure(circuitKey);
      }

      // Mark the flow node job as completed
      this.logger.log(`Flow node ${nodeId} completed via agent completion`, {
        requestId,
        jobId,
      });
    } catch (error) {
      this.logger.error(
        `Error completing agent flow node for request ${requestId}:`,
        error,
      );
    }

    return systemMessageData;
  }

  /**
   * Update system message with agent completion data
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [AgentCompleteEvent];
    return {
      sourceService: 'AgentProcessor',
      sourceMethod: 'updateSystemMessageWithAgentResponse',
      context: event.payload,
      workflowId: event.payload.workflowId,
      nodeId: event.payload.flowConfig?.nodeId ?? event.payload.nodeId,
      metadata: {
        operationType: 'updateSystemMessageAgentResponse',
        requestId: event.payload.requestId,
        status: event.payload.status,
      },
    };
  })
  async updateSystemMessageWithAgentResponse(
    event: AgentCompleteEvent,
    systemMessageData: SystemMessageData,
  ): Promise<void> {
    try {
      const { organizationId, requestId, status } = event.payload;

      if (!requestId) {
        this.logger.error('No requestId in AgentCompleteEvent payload');
        return;
      }

      const messageId =
        await this.messageService.getPendingMessageByRequest(requestId);

      if (!messageId) {
        this.logger.warn(`No pending message found for request ${requestId}`);
        return;
      }

      this.logger.log('updating system message with agent response', {
        eventId: event.id,
        systemMessageData,
        messageId,
        organizationId,
        requestId,
        status,
      });

      const sanitizedSystemMessageData =
        await this.convertBracketedIdsToMentions(
          systemMessageData,
          organizationId,
        );

      // Determine final message status
      const messageStatus =
        status === 'success' ? MessageStatus.Completed : MessageStatus.Failed;

      await this.messageService.updateMessage(
        messageId,
        organizationId,
        {
          status: messageStatus,
          data: sanitizedSystemMessageData,
        },
        {
          source: 'updateSystemMessageWithAgentResponse',
          suppressConversationEvent: false,
        },
      );

      this.logger.log(`Updated system message for agent completion`, {
        requestId,
        messageId,
        status,
        messageStatus,
        agentId: event.payload.result?.agentId,
      });
    } catch (error) {
      this.logger.error(
        `Error updating system message with agent response for request ${event.payload.requestId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Convert bracketed UUID tokens into mention tokens when resolvable.
   * Unknown IDs are stripped from the content.
   */
  private async convertBracketedIdsToMentions(
    systemMessageData: SystemMessageData,
    organizationId: OrganizationId,
  ): Promise<SystemMessageData> {
    const entityIds = new Set<string>();
    this.collectBracketedEntityIds(systemMessageData, entityIds);

    if (entityIds.size === 0) {
      return systemMessageData;
    }

    const mentionMap = await this.buildMentionMap(entityIds, organizationId);
    return this.applyMentionReplacements(systemMessageData, mentionMap);
  }

  private collectBracketedEntityIds(
    value: unknown,
    entityIds: Set<string>,
  ): void {
    if (typeof value === 'string') {
      const matches = value.matchAll(AgentProcessor.BRACKETED_UUID_REGEX);
      for (const match of matches) {
        if (match[1]) {
          entityIds.add(match[1].toLowerCase());
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => this.collectBracketedEntityIds(item, entityIds));
      return;
    }

    if (value && typeof value === 'object') {
      if (value instanceof Date) {
        return;
      }

      Object.values(value as Record<string, unknown>).forEach((nestedValue) =>
        this.collectBracketedEntityIds(nestedValue, entityIds),
      );
    }
  }

  private async buildMentionMap(
    entityIds: Set<string>,
    organizationId: OrganizationId,
  ): Promise<Map<string, string>> {
    if (entityIds.size === 0) {
      return new Map();
    }

    try {
      const entities = await this.entityRegistryService.getEntitiesByIds({
        organizationId,
        entities: Array.from(entityIds).map((entityId) => ({ entityId })),
      });

      const mentionMap = new Map<string, string>();

      for (const entity of entities) {
        const normalizedType = normalizeEntityTypeForAgent(
          String(entity.entityType),
        );

        mentionMap.set(
          entity.entityId.toLowerCase(),
          formatMention({
            entityType: normalizedType,
            entityId: entity.entityId,
            entityName: entity.entityName || entity.entityId,
          }),
        );
      }

      const unresolved = Array.from(entityIds).filter(
        (id) => !mentionMap.has(id.toLowerCase()),
      );

      if (unresolved.length > 0) {
        this.logger.debug(
          '[convertBracketedIdsToMentions] Stripping unresolved entity IDs',
          {
            organizationId,
            unresolvedCount: unresolved.length,
            unresolvedIds: unresolved,
          },
        );
      }

      return mentionMap;
    } catch (error) {
      this.logger.debug(
        '[convertBracketedIdsToMentions] Failed to resolve entity IDs; stripping tokens',
        {
          organizationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      return new Map();
    }
  }

  private applyMentionReplacements<T>(
    value: T,
    mentionMap: Map<string, string>,
  ): T {
    if (typeof value === 'string') {
      return value.replace(
        AgentProcessor.BRACKETED_UUID_REGEX,
        (_match, entityId) => mentionMap.get(entityId.toLowerCase()) ?? '',
      ) as unknown as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) =>
        this.applyMentionReplacements(item, mentionMap),
      ) as unknown as T;
    }

    if (value && typeof value === 'object') {
      if (value instanceof Date) {
        return value;
      }

      const result: Record<string, unknown> = {};
      Object.entries(value as Record<string, unknown>).forEach(
        ([key, nestedValue]) => {
          result[key] = this.applyMentionReplacements(nestedValue, mentionMap);
        },
      );
      return result as unknown as T;
    }

    return value;
  }

  /**
   * Load initiative ID for a given task ID
   */
  private async loadTaskInitiativeId(
    taskId: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeId | undefined> {
    try {
      const task = await this.taskService.findOneForAdapter(
        taskId,
        organizationId,
      );

      if (!task) {
        this.logger.warn(`Task not found for ID: ${taskId}`, {
          taskId,
          organizationId,
        });
        return undefined;
      }

      return task.initiativeId as InitiativeId;
    } catch (error) {
      this.logger.error(
        `Error loading initiative ID for task ${taskId}:`,
        error,
      );
      return undefined;
    }
  }
}
