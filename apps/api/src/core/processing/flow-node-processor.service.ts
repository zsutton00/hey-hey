import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Client } from '@temporalio/client';
import { MessageStatus } from 'src/constants/message-status.constants';
import {
  ErrorSystemMessageData,
  QuestionsSystemMessageData,
  SystemMessageData,
  SystemMessageResponseType,
} from 'src/generated';
import { InjectTemporalClient } from 'src/prisma/temporal.module';
import { IntentDetectorService } from 'src/services/intent-detector.service';
import {
  AgentWorkflowJobData,
  FlowNodeQueueJob,
  IJobEnqueuer,
} from 'src/services/interfaces/job-enqueuer.interface';
import { JOB_ENQUEUER_TOKEN } from 'src/services/job.tokens';
import { LLMClientService } from 'src/services/llm/llm-client.service';
import { StructuredOutputValidationError } from 'src/services/llm/providers/claude-llm.provider';
import { LLMProviderName, OpenAIModel } from 'src/services/llm/llm-shared';
import type {
  LLMCostData,
  ModelSelectionCriteria,
} from 'src/services/llm/llm-types';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { MessageService } from 'src/services/message.service';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  RequestId,
  WorkflowId,
} from 'src/types';
import {
  createMutableContextHandle,
  MutableContextHandle,
} from 'src/utils/mutable-context';
import { z } from 'zod';
import {
  FlowNodeErrorRecoveryService,
  RecoveryResult,
} from '../../services/workflows/flow-node-error-recovery.service';
import {
  AgentNodeBase,
  CompensationContext,
  FlowContext,
  FlowUserMessage,
  hasBeforeGeneration,
  hasPrecomputedResponse,
  hasProcessLlmResponse,
  hasPromptConfig,
  INode,
  Intent,
  IntermediateSystemMessageData,
  isAgentNode,
  isClassificationNode,
  isPromptConfigurableNode,
  NodeResult,
  NodeType,
  SkipToNodeConfig,
  TransitionDefinition,
  TwoOrMoreTransitions,
} from '../../types/flow-internal.types';
import { MessageResponseUtil } from '../../utils/message-response.util';
import { convertNodeResultToSystemMessage } from '../../utils/node-result-to-system-message.util';
import { WorkflowSignals } from '../../utils/workflow-signals.util';
import {
  addToServiceChain,
  enrichEventContext,
  trackProcessingTime,
} from '../events/context-utils';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { WithWorkflowContext } from '../events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import { EVENT_TYPES } from '../events/types/event.types';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import { JobNonRetryableException } from 'src/common/exceptions/job-non-retryable.exception';
import { isTimelineMessage } from 'src/mappers/message.mapper';

// Error classification for retry logic
enum ErrorType {
  RETRYABLE = 'retryable',
  NON_RETRYABLE = 'non_retryable',
  RATE_LIMITED = 'rate_limited',
  TIMEOUT = 'timeout',
}

interface ClassifiedError {
  type: ErrorType;
  originalError: Error;
  retryAfter?: number; // milliseconds
  context?: Record<string, unknown>;
}

