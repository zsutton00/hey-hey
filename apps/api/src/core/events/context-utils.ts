import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../types';
import { ExecutionContext } from '../../types/execution-context';
import {
  EventContext,
  EventContextManager,
  FlowContextMetadata,
  getEventContext,
} from './observable-event.context';

// Re-export FlowContextMetadata for backward compatibility
export { FlowContextMetadata };

/**
 * Serializable context data for Temporal workflow/activity boundaries
 * This interface contains only the data that can be safely serialized
 * and passed across process boundaries (workflows -> activities)
 */
export interface EventContextData {
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

/**
 * Extract serializable context data from EventContext
 * Used when passing context across Temporal workflow boundaries
 *
 * @param context - The current EventContext to extract data from
 * @returns Serializable context data safe for Temporal workflows
 */
export function extractEventContextData(
  context: EventContext,
): EventContextData {
  const data: EventContextData = {
    correlationId: context.correlationId,
    causationId: context.causationId,
    sagaId: context.sagaId,
    userId: context.userId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    conversationId: context.conversationId,
    messageId: context.messageId,
    workflowId: context.workflowId,
    sourceService: context.sourceService,
    sourceMethod: context.sourceMethod,
    sourceVersion: context.sourceVersion,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
    metadata: context.metadata ? { ...context.metadata } : undefined,
  };
  if (context.requestId) data.requestId = context.requestId;
  if (context.agentSessionId) data.agentSessionId = context.agentSessionId;
  return data;
}

/**
 * Enrich the current EventContext with flow-specific metadata
 * This utility provides a consistent way for services to add domain-specific
 * context data without directly manipulating the context object
 *
 * @param updates - Metadata updates to merge into current context
 */
export function enrichEventContext(
  updates: Partial<FlowContextMetadata>,
): void {
  const context = getEventContext();
  if (context?.metadata) {
    Object.assign(context.metadata, updates);
  } else if (context) {
    // Initialize metadata if it doesn't exist
    context.metadata = { ...updates };
  }
}

/**
 * Wrapper function for Temporal activities to automatically reconstruct EventContext
 * This wrapper handles the complexity of context reconstruction at Temporal boundaries
 * and provides graceful degradation when context is unavailable
 *
 * @param activityName - Name of the activity for logging and identification
 * @param fn - The activity function to wrap with context reconstruction
 * @returns Wrapped function that automatically handles context reconstruction
 */
export function withEventContext<T extends unknown[], R>(
  activityName: string,
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const params = args[0];

    // Check if context data is available in parameters
    if (
      params &&
      typeof params === 'object' &&
      params !== null &&
      'eventContext' in params
    ) {
      const ctxMgr = EventContextManager.getInstance();
      const context = ctxMgr.createInitialContext(
        'TemporalActivity',
        activityName,
        (params as { eventContext: Partial<EventContext> }).eventContext,
      );

      // Execute function within reconstructed context
      return ctxMgr.runWithContext(context, () => fn(...args));
    }

    // Graceful degradation: execute without context if unavailable
    // This ensures activities don't fail due to missing context
    return fn(...args);
  };
}

/**
 * Create a child context with enhanced metadata for service-specific enrichment
 * This utility is useful when a service needs to create a new context scope
 * with additional metadata while preserving the parent context
 *
 * @param parentEventId - ID of the parent event for causation tracking
 * @param updates - Context updates and metadata to include
 * @returns Enhanced EventContext with service-specific metadata
 */
export function createEnhancedChildContext(
  parentEventId: string,
  updates: Partial<EventContext & { metadata?: FlowContextMetadata }>,
): EventContext {
  const ctxMgr = EventContextManager.getInstance();
  const current = ctxMgr.getCurrentContext();

  return ctxMgr.createChildContext(parentEventId, {
    ...updates,
    metadata: {
      ...current?.metadata,
      ...updates.metadata,
    },
  });
}

/**
 * Utility to add service to the service call chain for tracing
 * This helps track the path a request takes through different services
 *
 * @param serviceName - Name of the current service to add to chain
 */
export function addToServiceChain(serviceName: string): void {
  const context = getEventContext();
  if (context) {
    const serviceChain = context.metadata?.serviceChain || [];
    const serviceDepth = serviceChain.length + 1;

    enrichEventContext({
      serviceChain: [...serviceChain, serviceName],
      serviceDepth,
    });
  }
}

export interface WorkflowContextOptions {
  sourceService: string;
  sourceMethod: string;
  context?: Partial<ExecutionContext>;
  metadata?: Partial<FlowContextMetadata>;
  eventContext?: Partial<EventContext>;
}

