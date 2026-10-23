import {
  OrganizationId,
  ProjectId,
  RequestId,
  WorkflowId,
  ConversationId,
  UserId,
  MessageId,
} from '../types';
import { FlowUserMessage } from './flow-internal.types';

/**
 * Unified execution context shared across jobs, events, and processing
 *
 * This interface standardizes context information across the entire system:
 * - Job processing (QueueJob extends ExecutionContext)
 * - Domain events (LLM events use ExecutionContext & specific payload)
 * - Request tracing and workflow correlation
 *
 * Design Guidelines:
 * - Always use this interface instead of creating bespoke context shapes
 * - Required fields: organizationId, projectId
 * - Optional fields support partial context scenarios
 * - LLMExecutionContext extends this for LLM-specific requirements
 */
export interface ExecutionContext {
  organizationId: OrganizationId;
  projectId: ProjectId;
  requestId?: string;
  workflowId?: WorkflowId;
  nodeId?: string;
  conversationId?: ConversationId | null;
  userId?: UserId;
  messageId?: MessageId;
  userMessage?: FlowUserMessage;
  // Event tracing fields
  correlationId?: string;
  causationId?: string;
  timestamp?: string;
}

export interface LLMExecutionContext extends ExecutionContext {
  requestId: string;
  priority?: 'low' | 'normal' | 'high';
}