// Schema for LLM routing response
const LLMRoutingResponseSchema = z.object({
  selectedTransition: z.string().describe('The transition key to follow'),
  reasoning: z.string().describe('Explanation for the routing decision'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence level (0-1) for this decision'),
});

type LLMRoutingResponse = z.infer<typeof LLMRoutingResponseSchema>;

export const flowNodeSet = new Set();

/**
 * Processes flow node execution jobs from the queue.
 * Handles the execution of individual flow nodes and updates message states.
 */
@Injectable()
export class FlowNodeProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(FlowNodeProcessor.name);

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    @Inject(JOB_ENQUEUER_TOKEN) private jobEnqueuer: IJobEnqueuer,
    private messageService: MessageService,
    @InjectTemporalClient() private temporalClient: Client,
    private nodeExecutionService: NodeExecutionService,
    private llmClientService: LLMClientService,
    private promptBuilder: PromptBuilderService,
    private intentDetector: IntentDetectorService,
    private errorRecoveryService: FlowNodeErrorRecoveryService,
    private flowExecutionService: FlowExecutionService,
    private flowRecoverySerivce: FlowNodeErrorRecoveryService,
  ) {
    if (process.env.NODE_ENV !== 'test') {
      flowNodeSet.add(this);
      if (flowNodeSet.size > 1) {
        throw new Error(
          'Duplicate FlowNodeProcessor instance detected. Ensure a single instance exists across the application.',
        );
      }
    }
    this.logger.log('FlowNodeProcessor initialized', {
      count: flowNodeSet.size,
    });
  }

  onModuleInit() {
    this.logger.log('Flow Node Processor initialized');
  }

  onModuleDestroy() {
    flowNodeSet.delete(this);
  }

  @WithWorkflowContext((...args) => {
    const [job] = args as [FlowNodeQueueJob];
    return {
      sourceService: 'FlowNodeProcessor',
      sourceMethod: 'processFlowNode',
      context: job,
      workflowId: job.workflowId,
      nodeId: job.data.nodeId,
      metadata: {
        flowId: job.data.flowId,
        requestId: job.requestId,
      },
    };
  })
  async processFlowNode(job: FlowNodeQueueJob): Promise<void> {
    // Enrich context with flow-specific metadata for comprehensive debugging
    const processingStartTime = Date.now();
    enrichEventContext({
      flowId: job.data.flowId,
      nodeId: job.data.nodeId,
      requestId: job.requestId,
      processingStartTime,
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('FlowNodeProcessor');

    this.logger.debug('[processFlowNode] starting...', {
      jobId: job.id,
    });
    const { requestId, workflowId, conversationId } = job;
    const tracker = createMutableContextHandle(job.data.context);
    const flowConfig = await this.getFlowConfig(job);

    if (!flowConfig) {
      this.logger.debug('[processFlowNode] Flow configuration unavailable', {
        jobId: job.id,
        flowId: job.data.flowId,
        nodeId: job.data.nodeId,
      });
      return;
    }

    const { node, circuitKey } = flowConfig;

    try {
      if (!node) {
        const error = new Error(
          `Node ${job.data.nodeId} not found in NodeRegistry`,
        );
        this.logger.error(
          `[processFlowNode] Flow node ${job.data.nodeId} failed`,
          {
            error: error.message,
            errorName: error.name,
            nodeId: job.data.nodeId,
            requestId,
            conversationId,
            attempts: job.attempts || 0,
          },
        );

        const event = this.createFailedCompleteEvent(
          requestId,
          job,
          workflowId,
          conversationId,
          {
            message: error.message,
            code: 'NODE_NOT_FOUND_IN_REGISTRY',
          },
        );

        // Publish failure event and return
        await this.eventPublisher.publish(event);
        return;
      }
      // Check if node requires agent processing first
      if (isAgentNode(node)) {
        this.logger.log(`Processing agent node ${node.id}`, {
          nodeId: node.id,
          nodeType: node.type,
          jobId: job.id,
        });

        // Route agent nodes to dedicated agent processor
        return void (await this.processAgentNode(job, node));
      }

      // Check if node requires LLM processing
      if (this.requiresLLM(node)) {
        const isComplete = await this.executeRequiresLLMNode(
          job,
          node,
          processingStartTime,
          tracker,
        );
        if (isComplete) {
          return;
        }
      } else {
        await this.executeNonLLMRequiredNode(
          job,
          node,
          processingStartTime,
          circuitKey,
          tracker,
        );
      }
    } catch (error) {
      if (error instanceof JobNonRetryableException) {
        this.logger.error(
          '[processFlowNode] Non-retryable error, skipping recovery',
          {
            error: error.message,
            nodeId: node.id,
            requestId,
            conversationId,
          },
        );
        throw error;
      }
      // Use error recovery service instead of queue-based retries
      const recoveryResult = this.errorRecoveryService.handleErrorRecovery(
        node.id,
        job.organizationId,
        error as Error,
        `flow_node_${node.type}_${node.id}`,
      );

      // Enhanced error logging with recovery decision
      this.logger.error(
        `[processFlowNode] Flow node ${node.id} execution failed`,
        {
          error: (error as Error).message,
          errorName: (error as Error).name,
          stack: (error as Error).stack,
          nodeType: node.type,
          requestId,
          conversationId,
          attempts: job.attempts || 0,
          shouldRetry: recoveryResult.shouldRetry,
          delayMs: recoveryResult.delayMs,
          nextStep: recoveryResult.nextStep,
          errorMessage: recoveryResult.errorMessage,
        },
      );

      // Handle permanent failures (non-retryable or max retries exceeded)
      const classifiedError = this.classifyError(error as Error, {
        nodeId: node.id,
        nodeType: node.type,
        conversationId,
        requestId,
        attempts: job.attempts || 0,
      });

      // Try compensation first for LLM/Agent/Classifier failures
      const compensationHandled = await this.handleNodeCompensation(
        node,
        job,
        tracker,
        error as Error,
        classifiedError,
        recoveryResult,
        circuitKey,
        requestId,
        workflowId,
      );

      if (compensationHandled) {
        return; // Exit - compensation handled the error
      }

      const retried = this.retryNode(recoveryResult, node, job, requestId);

      if (retried) {
        return;
      }

      if (this.requiresLLM(node)) {
        const llmError =
          error instanceof Error
            ? error
            : new Error('Unknown LLM processing error');
        await this.completeFailedLLMNode({
          requestId,
          workflowId,
          status: 'failed',
          nodeId: node.id,
          nodeType: node.type,
          tracker,
          classifiedError,
          error: {
            message: llmError.message,
            code: this.getErrorCode(classifiedError),
          },
        });
      } else {
        await this.completeFailedNonLLMNode(
          classifiedError,
          node,
          job,
          requestId,
          workflowId,
          conversationId,
          recoveryResult,
          error,
          tracker,
        );

        // Record failure for circuit breaker (only for retryable errors that indicate system issues)
      }

      if (
        classifiedError.type === ErrorType.RETRYABLE ||
        classifiedError.type === ErrorType.TIMEOUT ||
        classifiedError.type === ErrorType.RATE_LIMITED
      ) {
        this.flowRecoverySerivce.recordCircuitBreakerFailure(circuitKey);
      }

      // Don't throw - we've handled the error appropriately
      // This prevents the queue from doing its own retry logic
      if (!recoveryResult.shouldRetry) {
        this.logger.error(
          '[processFlowNode] Detected non-retryable error, throwing JobNonRetryableException',
          {
            nodeId: node.id,
            error: (error as Error).message,
            recoveryResult,
          },
        );
        throw new JobNonRetryableException(
          recoveryResult.errorMessage || (error as Error).message,
          error as Error,
        );
      }
    }
  }

  private createFailedCompleteEvent(
    requestId: RequestId,
    job: FlowNodeQueueJob,
    workflowId: WorkflowId,
    conversationId: ConversationId,
    error: {
      message: string;
      code: string;
    },
    systemMessageData?: SystemMessageData,
  ) {
    return {
      type: EVENT_TYPES.FLOW_NODE.COMPLETE,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,
        organizationId: job.organizationId,
        projectId: job.projectId,
        requestId,
        workflowId,
        conversationId,
        userId: job.userId,
        nodeId: job.data.nodeId,
        nodeType: 'UNKNOWN',
        status: 'failed' as const,
        systemMessageData,
        error,
      },
    };
  }

  private async completeFailedNonLLMNode(
    classifiedError: ClassifiedError,
    node: INode,
    job: FlowNodeQueueJob,
    requestId: RequestId,
    workflowId: WorkflowId,
    conversationId: ConversationId,
    recoveryResult: RecoveryResult,
    error: unknown,
    tracker: MutableContextHandle<FlowContext>,
  ) {
    const errorResponse = this.createErrorResponse(classifiedError, node);

    // Update message with permanent failure
    await this.updateMessageWithNodeResult(job, errorResponse, 'failed');

    // Send error signal to workflow
    await this.flowExecutionService.sendNodeResponseToWorkflow(
      requestId,
      workflowId,
      errorResponse,
      null,
      true,
      tracker,
    );

    const event = this.createFailedCompleteEvent(
      requestId,
      job,
      workflowId,
      conversationId,
      {
        message: recoveryResult.errorMessage || (error as Error).message,
        code: this.getErrorCode(classifiedError),
      },
      errorResponse,
    );

    // Emit FLOW_NODE.COMPLETE event with failure details
    await this.eventPublisher.publish(event);
  }

  /**
   * Classify errors to determine retry strategy
   */
  private classifyError(
    error: Error,
    context: Record<string, unknown>,
  ): ClassifiedError {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name;

    if (error instanceof StructuredOutputValidationError) {
      return {
        type: ErrorType.RETRYABLE,
        originalError: error,
        context: { ...context, reason: 'structured_output_validation' },
      };
    }

    // Rate limiting errors
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429') ||
      errorMessage.includes('529') ||
      errorMessage.includes('overloaded')
    ) {
      return {
        type: ErrorType.RATE_LIMITED,
        originalError: error,
        retryAfter: this.extractRetryAfter(error.message),
        context: { ...context, reason: 'rate_limited' },
      };
    }

    // Timeout errors
    if (
      errorName === 'AbortError' ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ETIMEDOUT')
    ) {
      return {
        type: ErrorType.TIMEOUT,
        originalError: error,
        context: { ...context, reason: 'timeout' },
      };
    }

    // Network/API errors that are typically retryable
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('504') ||
      errorName === 'FetchError'
    ) {
      return {
        type: ErrorType.RETRYABLE,
        originalError: error,
        context: { ...context, reason: 'network_error' },
      };
    }

    // Authentication/Authorization errors - not retryable
    if (
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('api key')
    ) {
      return {
        type: ErrorType.NON_RETRYABLE,
        originalError: error,
        context: { ...context, reason: 'auth_error' },
      };
    }

    // Not found errors - not retryable
    if (
      errorMessage.includes('404') ||
      errorMessage.includes('not found') ||
      errorName === 'NotFoundException'
    ) {
      return {
        type: ErrorType.NON_RETRYABLE,
        originalError: error,
        context: { ...context, reason: 'not_found_error' },
      };
    }

    // Validation errors - not retryable
    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('bad request') ||
      errorMessage.includes('400')
    ) {
      return {
        type: ErrorType.NON_RETRYABLE,
        originalError: error,
        context: { ...context, reason: 'validation_error' },
      };
    }

    // Default to retryable for unknown errors
    return {
      type: ErrorType.RETRYABLE,
      originalError: error,
      context: { ...context, reason: 'unknown_error' },
    };
  }

  /**
   * Check if a node type requires LLM processing
   * Note: AGENT nodes are now processed through dedicated agent pipeline
   */
  private requiresLLM(node: INode): boolean {
    const requiredByType = [
      NodeType.LLM_QUESTIONS,
      NodeType.ANALYZE,
      NodeType.GENERATE,
      NodeType.CLASSIFICATION,
      // NodeType.AGENT removed - agents have dedicated processing pipeline
    ].includes(node.type);

    this.logger.debug(`Checked if nodeType ${node.type} requires LLM?`, {
      requiredByType,
    });

    return requiredByType;
  }

  /**
   * Process agent node through dedicated agent pipeline
   * TODO: AGENT nodes need to be converted to AgentNodeBase (Injectable pattern)
   * This method currently only handles the signature - implementation will come after conversion
   */
  private async processAgentNode(
    job: FlowNodeQueueJob,
    node: AgentNodeBase,
  ): Promise<void> {
    const { requestId, workflowId, conversationId } = job;
    const { context, userMessage } = job.data;
    const contextHandle = createMutableContextHandle(context);

    // Get agent ID from node configuration - support dynamic resolution
    let agentId: string;
    if ('agentId' in node) {
      if (typeof node.agentId === 'function') {
        agentId = await node.agentId(contextHandle);
      } else {
        agentId = node.agentId;
      }
    } else {
      agentId = 'default-agent';
    }

    if (!agentId) {
      throw new Error(`Agent node ${node.id} is missing agentId configuration`);
    }

    // Get dynamic prompts if configured
    let userPrompt: string = '';

    if ('userPrompt' in node && node.userPrompt) {
      if (typeof node.userPrompt === 'function') {
        this.logger.debug(`[processAgentNode] calling userPrompt`, {
          userMessage,
        });
        userPrompt = await node.userPrompt(contextHandle, userMessage);
      } else {
        userPrompt = node.userPrompt;
      }
    }

    this.logger.log(`Queuing agent workflow for node ${node.id}`, {
      agentId,
      nodeId: node.id,
      requestId,
      workflowId,
      conversationId,
      hasUserPrompt: !!userPrompt,
    });

    // Create agent workflow job data
    const agentJobData: AgentWorkflowJobData = {
      type: 'agent_workflow',
      agentId,
      conversationId,
      context,
      nodeId: node.id,
      workflowAboutId: context.core.workflowAboutId,
      workflowAboutType: context.core.workflowAboutType,
      userMessage,
      userPrompt,
      options: {
        maxExecutionTime: 300000, // 5 minutes
        temperature: 0.7,
      },
    };

    // Queue the agent workflow job
    await this.jobEnqueuer.queueAgentWorkflow(agentJobData, {
      organizationId: job.organizationId,
      projectId: job.projectId,
      requestId,
      workflowId,
      conversationId,
      userId: job.userId,
      messageId: job.messageId,
      userMessage: job.userMessage,
    });

    this.logger.log(`Agent workflow queued for node ${node.id}`, {
      agentId,
      requestId,
      workflowId,
    });
  }
  /**
   * Extract retry-after value from error message
   */
  private extractRetryAfter(errorMessage: string): number {
    const match = errorMessage.match(/retry[- ]?after[:\s]+(\d+)/i);
    if (match?.[1]) {
      return parseInt(match[1]) * 1000; // Convert to milliseconds
    }
    // Default rate limit backoff: 5 minutes
    return 5 * 60 * 1000;
  }

  /**
   * Handle retry execution for flow nodes with proper delay
   */
  private async retryFlowNodeExecution(
    originalJob: FlowNodeQueueJob,
    delayMs: number,
  ): Promise<void> {
    this.logger.warn(
      `Retrying flow node ${originalJob.data.nodeId} after ${delayMs}ms delay`,
      {
        nodeId: originalJob.data.nodeId,
        nodeType: this.nodeExecutionService.getNode(
          originalJob.data.flowId,
          originalJob.data.nodeId,
        )?.node.type,
        attempts: originalJob.attempts || 0,
        delayMs,
        requestId: originalJob.requestId,
      },
    );

    // Wait for the specified delay
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // Re-execute the flow node with incremented attempt count
    const retryJob = {
      ...originalJob,
      attempts: (originalJob.attempts || 0) + 1,
    };

    try {
      await this.processFlowNode(retryJob);
    } catch (error) {
      this.logger.error(
        `Retry execution failed for flow node ${originalJob.data.nodeId}`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          nodeId: originalJob.data.nodeId,
          attempts: retryJob.attempts,
          requestId: originalJob.requestId,
        },
      );
      // Don't re-throw - let the error recovery manager handle it if called again
    }
  }

  /**
   * Create appropriate error response based on error classification
   */
  private createErrorResponse(
    classifiedError: ClassifiedError,
    node: INode | { id: string },
  ): ErrorSystemMessageData {
    const { type, originalError, context } = classifiedError;

    switch (type) {
      case ErrorType.RATE_LIMITED:
        return {
          type: SystemMessageResponseType.Error,
          nodeId: node.id,
          response:
            "I'm currently experiencing high demand. Let me try again in a moment.",
          detectedIntent: 'error_handling',
          intentConfidence: 1.0,
          reasoning: 'Rate limit exceeded',
          errorType: 'rate_limited',
          temporary: true,
        };

      case ErrorType.TIMEOUT:
        return {
          type: SystemMessageResponseType.Error,
          nodeId: node.id,
          response:
            'The request is taking longer than expected. Let me try again.',
          detectedIntent: 'error_handling',
          intentConfidence: 1.0,
          reasoning: 'Request timeout',
          errorType: 'timeout',
          temporary: true,
          context: context?.reason as string,
        };

      case ErrorType.NON_RETRYABLE:
        return {
          type: SystemMessageResponseType.Error,
          nodeId: node.id,
          response: this.getHumanFriendlyErrorMessage(
            originalError,
            context?.reason as string,
          ),
          detectedIntent: 'error_handling',
          intentConfidence: 1.0,
          reasoning: 'Non-retryable error',
          errorType: 'permanent',
          temporary: false,
          context: context?.reason as string,
        };

      case ErrorType.RETRYABLE:
      default:
        return {
          type: SystemMessageResponseType.Error,
          nodeId: node.id,
          response: 'I encountered a temporary issue. Let me try again.',
          detectedIntent: 'error_handling',
          intentConfidence: 1.0,
          reasoning: 'Retryable error',
          errorType: 'retryable',
          temporary: true,
          context: context?.reason as string,
        };
    }
  }

  /**
   * Get human-friendly error message for non-retryable errors
   */
  private getHumanFriendlyErrorMessage(_error: Error, reason?: string): string {
    switch (reason) {
      case 'auth_error':
        return "I'm having trouble with my authentication. Please contact support to resolve this issue.";
      case 'validation_error':
        return 'There seems to be an issue with the request format. Let me try a different approach.';
      case 'llm_error':
        return "I'm having trouble processing your request right now. Please try again in a moment.";
      default:
        return "I encountered an issue that I can't resolve automatically. Please try again or contact support if the problem persists.";
    }
  }

  /**
   * Get error code for classification
   */
  private getErrorCode(classifiedError: ClassifiedError): string {
    const baseCode = 'FLOW_NODE_ERROR';

    switch (classifiedError.type) {
      case ErrorType.RATE_LIMITED:
        return `${baseCode}_RATE_LIMITED`;
      case ErrorType.TIMEOUT:
        return `${baseCode}_TIMEOUT`;
      case ErrorType.NON_RETRYABLE:
        return `${baseCode}_PERMANENT`;
      case ErrorType.RETRYABLE:
      default:
        return `${baseCode}_RETRYABLE`;
    }
  }

  /**
   * Handle node compensation logic for LLM/Agent/Classifier failures
   * Returns true if compensation handled the error, false otherwise
   */
  private async handleNodeCompensation(
    node: INode,
    job: FlowNodeQueueJob,
    tracker: MutableContextHandle<FlowContext>,
    error: Error,
    classifiedError: ClassifiedError,
    recoveryResult: { shouldRetry: boolean },
    circuitKey: string,
    requestId: RequestId,
    workflowId: WorkflowId,
  ): Promise<boolean> {
    // Check if node supports compensation
    if (!node.compensate) {
      return false; // No compensation available
    }

    const compensationContext: CompensationContext = {
      nodeId: node.id,
      requestId,
      failurePhase: 'execution', // LLM/Agent execution phase
      attemptCount: job.attempts || 0,
      errorClassification: {
        type: classifiedError.type.toUpperCase() as
          | 'RETRYABLE'
          | 'NON_RETRYABLE'
          | 'RATE_LIMITED'
          | 'TIMEOUT',
        permanent: !recoveryResult.shouldRetry,
        circuitBreakerTriggered:
          this.flowRecoverySerivce.isCircuitOpen(circuitKey),
      },
      transactionState: {
        messageCreated: !!job.messageId,
        jobQueued: true,
        contextModified: false, // TODO: track if needed
        artifactsCreated: false, // TODO: track if needed
      },
      timestamp: new Date(),
    };

    try {
      const compensationResult = await node.compensate(
        tracker.getContext(),
        error,
        compensationContext,
      );

      // Handle compensation decision
      if (
        compensationResult.action === 'RETRY' &&
        !this.flowRecoverySerivce.isCircuitOpen(circuitKey)
      ) {
        this.logger.log(`Node ${node.id} compensation decision: RETRY`, {
          requestId,
          retryDelayMs: compensationResult.retryDelayMs,
          reason: compensationResult.reason,
        });

        // TODO: Update compensation retry for Injectable nodes
        // queueFlowNodeExecution still expects ConversationNode (legacy)
        // Need to update job enqueuer interface to work with INode
        // For now, compensation retry is disabled until job enqueuer is updated
        this.logger.warn(
          `Compensation retry requested for node ${node.id} but not yet implemented for Injectable nodes`,
          {
            requestId,
            retryDelayMs: compensationResult.retryDelayMs,
            reason: compensationResult.reason,
          },
        );
        return false; // Fall through to normal error handling
      } else if (this.flowRecoverySerivce.isCircuitOpen(circuitKey)) {
        // Force FAIL when circuit is open
        this.logger.log(
          `Node ${node.id} compensation decision: Circuit breaker open, forcing FAIL`,
          {
            requestId,
            reason: 'Circuit breaker protection active',
          },
        );
        return false; // Fall through to normal error handling
      } else if (compensationResult.action === 'SKIP_TO_NODE') {
        // Validate nextNodeId exists
        if (!compensationResult.nextNodeId) {
          this.logger.error(
            `Node ${node.id} compensation: SKIP_TO_NODE requires nextNodeId`,
            {
              requestId,
              reason: compensationResult.reason,
            },
          );
          return false; // Fall through to normal error handling
        }

        // TODO: Validate that nextNodeId exists in flow template
        this.logger.log(`Node ${node.id} compensation decision: SKIP_TO_NODE`, {
          requestId,
          nextNodeId: compensationResult.nextNodeId,
          reason: compensationResult.reason,
        });

        // Update message status to indicate it was skipped
        await this.updateMessageWithNodeResult(
          job,
          {
            type: SystemMessageResponseType.Noop,
            response: `Skipped due to: ${compensationResult.reason}`,
            title: 'Technical Recovery',
          },
          'success',
        );

        // Create success response to continue workflow
        const skipResponse: SystemMessageData = {
          type: SystemMessageResponseType.Noop,
          response: `Skipping past ${node.id} due to: ${compensationResult.reason}`,
          title: 'Technical Recovery',
        };

        // Send success signal to workflow with next node
        await this.flowExecutionService.sendNodeResponseToWorkflow(
          requestId,
          workflowId,
          skipResponse,
          compensationResult.nextNodeId,
          undefined,
          tracker,
        );

        return true; // Compensation handled the error
      }

      // compensationResult.action === 'FAIL' - halt workflow immediately
      this.logger.log(`Node ${node.id} compensation decision: FAIL`, {
        requestId,
        reason: compensationResult.reason,
      });

      // Create failure response for compensation FAIL
      const compensationFailureResponse: ErrorSystemMessageData = {
        type: SystemMessageResponseType.Error,
        nodeId: node.id,
        response: `Node ${node.id} failed: ${compensationResult.reason || 'Critical node failure'}`,
        detectedIntent: 'compensation_failure',
        intentConfidence: 1.0,
        reasoning: `Node compensation explicitly failed: ${compensationResult.reason}`,
        errorType: 'compensation_failure',
        temporary: false,
        context: compensationResult.reason,
      };

      // Update message with compensation failure
      await this.updateMessageWithNodeResult(
        job,
        compensationFailureResponse,
        'failed',
      );

      // Send error holding signal to workflow - keeps workflow alive for recovery
      await this.flowExecutionService.sendNodeResponseToWorkflow(
        requestId,
        workflowId,
        compensationFailureResponse,
        node.id, // Keep same node for recovery
        true, // errorHolding flag
        tracker,
      );

      // Emit FLOW_NODE.COMPLETE event with compensation failure
      await this.eventPublisher.publish({
        type: EVENT_TYPES.FLOW_NODE.COMPLETE,
        aggregateId: requestId,
        payload: {
          payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,

          organizationId: job.organizationId,
          projectId: job.projectId,
          requestId,
          workflowId,
          conversationId: job.conversationId,
          userId: job.userId,
          nodeId: node.id,
          nodeType: node.type,
          status: 'failed',
          systemMessageData: compensationFailureResponse,
          error: {
            message: `Node compensation failed: ${compensationResult.reason}`,
            code: 'COMPENSATION_FAILURE',
          },
        },
      });

      return true; // Compensation handled the error by putting workflow in error holding
    } catch (compensationError) {
      this.logger.error(`Compensation failed for node ${node.id}`, {
        originalError: error.message,
        compensationError: (compensationError as Error).message,
        nodeId: node.id,
        requestId,
      });
      // Continue with normal error handling - compensation failures are non-fatal
      return false;
    }
  }

  private async getFlowConfig(job: FlowNodeQueueJob) {
    const { requestId, workflowId, conversationId } = job;
    const { flowId, nodeId } = job.data;
    const nodeData = this.nodeExecutionService.getNode(flowId, nodeId);

    if (!nodeData) {
      const error = new Error(
        `Could not find node ${nodeId} for flow ${flowId}`,
      );
      this.logger.error(
        `[getFlowConfig] Flow node ${nodeId} execution failed`,
        {
          error: error.message,
          errorName: error.name,
          nodeType: 'unknown',
          requestId,
          conversationId,
          attempts: job.attempts || 0,
        },
      );

      // Publish failure event and return
      await this.eventPublisher.publish({
        type: EVENT_TYPES.FLOW_NODE.COMPLETE,
        aggregateId: requestId,
        payload: {
          payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,
          organizationId: job.organizationId,
          projectId: job.projectId,
          requestId,
          workflowId,
          conversationId,
          userId: job.userId,
          nodeId: nodeId,
          nodeType: 'unknown' as NodeType,
          status: 'failed' as const,
          error: {
            message: error.message,
            code: 'NODE_NOT_FOUND',
          },
        },
      });
      return;
    }

    const { node: node, routing } = nodeData;
    const nodeType = node.type;

    // Enrich context with node-specific metadata
    enrichEventContext({
      nodeType,
    });

    // Check circuit breaker before processing
    const circuitKey = this.flowRecoverySerivce.getCircuitBreakerKey(
      nodeType,
      job.organizationId,
    );
    if (this.flowRecoverySerivce.isCircuitOpen(circuitKey)) {
      const error = new Error(`Circuit breaker is open for ${nodeType} nodes`);
      error.name = 'CIRCUIT_BREAKER_OPEN';
      throw error;
    }

    this.logger.debug(`[processFlowNode] starting job ${job.id}`, {
      flowId,
      nodeId,
      conversationId,
      workflowId,
      attempts: job.attempts || 0,
    });

    // Emit FLOW_NODE.START event
    await this.eventPublisher.publish({
      type: EVENT_TYPES.FLOW_NODE.START,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.FLOW_NODE.START,

        organizationId: job.organizationId,
        projectId: job.projectId,
        requestId,
        workflowId,
        conversationId,
        userId: job.userId,
        nodeId,
        nodeType,
      },
    });

    return {
      node,
      routing,
      circuitKey,
    };
  }

  private async executeRequiresLLMNode(
    job: FlowNodeQueueJob,
    freshNode: INode,
    processingStartTime: number,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<boolean> {
    const {
      requestId,
      organizationId,
      projectId,
      userId,
      workflowId,
      conversationId,
    } = job;
    const flowUserId = tracker.getContext().core.user?.id ?? userId;
    this.logger.debug(`node ${freshNode.id} for job ${job.id} requires LLM`);
    // Get message ID from job data
    const messageId = job.messageId;

    if (!messageId) {
      throw new Error(`No messageId found in job data for flow node ${job.id}`);
    }

    // Check if node has prompt configuration (type guard)
    if (!isPromptConfigurableNode(freshNode)) {
      throw new Error(
        `Node ${freshNode.id} is not LLM-configurable but prompt building was attempted`,
      );
    }

    if (!hasPromptConfig(freshNode)) {
      throw new Error(
        `Node ${freshNode.id} requires LLM but has no prompt configuration`,
      );
    }

    // Call beforeGeneration if node provides it (allows side effects before LLM calls)
    await this.beforeGeneration(freshNode, job, tracker);

    // Check if classification node can use preClassify to bypass LLM
    if (isClassificationNode(freshNode) && job.data.userMessage) {
      const isPreClassified = await this.attemptPreclassification({
        freshNode,
        tracker,
        job,
        messageId,
        workflowId,
        nodeId: freshNode.id,
      });

      // early exit
      if (isPreClassified) {
        return true;
      }
    }

    let systemMessageData: IntermediateSystemMessageData;
    let costData: LLMCostData | undefined;
    const precomputedResponse = await this.getPrecomputedResponse(
      freshNode,
      job,
      tracker,
    );

    if (precomputedResponse) {
      this.logger.log(
        '[executeRequiresLLMNode] using precomputed response from node',
        {
          nodeId: freshNode.id,
          requestId,
          workflowId,
          conversationId,
        },
      );
      systemMessageData = precomputedResponse;
    } else {
      // Get routing config from flow template to access full transition definitions
      const availableTransitions = this.getTransitions(job, freshNode.id);

      // Build the prompt using standard prompt building
      const prompt = await this.promptBuilder.buildPrompt(
        freshNode,
        tracker,
        job.data.userMessage,
        availableTransitions,
        undefined, // options
      );

      let nodeModelCriteria: ModelSelectionCriteria | undefined =
        freshNode.promptConfig.modelCriteria;

      if (!nodeModelCriteria) {
        if (isClassificationNode(freshNode)) {
          nodeModelCriteria = {
            provider: LLMProviderName.OPENAI,
            model: OpenAIModel.GPT_5_NANO,
          };
        } else {
          nodeModelCriteria = {
            provider: LLMProviderName.CLAUDE,
            anthropicTier: 'haiku',
          };
        }
      }

      const nodeMaxTokens = freshNode.promptConfig.maxTokens;

      const responseSchema = freshNode.promptConfig?.responseSchema;
      if (!responseSchema) {
        throw new Error(
          `Missing response schema for LLM node ${freshNode.id}. A responseSchema is required for structured LLM calls.`,
        );
      }

      const llmResponse =
        await this.llmClientService.callStructured<IntermediateSystemMessageData>(
          prompt.fullPrompt,
          {
            modelCriteria: nodeModelCriteria,
            temperature: prompt.temperature || 0.7,
            topP: freshNode.promptConfig.topP,
            reasoningEffort: freshNode.promptConfig.reasoningEffort,
            responseFormat: freshNode.promptConfig.responseFormat,
            useToolCallSchema: freshNode.promptConfig.useToolCallSchema,
            toolName: freshNode.promptConfig.toolName,
            maxTokens: nodeMaxTokens,
            timeout: freshNode.promptConfig?.timeout,
            stream: false,
            userMessage: job.userMessage,
            responseType: 'analysis',
            responseSchema,
          },
          {
            organizationId,
            workflowId,
            projectId,
            conversationId,
            userId: flowUserId,
            nodeId: freshNode.id,
            mockLlmSessionId: tracker.getContext().mockLlmSessionId,
          },
        );

      systemMessageData = llmResponse.content;
      costData = llmResponse.costData;
    }

    // Track processing completion time for LLM path
    trackProcessingTime('processing', processingStartTime);

    systemMessageData.nodeId = freshNode.id;

    // Log if LLM provided routing decision via detectedIntent
    const detectedIntent = (systemMessageData as { detectedIntent?: string })
      .detectedIntent;
    if (detectedIntent) {
      const reasoning = (systemMessageData as { reasoning?: string }).reasoning;
      this.logger.log(
        '[executeRequiresLLMNode] LLM included routing decision in response',
        {
          nodeId: freshNode.id,
          detectedIntent,
          reasoning,
        },
      );
    }

    const event = {
      type: EVENT_TYPES.LLM.COMPLETE,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.LLM.COMPLETE,

        // Spread all ExecutionContext properties from job
        organizationId,
        projectId,
        userId,
        requestId,
        workflowId,
        conversationId,
        messageId,
        userMessage: job.userMessage,
        nodeId: freshNode.id,
        flowConfig: {
          nodeId: freshNode.id,
          nodeType: freshNode.type,
          context: job.data.context,
          jobId: job.id,
        },
        // Complete-specific properties
        status: 'success',
        duration: 0, // filled by consumer if needed
        systemMessageData,
        // Cost tracking data
        costData: costData
          ? {
              model: costData.model,
              inputTokens: costData.inputTokens,
              outputTokens: costData.outputTokens,
              totalTokens: costData.totalTokens,
              inputCost: costData.inputCost,
              outputCost: costData.outputCost,
              totalCost: costData.totalCost,
            }
          : undefined,
      },
    };

    this.completeLLMNode({
      organizationId,
      requestId,
      workflowId,
      messageId,
      userMessage: job.userMessage,
      status: 'success',
      nodeId: freshNode.id,
      nodeType: freshNode.type,
      tracker,
      systemMessageData,
      flowId: job.data.flowId,
    }).catch((error) => {
      this.logger.error('[executeRequiresLLMNode] completeLLMNode failed', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        nodeId: freshNode.id,
        requestId,
        workflowId,
      });
    });

    // Publish LLM.COMPLETE event
    await this.eventPublisher.publish(event);

    return false;
  }

  private getTransitions(job: FlowNodeQueueJob, nodeId: string) {
    const nodeData = this.nodeExecutionService.getNode(job.data.flowId, nodeId);
    const availableTransitions =
      nodeData && 'transitions' in nodeData.routing
        ? nodeData.routing.transitions
        : undefined;
    return availableTransitions;
  }

  private async executeNonLLMRequiredNode(
    job: FlowNodeQueueJob,
    freshNode: INode,
    processingStartTime: number,
    circuitKey: string,
    tracker: MutableContextHandle<FlowContext>,
  ) {
    const {
      requestId,
      workflowId,
      conversationId,
      data: { flowId },
    } = job;
    const baseContext = tracker.getContext();
    this.logger.debug(
      `node ${freshNode.id} for job ${job.id} does not require LLM`,
    );

    // Get node from flow template
    const nodeData = this.nodeExecutionService.getNode(flowId, freshNode.id);
    if (!nodeData) {
      throw new Error(
        `Node ${freshNode.id} not found in flow ${flowId}. ` +
          `All nodes must be defined in flow templates.`,
      );
    }

    // Execute with routing config from flow template
    const { node: node, routing } = nodeData;

    this.logger.debug(`Using Injectable node from registry for ${node.id}`);

    // Execute with routing config from flow template
    const result = await this.nodeExecutionService.executeNode(
      node.id,
      tracker,
      routing,
      job.data.userMessage,
    );

    this.logger.log(`Flow node ${freshNode.id} executed successfully`, {
      nodeType: freshNode.type,
      hasResult: !!result.result,
      nextNodeId: result.nextNodeId,
    });

    // Convert node result to SystemMessageData
    let systemMessageData = convertNodeResultToSystemMessage(
      result.result,
      freshNode.type,
      freshNode.id,
    );

    let nextNodeId = result.nextNodeId;

    // Execute current node processLlmResponse with SystemMessageData
    const nodeLlmProcessingResult = await this.executeNodeProcessLlmResponse(
      freshNode,
      systemMessageData,
      job.userMessage,
      tracker,
      freshNode.id,
      job.id,
    );
    systemMessageData = nodeLlmProcessingResult.systemMessageData;

    if (nodeLlmProcessingResult.routingOverride) {
      this.logger.debug(
        '[processFlowNode] Applying current node processLlmResponse routing override',
        {
          originalNextNodeId: nextNodeId,
          routingOverride: nodeLlmProcessingResult.routingOverride,
          nodeId: freshNode.id,
        },
      );
      nextNodeId = nodeLlmProcessingResult.routingOverride;
    }

    // Execute previous node determineRouting with current results
    if (!nodeLlmProcessingResult.routingOverride) {
      const routingOverride =
        await this.nodeExecutionService.executePreviousNodePostProcess(
          freshNode.id,
          systemMessageData,
          baseContext,
        );
      if (routingOverride) {
        this.logger.debug('[processFlowNode] Applying routing override', {
          originalNextNodeId: nextNodeId,
          routingOverride: routingOverride,
        });
        nextNodeId = routingOverride;
      }
    }

    // Update the pending message with the result
    await this.updateMessageWithNodeResult(job, systemMessageData, 'success');

    // Emit FLOW_NODE.COMPLETE event
    await this.eventPublisher.publish({
      type: EVENT_TYPES.FLOW_NODE.COMPLETE,
      aggregateId: requestId,
      payload: {
        payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,

        organizationId: job.organizationId,
        projectId: job.projectId,
        requestId,
        workflowId,
        conversationId,
        userId: job.userId,
        nodeId: freshNode.id,
        nodeType: freshNode.type,
        status: 'success',
        systemMessageData,
      },
    });

    this.logger.debug(
      `[processFlowNode] calling sendNodeResponseToWorkflow for non-LLM node`,
      {
        nextNodeId,
        nextNodeIdType: typeof nextNodeId,
      },
    );

    // Send signal to workflow with the result
    await this.flowExecutionService.sendNodeResponseToWorkflow(
      requestId,
      workflowId,
      systemMessageData,
      nextNodeId ?? null,
      undefined,
      tracker,
    );

    // Record success for circuit breaker and reset error recovery state
    this.flowRecoverySerivce.recordCircuitBreakerSuccess(circuitKey);

    // Reset error recovery state on successful execution
    this.errorRecoveryService.resetErrorRecoveryState(
      freshNode.id,
      job.organizationId,
    );

    // Track processing completion time
    trackProcessingTime('processing', processingStartTime);
  }

  private retryNode(
    recoveryResult: RecoveryResult,
    node: INode,
    job: FlowNodeQueueJob,
    requestId: RequestId,
  ) {
    let retried = false;
    // Fall back to error recovery logic if compensation didn't handle it
    if (recoveryResult.shouldRetry && recoveryResult.delayMs) {
      this.logger.log(
        `Error recovery manager scheduled retry for flow node ${node.id}`,
        {
          nodeId: node.id,
          nodeType: node.type,
          delayMs: recoveryResult.delayMs,
          attempts: job.attempts || 0,
          requestId,
        },
      );

      // Use error recovery manager's calculated delay (respects HTTP status codes)
      // This handles the retry asynchronously without blocking the queue
      this.retryFlowNodeExecution(job, recoveryResult.delayMs).catch(
        (retryError) => {
          this.logger.error(`Async retry failed for flow node ${node.id}`, {
            retryError:
              retryError instanceof Error
                ? retryError.message
                : 'Unknown error',
            nodeId: node.id,
            requestId,
          });
        },
      );

      // Don't throw - we're handling the retry via error recovery manager
      retried = true;
    }
    return retried;
  }

  private async beforeGeneration(
    node: INode,
    job: FlowNodeQueueJob,
    context: MutableContextHandle<FlowContext>,
  ) {
    if (hasBeforeGeneration(node)) {
      try {
        this.logger.debug(`Calling beforeGeneration for node ${node.id}`, {
          nodeId: node.id,
          nodeType: node.type,
          jobId: job.id,
        });
        await node.beforeGeneration(context, job.data.userMessage);
        this.logger.debug(`beforeGeneration completed for node ${node.id}`);
      } catch (error) {
        this.logger.error(`beforeGeneration failed for node ${node.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          nodeId: node.id,
          jobId: job.id,
        });
        throw error;
      }
    }
  }

  private async getPrecomputedResponse(
    node: INode,
    job: FlowNodeQueueJob,
    context: MutableContextHandle<FlowContext>,
  ): Promise<IntermediateSystemMessageData | undefined> {
    if (!hasPrecomputedResponse(node)) {
      return undefined;
    }

    try {
      this.logger.debug('Checking node for a precomputed response', {
        nodeId: node.id,
        nodeType: node.type,
        jobId: job.id,
      });
      return await node.getPrecomputedResponse(context, job.data.userMessage);
    } catch (error) {
      this.logger.error('Precomputed response hook failed', {
        nodeId: node.id,
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async attemptPreclassification({
    nodeId,
    workflowId,
    // freshNode,
    tracker,
    job,
    messageId,
  }: {
    nodeId: string;
    workflowId: WorkflowId;
    freshNode: INode;
    tracker: MutableContextHandle<FlowContext>;
    job: FlowNodeQueueJob;
    messageId: MessageId;
  }): Promise<boolean> {
    try {
      const context = tracker.getContext();
      const preClassifyResult =
        await this.nodeExecutionService.executePreClassify(
          nodeId,
          context,
          job.data.userMessage,
        );

      if (preClassifyResult?.routingOverride) {
        this.logger.debug(`PreClassify routing override for node ${nodeId}`, {
          nextNodeId: preClassifyResult.routingOverride.nextNodeId,
          reason: preClassifyResult.routingOverride.reason,
          nodeId,
          jobId: job.id,
        });

        // Update message with classification result and complete processing
        await this.messageService.updateMessage(
          messageId,
          context.core.organizationId,
          {
            status: MessageStatus.Completed,
            data: {
              type: 'QUESTIONS',
              response: `Classified intent and routing to next step: ${preClassifyResult.routingOverride.reason}`,
              detectedIntent: 'magic_string_detected',
              intentConfidence: 1.0,
              uiElements: [],
            },
          },
          { source: 'preClassify routing' },
        );

        // Signal workflow to continue with the determined next node
        const workflowHandle =
          this.temporalClient.workflow.getHandle(workflowId);
        const signalName = WorkflowSignals.getLLMResponseSignalName(workflowId);

        await workflowHandle.signal(signalName, {
          requestId: job.requestId,
          responseData: {
            type: 'QUESTIONS',
            response: `Classified intent and routing to next step: ${preClassifyResult.routingOverride.reason}`,
            detectedIntent: 'magic_string_detected',
            intentConfidence: 1.0,
            uiElements: [],
          },
          nextNodeId: preClassifyResult.routingOverride.nextNodeId,
        });

        return true;
      }
    } catch (error) {
      this.logger.error(`PreClassify failed for node ${nodeId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        nodeId,
        jobId: job.id,
      });
    }
    return false;
  }

  /**
   * Execute processLlmResponse method on a node if it exists
   * This handles the type constraints properly by checking if the node has the method
   */
  private async executeNodeProcessLlmResponse(
    node: INode,
    systemMessageData: IntermediateSystemMessageData,
    userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<FlowContext>,
    nodeId: string,
    jobId?: string,
    messageId?: MessageId,
  ): Promise<{
    systemMessageData: SystemMessageData;
    routingOverride?: string;
  }> {
    // Check if node has processLlmResponse method (type guard)
    if (!hasProcessLlmResponse(node)) {
      return {
        systemMessageData: systemMessageData as SystemMessageData,
      };
    }

    const logContext = jobId ? { nodeId, jobId } : { nodeId, messageId };

    this.logger.debug('Executing processLlmResponse for node', logContext);

    try {
      const result = await node.processLlmResponse(
        systemMessageData,
        userMessage,
        tracker,
      );

      const nextSystemMessageData = result.modifiedResult
        ? result.modifiedResult
        : (systemMessageData as SystemMessageData);

      this.logger.debug('processLlmResponse completed for node', {
        nodeId,
        hasModifiedResult: !!result.modifiedResult,
        hasRoutingOverride: !!result.routingOverride,
      });

      return {
        systemMessageData: nextSystemMessageData,
        routingOverride: result.routingOverride,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('processLlmResponse execution failed for node', {
        error,
        errorMessage: err?.message,
        errorStack: err?.stack,
        nodeId,
        jobId,
        messageId,
        errorType: err?.constructor?.name,
      });
      throw error;
    }
  }

  private async updateMessageWithNodeResult(
    job: FlowNodeQueueJob,
    result: SystemMessageData,
    status: 'success' | 'failed',
  ): Promise<void> {
    try {
      // Get message ID from job data
      const {
        messageId,
        data: { flowId, nodeId },
      } = job;
      const nodeData = this.nodeExecutionService.getNode(flowId, nodeId);

      if (!messageId) {
        this.logger.error(
          `No messageId found in job data for flow node ${job.id}`,
        );
        return;
      }

      if (!nodeData?.node) {
        const flow = this.nodeExecutionService.getFlow(flowId);
        const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
        throw new Error(
          `Could not find node ${nodeId} for flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
        );
      }
      const { node } = nodeData;

      // Determine message status based on result
      const messageStatus =
        status === 'success'
          ? MessageResponseUtil.determineMessageStatus(result)
          : MessageStatus.Failed;

      // ensure we retain nodeId
      result.nodeId = nodeId;

      // Update the message
      await this.messageService.updateMessage(
        messageId,
        job.organizationId,
        {
          status: messageStatus,
          data: result,
        },
        {
          source: 'updateMessageWithNodeResult',
          suppressConversationEvent: false,
        },
      );

      // Initiative creation is now handled directly in flow nodes
      // See: shared_generate_initiatives.node.ts

      // No need to clean up Redis tracking - messageId is in job data

      this.logger.log(`Updated message for flow node completion`, {
        requestId: job.requestId,
        messageId,
        status,
        messageStatus,
        nodeType: node.type,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.warn(
          `Missing message for flow node ${job.id}; stopping retries.`,
          {
            messageId: job.messageId,
            requestId: job.requestId,
            nodeId: job.data.nodeId,
          },
        );
        throw new JobNonRetryableException(error.message, error);
      }
      this.logger.error(
        `Error updating message for flow node ${job.id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Complete a flow node that was waiting for LLM completion
   */
  private async completeLLMNode({
    systemMessageData: llmResponseSystemMessageData,
    requestId,
    status,
    error: _error,
    messageId,
    organizationId,
    tracker,
    nodeId,
    workflowId,
    nodeType,
    userMessage,
    flowId,
  }: {
    systemMessageData?: IntermediateSystemMessageData;
    requestId: RequestId;
    workflowId: WorkflowId;
    status: 'success';
    error?: {
      message: string;
      code: string;
    };
    messageId: MessageId;
    userMessage?: FlowUserMessage;
    organizationId: OrganizationId;
    nodeId: string;
    nodeType: NodeType;
    tracker: MutableContextHandle<FlowContext>;
    flowId: string;
  }): Promise<void> {
    // Enrich context with LLM completion metadata
    enrichEventContext({
      requestId: requestId,
      llmStatus: status,
      nodeId,
      nodeType,
    });
    // Add this service to the service call chain for tracing
    addToServiceChain('FlowNodeProcessor');

    this.logger.debug(`[completeLLMNode] starting`, {
      requestId: requestId,
      llmStatus: status,
      nodeId,
      nodeType,
    });
    const context = tracker.getContext();
    let workflowSignalSent = false;
    try {
      this.logger.log(`Completing LLM flow node`, {
        requestId,
        nodeId,
        nodeType,
      });

      // The LLM has already updated the message, so we just need to:
      // 1. Emit FLOW_NODE.COMPLETE event
      // 2. Send signal to workflow
      // 3. Clean up timeout and resolve promise

      // systemMessageData might still need processing from executeNodeProcessLlmResponse
      let systemMessageData: SystemMessageData;
      if (messageId) {
        // Get the updated message to extract the result

        const nodeData = this.nodeExecutionService.getNode(flowId, nodeId);
        if (!nodeData) {
          throw new Error(`Node ${nodeId} not found in flow ${flowId}`);
        }
        const { node, routing } = nodeData;
        let nextNodeId: string | undefined = '';
        let routingOverride: string | undefined = undefined;

        // Check if this is phase 1 by examining the flow context and node type
        // Phase 1: LLM_QUESTIONS node with no user message (initial execution)
        // Phase 2: LLM_QUESTIONS node with user message (after user responds)
        const isLLMQuestionsNode = node?.type === NodeType.LLM_QUESTIONS;
        const hasUserMessage = !!userMessage;
        const isPhase1 = isLLMQuestionsNode && !hasUserMessage;

        if (isPhase1) {
          this.logger.debug(
            '[completeLLMNode] Phase 1 complete - skipping nextNodeId determination',
            {
              nodeId: node.id,
              nodeType: node.type,
              hasUserMessage,
              phase: 'generate_questions',
            },
          );
        }

        // Extract routing information before processing (preserve from original LLM response)
        // LLM uses detectedIntent field to specify transition key and reasoning field for explanation
        const routingInfo = llmResponseSystemMessageData
          ? {
              detectedIntent: (
                llmResponseSystemMessageData as { detectedIntent?: string }
              ).detectedIntent,
              reasoning: (
                llmResponseSystemMessageData as { reasoning?: string }
              ).reasoning,
            }
          : { detectedIntent: undefined, reasoning: undefined };

        // Execute current node processLlmResponse with SystemMessageData (if it exists)
        if (node) {
          const nodeLlmProcessingResult =
            await this.executeNodeProcessLlmResponse(
              node,

              llmResponseSystemMessageData as IntermediateSystemMessageData,
              userMessage,
              tracker,
              node.id,
              undefined,
              messageId,
            );
          systemMessageData = nodeLlmProcessingResult.systemMessageData;

          if (nodeLlmProcessingResult.routingOverride) {
            routingOverride = nodeLlmProcessingResult.routingOverride;
            nextNodeId = nodeLlmProcessingResult.routingOverride;
          }
        } else {
          systemMessageData = llmResponseSystemMessageData as SystemMessageData;
        }

        // Execute previous node determineRouting with current LLM results
        if (!routingOverride) {
          routingOverride =
            await this.nodeExecutionService.executePreviousNodePostProcess(
              node.id,
              systemMessageData,
              context,
            );
        }

        this.logger.debug(`[completeLLMNode] has routingOverride?`, {
          routingOverride,
        });

        if (routingOverride) {
          nextNodeId = routingOverride;
        }

        // Only perform intent detection and routing if this is not phase 1 and routing wasn't overridden
        if (!isPhase1 && !routingOverride) {
          // Check if node has simple nextNode configuration first
          if ('nextNode' in routing) {
            this.logger.debug(
              '[completeLLMNode] Using simple nextNode configuration',
              {
                nodeId: node.id,
                nextNode: routing.nextNode,
              },
            );
            nextNodeId = routing.nextNode;
          } else if ('transitions' in routing) {
            // Handle transitions-based routing
            nextNodeId = await this.getNextNodeIdFromTransitions(
              messageId,
              organizationId,
              routingInfo,
              routing,
              nextNodeId,
              context,
              systemMessageData,
              node,
            );
          } else {
            this.logger.warn(
              '[completeLLMNode] LLM node has neither nextNode nor transitions',
              {
                nodeId: node.id,
                nodeType: node.type,
              },
            );
          }
        } else if (isPhase1) {
          this.logger.debug(
            '[completeLLMNode] Skipping nextNodeId determination for phase 1',
            {
              nodeId: node.id,
              nodeType: node.type,
            },
          );
        }

        // Emit FLOW_NODE.COMPLETE event
        await this.eventPublisher.publish({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          aggregateId: requestId,
          payload: {
            payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,

            organizationId,
            projectId: context.core.projectId,
            requestId,
            workflowId: context.core.workflowId,
            conversationId: context.core.conversationId,
            userId: context.core.user.id,
            nodeId,
            nodeType,
            status: 'success',
            systemMessageData,
          },
        });

        this.logger.debug(
          '[completeLLMNode] calling sendNodeResponseToWorkflow',
          {
            nextNodeId,
          },
        );
        // Send signal to workflow
        // Use event.payload.workflowId if context.core.workflowId is undefined
        const workflowIdForSuccess = context.core.workflowId || workflowId;
        await this.flowExecutionService.sendNodeResponseToWorkflow(
          requestId,
          workflowIdForSuccess,
          systemMessageData,
          nextNodeId ?? null,
          undefined,
          tracker,
        );
        workflowSignalSent = true;

        // Record success for circuit breaker and reset error recovery state
        const circuitKey = `${nodeType}_${context.core.organizationId}`;
        this.flowRecoverySerivce.recordCircuitBreakerSuccess(circuitKey);

        // Reset error recovery state on successful LLM completion
        // Note: Create a minimal workflow state for error recovery reset
        const completionNode = this.nodeExecutionService.getNode(
          context.flowId,
          nodeId,
        );
        if (completionNode) {
          // Reset error recovery state on successful LLM completion
          this.errorRecoveryService.resetErrorRecoveryState(
            completionNode.node.id,
            context.core.organizationId,
          );
        }
      }

      // Mark the flow node job as completed
      this.logger.log(`Flow node ${nodeId} completed via LLM completion`, {
        requestId,
      });
    } catch (error) {
      this.logger.error(
        `Error completing LLM flow node for request ${requestId}:`,
        error,
      );
      if (workflowSignalSent) {
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown LLM completion error';
      await this.completeFailedLLMNode({
        requestId,
        workflowId,
        status: 'failed',
        nodeId,
        nodeType,
        tracker,
        error: {
          message: errorMessage,
          code: 'LLM_COMPLETION_POST_PROCESSING_FAILED',
        },
      });
    }
  }

  private async getNextNodeIdFromTransitions(
    messageId: MessageId,
    organizationId: OrganizationId,
    routingInfo: { detectedIntent?: string; reasoning?: string },
    routing:
      | {
          nextNode?: never;
          transitions: TwoOrMoreTransitions;
          skipToNode?: SkipToNodeConfig;
        }
      | { nextNode?: never; transitions?: never; skipToNode?: never },
    nextNodeId: string | undefined,
    context: Readonly<FlowContext>,
    systemMessageData: SystemMessageData,
    node: INode<FlowContext>,
  ): Promise<string | undefined> {
    const message = await this.messageService.getMessage(
      messageId,
      organizationId,
    );
    if (message) {
      // Handle case where parentMessageId might be null due to message deletion/replay
      let userMessage = null;
      if (message.parentMessageId) {
        const parentMessage = await this.messageService.getMessage(
          message.parentMessageId,
          organizationId,
        );
        // A reply's parent is in the timeline; undated queued inputs are not.
        userMessage =
          parentMessage && isTimelineMessage(parentMessage)
            ? parentMessage
            : null;
      }

      // Priority 1: Use LLM's integrated routing decision if provided
      if (routingInfo.detectedIntent && routing.transitions) {
        const transitionDef = routing.transitions[routingInfo.detectedIntent];
        if (transitionDef) {
          nextNodeId = transitionDef.nextNodeId;
          this.logger.log(
            '[completeLLMNode] Using integrated routing from LLM response',
            {
              detectedIntent: routingInfo.detectedIntent,
              nextNodeId,
              reasoning: routingInfo.reasoning,
              description: transitionDef.description,
            },
          );
        } else {
          this.logger.warn(
            '[completeLLMNode] LLM selected invalid transition, falling back',
            {
              detectedIntent: routingInfo.detectedIntent,
              validTransitions: Object.keys(routing.transitions),
            },
          );
        }
      }

      // Priority 2: Try pattern matching if no integrated routing
      if (!nextNodeId) {
        const intent: Intent | undefined = userMessage
          ? await this.intentDetector.detect(
              userMessage,
              context,
              systemMessageData as Pick<
                QuestionsSystemMessageData,
                'detectedIntent' | 'intentConfidence' | 'reasoning'
              >,
              Object.keys(routing.transitions ?? {}),
            )
          : undefined;

        // Check if we should use LLM routing fallback
        const shouldUseLLMRouting =
          !intent || (intent.confidence && intent.confidence < 0.6);

        if (shouldUseLLMRouting && routing.transitions) {
          this.logger.debug(
            '[completeLLMNode] Using LLM routing fallback due to low pattern matching confidence',
            {
              nodeId: node.id,
              intentConfidence: intent?.confidence,
              hasIntent: !!intent,
            },
          );

          const selectedTransition = await this.performLLMRouting(
            routing.transitions,
            context,
          );

          // Look up nextNodeId from transition definition
          const transitionDef = routing.transitions[selectedTransition];
          const fallbackNextNodeId = transitionDef?.nextNodeId;
          if (fallbackNextNodeId) {
            nextNodeId = fallbackNextNodeId;
            this.logger.log(
              '[completeLLMNode] LLM routing fallback selected transition',
              {
                selectedTransition,
                nextNodeId,
                description: transitionDef.description,
              },
            );
          }
        } else {
          // Use standard pattern matching flow
          nextNodeId = await this.nodeExecutionService.determineNextNode(
            intent,
            routing,
            context,
            undefined,
          );
        }
      }
    } else {
      // Handle auto-executing nodes with no parent message
      if (!node.twoPhase) {
        this.logger.debug(
          '[completeLLMNode] Auto-executing node with transitions',
          {
            nodeId: node.id,
            systemMessageDataType: systemMessageData.type,
            hasIntegratedRouting: !!routingInfo.detectedIntent,
          },
        );

        // Priority 1: Use integrated routing if provided
        if (routingInfo.detectedIntent && routing.transitions) {
          const transitionDef = routing.transitions[routingInfo.detectedIntent];
          if (transitionDef) {
            nextNodeId = transitionDef.nextNodeId;
            this.logger.log(
              '[completeLLMNode] Auto-executing node using integrated routing from LLM',
              {
                detectedIntent: routingInfo.detectedIntent,
                nextNodeId,
                reasoning: routingInfo.reasoning,
              },
            );
          }
        }

        // Priority 2: Fallback to LLM routing since there is no user message
        if (!nextNodeId) {
          const intent = await this.intentDetector.detect(
            null, // No user message for auto-executing nodes
            context,
            systemMessageData as Pick<
              QuestionsSystemMessageData,
              'detectedIntent' | 'intentConfidence' | 'reasoning'
            >,
            Object.keys(routing.transitions ?? {}),
          );

          // Check if we should use LLM routing fallback
          const shouldUseLLMRouting =
            !intent || (intent.confidence && intent.confidence < 0.6);

          if (shouldUseLLMRouting && routing.transitions) {
            this.logger.debug(
              '[completeLLMNode] Auto-executing node using LLM routing fallback',
              {
                nodeId: node.id,
                intentConfidence: intent?.confidence,
                hasIntent: !!intent,
              },
            );

            const selectedTransition = await this.performLLMRouting(
              routing.transitions,
              context,
            );

            const transitionDef = routing.transitions[selectedTransition];
            const fallbackNextNodeId = transitionDef?.nextNodeId;
            if (fallbackNextNodeId) {
              nextNodeId = fallbackNextNodeId;
              this.logger.log(
                '[completeLLMNode] LLM routing fallback selected transition (auto-executing)',
                {
                  selectedTransition,
                  nextNodeId,
                  description: transitionDef.description,
                },
              );
            }
          } else {
            nextNodeId = await this.nodeExecutionService.determineNextNode(
              intent,
              routing,
              context,
              undefined,
            );
          }
        }
      } else {
        throw new Error(`Could not find system message by id ${messageId}`);
      }
    }
    return nextNodeId;
  }

  private async completeFailedLLMNode({
    requestId,
    status,
    error,
    classifiedError,
    tracker,
    nodeId,
    workflowId,
    nodeType,
  }: {
    requestId: RequestId;
    workflowId: WorkflowId;
    status: 'failed';
    error?: {
      message: string;
      code: string;
    };
    classifiedError?: ClassifiedError;
    nodeId: string;
    nodeType: NodeType;
    tracker: MutableContextHandle<FlowContext>;
  }): Promise<void> {
    // Enrich context with LLM completion metadata
    enrichEventContext({
      requestId: requestId,
      llmStatus: status,
      nodeId,
      nodeType,
    });
    // Add this service to the service call chain for tracing
    addToServiceChain('FlowNodeProcessor');

    this.logger.debug(`[completeLLMNode] starting`, {
      requestId: requestId,
      llmStatus: status,
      nodeId,
      nodeType,
    });

    try {
      this.logger.log(`Completing LLM flow node`, {
        requestId,
        nodeId,
        nodeType,
      });

      // The LLM has already updated the message, so we just need to:
      // 1. Emit FLOW_NODE.COMPLETE event
      // 2. Send signal to workflow
      // 3. Clean up timeout and resolve promise

      // Handle failure case
      const errorMessage = error?.message || 'LLM processing failed';
      const errorCode = error?.code || 'LLM_ERROR';
      const resolvedClassification =
        classifiedError ??
        this.classifyError(new Error(errorMessage), {
          requestId,
          workflowId,
          nodeId,
          nodeType,
          reason: 'llm_completion_failure',
        });

      // Create error response
      const errorResponse: ErrorSystemMessageData = {
        ...this.createErrorResponse(resolvedClassification, { id: nodeId }),
        context: `${errorMessage} (Code: ${errorCode})`,
      };

      const context = tracker.getContext();

      // Emit FLOW_NODE.COMPLETE event with failure
      await this.eventPublisher.publish({
        type: EVENT_TYPES.FLOW_NODE.COMPLETE,
        aggregateId: requestId,
        payload: {
          payloadType: EVENT_TYPES.FLOW_NODE.COMPLETE,

          organizationId: context.core.organizationId,
          projectId: context.core.projectId,
          requestId,
          workflowId: context.core.workflowId,
          conversationId: context.core.conversationId,
          userId: context.core.user.id,
          nodeId,
          nodeType,
          status: 'failed',
          systemMessageData: errorResponse,
          error: {
            message: errorMessage,
            code: errorCode,
          },
        },
      });

      // Send error signal to workflow
      // Use event.payload.workflowId if context.core.workflowId is undefined
      const workflowIdForSignal = context.core.workflowId || workflowId;
      await this.flowExecutionService.sendNodeResponseToWorkflow(
        requestId,
        workflowIdForSignal,
        errorResponse,
        null,
        true, // errorHolding flag to pause workflow
        tracker,
      );

      // Record failure for circuit breaker
      const circuitKey = `${nodeType}_${context.core.organizationId}`;
      this.flowRecoverySerivce.recordCircuitBreakerFailure(circuitKey);

      // Mark the flow node job as completed
      this.logger.log(`Flow node ${nodeId} completed via LLM completion`, {
        requestId,
      });
    } catch (error) {
      this.logger.error(
        `Error completing LLM flow node for request ${requestId}:`,
        error,
      );
    }
  }

  /**
   * Perform LLM-based routing when pattern matching is insufficient
   * Uses the prompt builder strategy to create a routing prompt and calls LLM to select transition
   *
   * @param transitions - Available transitions with descriptions
   * @param context - Current flow context
   * @param nodeContext - Optional node-specific guidance for routing
   * @returns Selected transition key that can be used to look up the next node
   */
  private async performLLMRouting(
    transitions: TwoOrMoreTransitions,
    context: Readonly<FlowContext>,
    nodeContext?: string,
  ): Promise<string> {
    this.logger.debug('[performLLMRouting] Starting LLM-based routing', {
      availableTransitions: Object.keys(transitions),
      nodeContext,
    });

    // Filter to only TransitionDefinition objects (not functions)
    const transitionDefs: Record<string, TransitionDefinition> = {};
    for (const [key, value] of Object.entries(transitions)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'nextNodeId' in value &&
        'description' in value
      ) {
        transitionDefs[key] = value;
      }
    }

    // If no valid TransitionDefinition objects found, fall back to default
    if (Object.keys(transitionDefs).length === 0) {
      this.logger.warn(
        '[performLLMRouting] No TransitionDefinition objects found, falling back to default',
      );
      return 'default';
    }

    try {
      // Build routing prompt using the appropriate strategy
      const routingPrompt = await this.promptBuilder.buildRoutingPrompt(
        transitionDefs,
        context,
        nodeContext,
      );

      this.logger.debug('[performLLMRouting] Generated routing prompt', {
        promptLength: routingPrompt.length,
      });

      // Call LLM with routing prompt
      const modelCriteria: ModelSelectionCriteria = {
        provider: LLMProviderName.OPENAI,
        openaiTier: 'mini',
      };

      const llmResponse =
        await this.llmClientService.callStructured<LLMRoutingResponse>(
          routingPrompt,
          {
            modelCriteria,
            responseSchema: LLMRoutingResponseSchema,
            temperature: 0.3, // Lower temperature for more deterministic routing
            maxTokens: 500, // Routing responses should be concise
          },
          {
            organizationId: context.core.organizationId,
            workflowId: context.core.workflowId,
            projectId: context.core.projectId,
            conversationId: context.core.conversationId,
            userId: context.core.user?.id,
            nodeId: 'routing',
          },
        );

      this.logger.log('[performLLMRouting] LLM routing decision made', {
        selectedTransition: llmResponse.content.selectedTransition,
        confidence: llmResponse.content.confidence,
        reasoning: llmResponse.content.reasoning,
      });

      // Validate that the selected transition is valid
      if (!(llmResponse.content.selectedTransition in transitions)) {
        this.logger.warn(
          '[performLLMRouting] LLM selected invalid transition, falling back to default',
          {
            selectedTransition: llmResponse.content.selectedTransition,
            validTransitions: Object.keys(transitions),
          },
        );
        return 'default';
      }

      return llmResponse.content.selectedTransition;
    } catch (error) {
      this.logger.error('[performLLMRouting] Error during LLM routing', {
        error,
        availableTransitions: Object.keys(transitions),
      });
      // Fall back to default transition on error
      return 'default';
    }
  }
}
