import { SystemMessageResponseType } from 'src/generated';
import {
  ConversationNode,
  FlowContext,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import { QueueName, QueueStats } from '../../core/events/types/event.types';
import {
  QueueJob,
  QueueJobOptions,
} from '../../core/queue/interfaces/queue.interface';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from '../../types';
import { ExecutionContext } from '../../types/execution-context';
import { ClaudeModel } from '../llm/llm-shared';
import type { ModelSelectionCriteria } from '../llm/llm-types';

export {
  ExecutionContext,
  LLMExecutionContext as LLMJobContext,
} from '../../types/execution-context';

export interface ArtifactGenerationJobData {
  type: 'artifact';
  projectId: ProjectId;
  title?: string;
  content: string;
  nodeId?: string;
  artifactType: string;
  sourceType: string;
  sourceId: string;
  generateEmbedding?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LLMWorkflowJobData {
  type: 'llm_workflow';
  responseType: SystemMessageResponseType;
  workflowType: string;
  prompt: string;
  conversationId: ConversationId;
  continueWithoutUserResponse: boolean;
  context: FlowContext;
  nodeId: string;
  options?: {
    model?: ClaudeModel;
    modelCriteria?: ModelSelectionCriteria;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    stream?: boolean;
  };
}

export interface FlowNodeQueueJob extends QueueJob {
  queueName: 'flow_node';
  requestId: RequestId;
  workflowId: WorkflowId;
  conversationId: ConversationId;
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId?: UserId;
  messageId?: MessageId;
  userMessage?: FlowUserMessage;
  data: {
    flowId: string;
    nodeId: string;
    context: FlowContext;
    userMessage: FlowUserMessage;
  };
}

export interface NonInteractiveFlowNodeQueueJob extends QueueJob {
  queueName: 'non_interactive_flow_node';
  requestId: RequestId;
  workflowId: WorkflowId;
  organizationId: OrganizationId;
  projectId: ProjectId;
  data: {
    flowId: string;
    nodeId: string;
    context: FlowContext;
    responseSchemaKey?: string;
    nodeInput?: Record<string, unknown>;
  };
}

export interface AgentWorkflowJobData {
  type: 'agent_workflow';
  agentId: string;
  conversationId: ConversationId;
  context: FlowContext;
  nodeId: string;
  workflowAboutId: string;
  workflowAboutType: string;
  userMessage?: FlowUserMessage;
  userPrompt: string;
  options?: {
    maxExecutionTime?: number;
    temperature?: number;
  };
}

export interface IntegrationJobData {
  integrationId: string;
  integrationType?: string;
}

export interface IntegrationTestJobData {
  integrationId: string;
  config: object;
}

export interface FlowNodeJobData {
  flowId: string;
  nodeId: string;
  context: FlowContext;
  userMessage?: FlowUserMessage;
  messageId: MessageId;
}

export interface NonInteractiveFlowNodeJobData {
  flowId: string;
  nodeId: string;
  context: FlowContext;
  responseSchemaKey?: string;
  nodeInput?: Record<string, unknown>;
}

export type JobData =
  | ArtifactGenerationJobData
  | LLMWorkflowJobData
  | AgentWorkflowJobData
  | IntegrationJobData
  | IntegrationTestJobData
  | FlowNodeJobData
  | NonInteractiveFlowNodeJobData;

/**
 * Interface for job enqueuing operations only.
 * This separates lightweight job creation from heavy job processing.
 */
export interface IJobEnqueuer {
  /**
   * Queue an artifact generation job
   */
  queueArtifactGeneration(
    data: ArtifactGenerationJobData,
    context: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob>;

  /**
   * Queue an agent workflow job
   */
  queueAgentWorkflow(
    data: AgentWorkflowJobData,
    context: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob>;

  /**
   * Get basic job information
   */
  getJob(queueName: QueueName, jobId: string): Promise<QueueJob>;

  /**
   * Get queue statistics
   */
  getQueueStats(organizationId: OrganizationId): Promise<{
    artifacts: QueueStats;
    llm: QueueStats;
    agent: QueueStats;
    integration: QueueStats;
    flowNode: QueueStats;
    nonInteractiveFlowNode: QueueStats;
  }>;

  /**
   * Queue a flow node execution job
   */
  queueFlowNodeExecution(
    data: {
      node: ConversationNode;
      context: FlowContext;
      messageId: MessageId;
      userMessage?: FlowUserMessage;
    },
    executionContext: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob>;

  /**
   * Queue a non-interactive flow node execution job
   */
  queueNonInteractiveFlowNodeExecution(
    data: {
      flowId: string;
      nodeId: string;
      context: FlowContext;
      responseSchemaKey?: string;
      nodeInput?: Record<string, unknown>;
    },
    executionContext: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob>;

  /**
   * Retry a failed job
   */
  retryJob(
    queueName: QueueName,
    jobId: string,
    organizationId: OrganizationId,
    userId: string,
  ): Promise<void>;
}