function hasMetadata(
  metadata?: FlowContextMetadata,
): metadata is FlowContextMetadata {
  return !!metadata && Object.keys(metadata).length > 0;
}

export async function runWithWorkflowContext<T>(
  options: WorkflowContextOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const ctxMgr = EventContextManager.getInstance();
  const current = ctxMgr.getCurrentContext();

  const execution = options.context ?? {};

  const mergedMetadata: FlowContextMetadata = {
    ...(current?.metadata ?? {}),
    ...(options.metadata ?? {}),
  };

  if (execution.requestId) {
    mergedMetadata.requestId = execution.requestId;
  }

  if (execution.userMessage?.nodeId) {
    mergedMetadata.nodeId = execution.userMessage.nodeId;
  }

  const baseCorrelation =
    execution.correlationId ||
    current?.correlationId ||
    ctxMgr.createCorrelationId();
  const baseCausation =
    execution.causationId || current?.causationId || baseCorrelation;

  const updates: Partial<EventContext> = {
    requestId: execution.requestId ?? current?.requestId,
    agentSessionId: current?.agentSessionId,
    sourceService: options.sourceService,
    sourceMethod: options.sourceMethod,
    workflowId: execution.workflowId ?? current?.workflowId,
    conversationId: execution.conversationId ?? current?.conversationId,
    organizationId: execution.organizationId ?? current?.organizationId,
    projectId: execution.projectId ?? current?.projectId,
    userId: execution.userId ?? current?.userId,
    messageId: execution.messageId ?? current?.messageId,
    correlationId: baseCorrelation,
    causationId: baseCausation,
    metadata: hasMetadata(mergedMetadata) ? mergedMetadata : current?.metadata,
  };

  if (options.eventContext) {
    const { metadata, ...rest } = options.eventContext;
    Object.assign(updates, rest);
    if (metadata) {
      updates.metadata = {
        ...(updates.metadata ?? {}),
        ...metadata,
      };
    }
  }

  if (current) {
    const parentEventId =
      execution.causationId ||
      execution.correlationId ||
      current.causationId ||
      current.correlationId ||
      ctxMgr.createCorrelationId();
    const context = ctxMgr.createChildContext(parentEventId, updates);
    return ctxMgr.runWithContext(context, fn);
  }

  const initialContext = ctxMgr.createInitialContext(
    options.sourceService,
    options.sourceMethod,
    updates,
  );
  return ctxMgr.runWithContext(initialContext, fn);
}

/**
 * Utility to track processing time for performance monitoring
 * This provides a consistent way to measure operation duration
 *
 * @param operationType - Type of operation being tracked (e.g., 'processingTime', 'llmCallTime')
 * @param startTime - Start timestamp (Date.now() format)
 */
export function trackProcessingTime(
  operationType: string,
  startTime: number,
): void {
  const endTime = Date.now();
  const duration = endTime - startTime;

  const updates: Partial<FlowContextMetadata> = {};
  (updates as Record<string, unknown>)[`${operationType}EndTime`] = endTime;
  (updates as Record<string, unknown>)[`${operationType}Duration`] = duration;

  enrichEventContext(updates);
}

/**
 * Get current context or create a minimal fallback context
 * This ensures services always have some context to work with
 *
 * @param fallbackSource - Service name to use if creating fallback context
 * @param fallbackMethod - Method name to use if creating fallback context
 * @returns EventContext (existing or newly created fallback)
 */
export function requireEventContextWithFallback(
  fallbackSource: string,
  fallbackMethod: string,
): EventContext {
  const ctxMgr = EventContextManager.getInstance();
  const existing = ctxMgr.getCurrentContext();
  if (existing) {
    return existing;
  }

  // Create minimal fallback context if none exists
  return ctxMgr.createInitialContext(fallbackSource, fallbackMethod);
}

/**
 * Utility to validate context completeness for debugging
 * This helps identify when context is missing important fields
 *
 * @param requiredFields - Array of field names that should be present
 * @returns Validation result with missing fields
 */
export function validateContextCompleteness(
  requiredFields: (keyof EventContext | keyof FlowContextMetadata)[],
): { isValid: boolean; missingFields: string[] } {
  const context = EventContextManager.getInstance().getCurrentContext();
  const missingFields: string[] = [];

  if (!context) {
    return { isValid: false, missingFields: ['entire context'] };
  }

  for (const field of requiredFields) {
    let value: unknown;
    if (field in context) {
      value = (context as unknown as Record<string, unknown>)[field as string];
    } else if (context.metadata) {
      value = (context.metadata as Record<string, unknown>)[field as string];
    }

    if (value === undefined || value === null) {
      missingFields.push(field as string);
    }
  }

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}
