import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Client, WorkflowHandle } from '@temporalio/client';
import { MessageStatus } from '../../constants/message-status.constants';
import { MessageResponseDto, WorkflowName } from '../../generated';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import { FlowUserMessage } from '../../types/flow-internal.types';
import { WorkflowSignals } from '../../utils/workflow-signals.util';
import { getWorkflowStatus } from '../../workflows/conversation-flow.workflow';
import { ConversationService } from '../conversation.service';
import { WorkflowTypeRegistryService } from './workflow-type-registry.service';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';

export interface WorkflowContext {
  workflowId: WorkflowId;
  workflowType: string;
  organizationId: string;
  projectId: string;
  conversationId?: string;
}

/**
 * Service responsible for routing messages and events to appropriate workflows
 * based on workflow type, context, and business rules.
 */
@Injectable()
export class WorkflowRouterService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    WorkflowRouterService.name,
  );

  constructor(
    @InjectTemporalClient() private temporalClient: Client,
    private readonly workflowTypeRegistry: WorkflowTypeRegistryService,
    @Inject(forwardRef(() => ConversationService))
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * Route a user message to the appropriate workflow with the correct signal
   */
  async routeUserMessage(
    message: MessageResponseDto,
    context?: Partial<WorkflowContext>,
  ): Promise<void> {
    const workflowId = await this.resolveConversationWorkflowId(
      message,
      context,
    );

    if (!workflowId) {
      this.logger.warn(
        `Message ${message.id} has no conversation workflowId - skipping routing`,
        {
          conversationId: message.conversationId,
          organizationId: context?.organizationId,
        },
      );
      return;
    }

    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);

      // Get workflow type from context or derive from workflow execution
      const workflowType = await this.getWorkflowType(
        workflowId,
        context,
        workflowHandle,
      );

      // Route to appropriate signal based on workflow type
      await this.sendMessageToWorkflow(
        workflowHandle,
        workflowType,
        message,
        workflowId,
      );

      this.logger.log(
        `Routed user message ${message.id} to ${workflowType} workflow ${workflowId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to route message ${message.id} to workflow ${workflowId}:`,
        error,
      );
      throw error;
    }
  }

  private async resolveConversationWorkflowId(
    message: MessageResponseDto,
    context?: Partial<WorkflowContext>,
  ): Promise<WorkflowId | undefined> {
    if (!message.conversationId || !context?.organizationId) {
      return undefined;
    }

    try {
      const conversation = await this.conversationService.getConversation(
        message.conversationId as ConversationId,
        context.organizationId as OrganizationId,
      );

      return (conversation?.workflowId ?? undefined) as WorkflowId | undefined;
    } catch (error) {
      this.logger.warn(
        `Could not resolve workflowId from conversation ${message.conversationId}`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Determine the workflow type from context, conversation data, or workflow execution
   */
  private async getWorkflowType(
    workflowId: WorkflowId,
    context?: Partial<WorkflowContext>,
    workflowHandle?: WorkflowHandle,
  ): Promise<string> {
    // Priority 1: Explicit workflowType from context
    if (context?.workflowType) {
      return context.workflowType;
    }

    // Priority 2: Get workflowType from conversation data if conversationId available
    if (context?.conversationId && context?.organizationId) {
      try {
        const conversation = await this.conversationService.getConversation(
          context.conversationId as ConversationId,
          context.organizationId as OrganizationId,
        );

        if (
          conversation?.workflowAboutType &&
          this.workflowTypeRegistry.isWorkflowTypeSupported(
            conversation.workflowAboutType,
          )
        ) {
          return conversation.workflowAboutType;
        }
      } catch (error) {
        this.logger.warn(
          `Could not fetch conversation ${context.conversationId} to determine workflowAboutType`,
          error,
        );
      }
    }

    // Priority 3: Extract from Temporal workflow description
    try {
      const handle =
        workflowHandle || this.temporalClient.workflow.getHandle(workflowId);
      const description = await handle.describe();

      const workflowName = description.type;
      const extractedType = this.extractWorkflowTypeFromName(workflowName);

      if (this.workflowTypeRegistry.isWorkflowTypeSupported(extractedType)) {
        return extractedType;
      }
    } catch (error) {
      this.logger.warn(
        `Could not extract workflow type from Temporal for ${workflowId}`,
        error,
      );
    }

    // Priority 4: Default fallback
    this.logger.warn(
      `Could not determine workflow type for ${workflowId}, defaulting to 'generic'`,
    );
    return 'generic';
  }

  /**
   * Extract workflow type from workflow name using our supported constants
   */
  private extractWorkflowTypeFromName(workflowName: string): string {
    const lowerName = workflowName.toLowerCase();

    // Map workflow names to our constants
    if (lowerName.includes('onboarding') || lowerName.includes('interaction')) {
      return WorkflowName.Onboarding;
    }
    if (lowerName.includes('initiative') && lowerName.includes('refinement')) {
      return WorkflowName.InitiativeRefinement;
    }
    if (lowerName.includes('task') && lowerName.includes('generation')) {
      return WorkflowName.TaskGeneration;
    }
    if (lowerName.includes('task') && lowerName.includes('prioritization')) {
      return WorkflowName.TaskPrioritization;
    }
    if (lowerName.includes('project') && lowerName.includes('conversation')) {
      return WorkflowName.ProjectConversation;
    }
    if (lowerName.includes('entity') && lowerName.includes('conversation')) {
      return WorkflowName.EntityConversation;
    }

    // Legacy support for older workflow types
    if (lowerName.includes('support')) {
      return 'support';
    }
    if (lowerName.includes('analysis')) {
      return 'analysis';
    }

    return 'generic';
  }

  /**
   * Send message to workflow using the appropriate signal based on workflow type
   */
  private async sendMessageToWorkflow(
    workflowHandle: WorkflowHandle,
    workflowType: string,
    message: MessageResponseDto,
    workflowId: WorkflowId,
  ): Promise<void> {
    // Use our new workflow constants
    switch (workflowType) {
      case WorkflowName.Onboarding:
        await workflowHandle.signal(
          WorkflowSignals.ONBOARDING_USER_MESSAGE,
          message,
        );
        break;
      case WorkflowName.InitiativeRefinement:
        await workflowHandle.signal(
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId),
          message,
        );
        break;
      case WorkflowName.TaskGeneration:
        await workflowHandle.signal(
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId),
          message,
        );
        break;
      case WorkflowName.TaskPrioritization:
        await workflowHandle.signal(
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId),
          message,
        );
        break;
      case WorkflowName.EntityConversation:
        await workflowHandle.signal(
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId),
          message,
        );
        break;
      case WorkflowName.ProjectConversation:
        await workflowHandle.signal(
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId),
          message,
        );
        break;
      // Legacy workflow type support
      case 'support':
        await workflowHandle.signal(
          WorkflowSignals.SUPPORT_USER_MESSAGE,
          message,
        );
        break;
      case 'analysis':
        await workflowHandle.signal(
          WorkflowSignals.ANALYSIS_USER_MESSAGE,
          message,
        );
        break;
      default: {
        // Fall back to workflow-specific signal for unknown workflow types
        const signalName =
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
        await workflowHandle.signal(signalName, message);
        break;
      }
    }
  }

  /**
   * Register a new workflow type with its signal handler
   */
  registerWorkflowType(workflowType: string, signalName: string): void {
    // This could be expanded to maintain a registry of workflow types and their signals
    this.logger.log(
      `Registered workflow type: ${workflowType} with signal: ${signalName}`,
    );
  }

  // === Generic Workflow Orchestration Methods ===

  /**
   * Send user message to any workflow
   */
  async sendUserMessage(
    workflowId: WorkflowId,
    message: FlowUserMessage,
  ): Promise<void> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const signalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);

      await workflowHandle.signal(signalName, message);

      this.logger.log(`Sent user message signal to workflow ${workflowId}`, {
        messageType: message.type,
        signalName,
        timestamp: message.timestamp,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send user message signal to workflow ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
          messageType: message.type,
        },
      );
      throw error;
    }
  }

  /**
   * Restart a workflow by node id
   */
  async restartWorkflow(workflowId: WorkflowId, nodeId: string): Promise<void> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const signalName = WorkflowSignals.getSkipToNodeSignalName(workflowId);

      await workflowHandle.signal(signalName, {
        nodeId,
        systemMessageComplete: false,
      });

      this.logger.log(`Sent skip to node signal to workflow ${workflowId}`, {
        targetNodeId: nodeId,
        signalName,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send skip to node signal to workflow ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
          targetNodeId: nodeId,
        },
      );
      throw error;
    }
  }

  /**
   * Navigate workflow to specific node
   */
  async sendSkipToNode(workflowId: WorkflowId, nodeId: string): Promise<void> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const signalName = WorkflowSignals.getSkipToNodeSignalName(workflowId);

      await workflowHandle.signal(signalName, {
        nodeId,
        systemMessageComplete: false,
      });

      this.logger.log(`Sent skip to node signal to workflow ${workflowId}`, {
        targetNodeId: nodeId,
        signalName,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send skip to node signal to workflow ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
          targetNodeId: nodeId,
        },
      );
      throw error;
    }
  }

  /**
   * Check if workflow is running and responsive
   */
  async isWorkflowRunning(workflowId: WorkflowId): Promise<boolean> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const description = await workflowHandle.describe();

      return description.status.name === 'RUNNING';
    } catch (error) {
      this.logger.warn(`Failed to check workflow status for ${workflowId}`, {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Check whether the conversation workflow can safely accept a user-message
   * signal. RUNNING only proves Temporal has started the execution; the signal
   * handler also needs the workflow state to have bound currentNodeExecutionId.
   */
  async isWorkflowUserMessageSignalReady(
    workflowId: WorkflowId,
  ): Promise<boolean> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const status = await workflowHandle.query(getWorkflowStatus);
      return status.userMessageSignalReady;
    } catch (error) {
      this.logger.warn(
        `Failed to check workflow user-message signal readiness for ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
        },
      );
      return false;
    }
  }

  /**
   * Get workflow execution status and metadata
   */
  async getWorkflowInfo(workflowId: WorkflowId): Promise<{
    status: string;
    startTime?: Date;
    runTime?: number;
    metadata?: Record<string, unknown>;
  }> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const description = await workflowHandle.describe();

      return {
        status: description.status.name,
        startTime: description.startTime
          ? new Date(description.startTime)
          : undefined,
        runTime: description.startTime
          ? Date.now() - new Date(description.startTime).getTime()
          : undefined,
        metadata: (description.memo?.fields as Record<string, unknown>) || {},
      };
    } catch (error) {
      this.logger.error(`Failed to get workflow info for ${workflowId}`, {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Send generic structured data to workflow
   * Replaces domain-specific signals with structured messages
   */
  async sendStructuredMessage<T>(
    workflowId: WorkflowId,
    projectId: ProjectId,
    conversationId: ConversationId,
    messageType: string,
    payload: T,
  ): Promise<void> {
    const structuredMessage: FlowUserMessage = {
      id: `msg-${Date.now()}` as MessageId,
      type: 'USER' as const,
      workflowId: workflowId,
      projectId: projectId,
      conversationId: conversationId,
      status: 'PENDING' as MessageStatus,
      data: {
        message: JSON.stringify(payload),
        messageType: messageType,
      },
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };

    await this.sendUserMessage(workflowId, structuredMessage);
  }
}
