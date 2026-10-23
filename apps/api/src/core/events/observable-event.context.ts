import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowId,
} from '../../types';
import {
  WorkflowContextOptions,
  runWithWorkflowContext,
} from './context-utils';

/**
 * Flow-specific metadata schema for standardized context enrichment
 * This defines the structure for flow-related metadata that services
 * can add to the EventContext.metadata field
 */
export interface FlowContextMetadata {
  // Flow identification
  flowId?: string; // Flow template ID (onboarding, initiative-refinement)
  nodeId?: string; // Current node being processed
  nodeType?: string; // Node type for categorization
  stepIndex?: number; // Current step in flow execution
  flowExecutionId?: string; // Specific flow execution instance
  requestId?: string; // Request ID for correlation
  agentSessionId?: string; // Agent session for cross-service investigation
  initiativeId?: InitiativeId;
  taskId?: TaskId;

  // LLM correlation
  llmProvider?: string; // Model used for LLM calls
  llmModel?: string; // Model used for LLM calls
  promptVersion?: string; // Prompt template version
  llmRequestId?: string; // Individual LLM request tracking
  llmJobId?: string; // LLM job ID for correlation
  promptLength?: number; // Length of prompt for cost/performance tracking
  llmStatus?: string; // Status of LLM processing
  llmTokensUsed?: number; // Total tokens used in LLM call

  // Performance tracking
  processingStartTime?: number; // Operation start timestamp
  processingEndTime?: number; // Operation completion timestamp
  llmCallStartTime?: number; // LLM call start timestamp
  llmCallEndTime?: number; // LLM call completion timestamp
  orchestrationStartTime?: number; // Flow orchestration start timestamp
  orchestrationEndTime?: number; // Flow orchestration completion timestamp
  promptBuildStartTime?: number; // Prompt building start timestamp
  promptBuildEndTime?: number; // Prompt building completion timestamp

  // Service orchestration
  serviceChain?: string[]; // Track service call chain
  serviceDepth?: number; // Current call depth
  messageId?: string; // Message ID for correlation
  jobId?: string; // Job ID for correlation
  executionType?: string; // Type of execution (llm, non-llm, etc.)
  operationType?: string; // Type of operation (create, update, delete, etc.)

  // Flow execution state management
  executionId?: string; // Flow execution ID for correlation
  flowExecutionStatus?: string; // Status of flow execution
  entityType?: string; // Type of entity being processed
  entityId?: string; // ID of entity being processed
  creationStartTime?: number; // Flow execution creation start timestamp
  creationEndTime?: number; // Flow execution creation end timestamp
  hasError?: boolean; // Whether operation has errors
  currentNode?: string; // Current node in flow execution

  // Computed duration properties (derived from start/end times)
  processingDuration?: number; // Computed from processingEndTime - processingStartTime
  llmCallDuration?: number; // Computed from llmCallEndTime - llmCallStartTime
  orchestrationDuration?: number; // Computed from orchestrationEndTime - orchestrationStartTime

  // Flow execution tracking
  flowPath?: string[]; // Path through flow nodes
  decisionPoints?: string[]; // Decision nodes encountered
  userInteractions?: number; // Count of user interactions
  intentType?: string; // Type of detected intent
  intentConfidence?: number; // Confidence level of intent detection
  hasUserMessage?: boolean; // Whether user message is present
  availableTransitionsCount?: number; // Number of available transitions

  // Prompt building tracking
  hasResponseSchema?: boolean; // Whether prompt has response schema
  includesHistory?: boolean; // Whether prompt includes conversation history
  temperature?: number; // LLM temperature setting

  // Business metrics
  costCenter?: string; // Cost attribution
  featureFlags?: string[]; // Active feature flags
  experimentIds?: string[]; // A/B test experiments

  // Error context
  errorContext?: {
    lastSuccessfulStep?: string;
    errorOrigin?: string;
    retryAttempt?: number;
  };
}

export interface EventContext {
  correlationId: string;
  requestId?: string | null;
  causationId?: string | null;
  sagaId?: string | null;
  userId?: UserId | null;
  organizationId?: OrganizationId | null;
  projectId?: ProjectId | null;
  conversationId?: ConversationId | null;
  messageId?: MessageId | null;
  workflowId?: WorkflowId | null;
  agentSessionId?: string | null;
  sourceService: string;
  sourceMethod: string;
  sourceVersion?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  metadata?: FlowContextMetadata;
}

export class EventContextManager {
  private static instance: EventContextManager;
  private asyncLocalStorage = new AsyncLocalStorage<EventContext>();

  static getInstance(): EventContextManager {
    if (!EventContextManager.instance) {
      EventContextManager.instance = new EventContextManager();
    }
    return EventContextManager.instance;
  }

  getCurrentContext(): EventContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  async runWithContext<T>(
    context: EventContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.asyncLocalStorage.run(context, operation);
  }

  clear(): void {
    // For testing purposes - clear the async local storage context
    // This is primarily used in test cleanup
  }

  createCorrelationId(): string {
    return `corr_${uuidv4()}`;
  }

  createSagaId(): string {
    return `saga_${uuidv4()}`;
  }

  createChildContext(
    parentEventId: string,
    updates: Partial<EventContext>,
  ): EventContext {
    const current = this.getCurrentContext();
    return {
      ...current,
      ...updates,
      causationId: parentEventId,
      correlationId:
        updates.correlationId ||
        current?.correlationId ||
        this.createCorrelationId(),
    } as EventContext;
  }

  createInitialContext(
    sourceService: string,
    sourceMethod: string,
    options: Partial<EventContext> = {},
  ): EventContext {
    return {
      correlationId: this.createCorrelationId(),
      sourceService,
      sourceMethod,
      ...options,
    };
  }

  extractFromHeaders(headers: Record<string, string>): Partial<EventContext> {
    const context: Partial<EventContext> = {};
    const values: Array<[keyof EventContext, string | undefined]> = [
      ['correlationId', headers['x-correlation-id']],
      ['causationId', headers['x-causation-id']],
      ['sagaId', headers['x-saga-id']],
      ['userId', headers['x-user-id']],
      ['organizationId', headers['x-organization-id']],
      ['projectId', headers['x-project-id']],
      ['conversationId', headers['x-conversation-id']],
      ['workflowId', headers['x-workflow-id']],
      ['requestId', headers['x-request-id']],
      ['agentSessionId', headers['x-agent-session-id']],
      ['userAgent', headers['user-agent']],
    ];
    for (const [key, value] of values) {
      if (value) {
        (context as Record<string, unknown>)[key] = value;
      }
    }
    return context;
  }

  injectIntoHeaders(context: EventContext): Record<string, string> {
    const headers: Record<string, string> = {};
    if (context.correlationId)
      headers['x-correlation-id'] = context.correlationId;
    if (context.requestId) headers['x-request-id'] = context.requestId;
    if (context.causationId) headers['x-causation-id'] = context.causationId;
    if (context.sagaId) headers['x-saga-id'] = context.sagaId;
    if (context.userId) headers['x-user-id'] = context.userId;
    if (context.organizationId)
      headers['x-organization-id'] = context.organizationId;
    if (context.projectId) headers['x-project-id'] = context.projectId;
    if (context.conversationId)
      headers['x-conversation-id'] = context.conversationId;
    if (context.workflowId) headers['x-workflow-id'] = context.workflowId;
    if (context.agentSessionId)
      headers['x-agent-session-id'] = context.agentSessionId;
    return headers;
  }
}

export function WithEventContext(sourceService: string, sourceMethod?: string) {
  return function (
    target: unknown,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const method = descriptor.value;
    const methodName =
      sourceMethod ||
      `${(target as { constructor: { name: string } }).constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: unknown[]) {
      const ctxMgr = EventContextManager.getInstance();
      const req = args.find(
        (arg) =>
          arg && typeof arg === 'object' && arg !== null && 'headers' in arg,
      );
      const extracted = req
        ? ctxMgr.extractFromHeaders(
            (req as { headers: Record<string, string> }).headers,
          )
        : undefined;
      const current = ctxMgr.getCurrentContext();
      let context: EventContext;
      if (current) {
        const parentId = current.causationId ?? current.correlationId;
        context = ctxMgr.createChildContext(parentId, {
          sourceService,
          sourceMethod: methodName,
          ...extracted,
        });
      } else {
        context = ctxMgr.createInitialContext(sourceService, methodName, {
          ...extracted,
        });
      }
      return ctxMgr.runWithContext(context, () => method.apply(this, args));
    };
    return descriptor;
  };
}

export function WithWorkflowContext(
  buildOptions: (...args: unknown[]) => WorkflowContextOptions,
) {
  return function (
    _target: unknown,
    _propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const original = descriptor.value;
    if (typeof original !== 'function') {
      throw new Error(
        'WithWorkflowContext decorator can only be applied to methods',
      );
    }

    descriptor.value = async function (...args: unknown[]) {
      const options = buildOptions(...args);
      return runWithWorkflowContext(options, () => original.apply(this, args));
    };

    return descriptor;
  };
}

export function requireEventContext(): EventContext {
  const context = EventContextManager.getInstance().getCurrentContext();
  if (!context) {
    throw new Error(
      'No event context available. Ensure operation is running within event context.',
    );
  }
  return context;
}

export function getEventContext(
  defaults?: Partial<EventContext>,
): EventContext {
  const current = EventContextManager.getInstance().getCurrentContext();
  if (current) return current;
  return {
    correlationId: EventContextManager.getInstance().createCorrelationId(),
    sourceService: 'unknown',
    sourceMethod: 'unknown',
    ...defaults,
  };
}
