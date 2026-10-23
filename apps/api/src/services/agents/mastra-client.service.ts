import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jsonrepair } from 'jsonrepair';
import { JwtKeysService } from 'src/auth/services/jwt-keys.service';
import { z } from 'zod';
import {
  addToServiceChain,
  trackProcessingTime,
} from '../../core/events/context-utils';
import {
  WithEventContext,
  WithWorkflowContext,
} from '../../core/events/observable-event.context';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';
import type {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  PlanId,
  ProjectId,
  WorkflowAboutType,
  WorkflowId,
} from '../../types';
import { LLMTrackingService } from '../llm/llm-tracking.service';
import { EntityRelationshipResolverService } from '../relationships/entity-relationship-resolver.service';

export type AgentMentionContext = {
  entityId: string;
  entityType: string;
  messageId: string;
  summary?: string;
};

// Mastra.ai API interfaces - strict TypeScript types
export interface MastraAgentContext {
  initiativeId?: InitiativeId;
  projectId: ProjectId;
  conversationId: ConversationId;
  organizationId: OrganizationId;
  planId?: PlanId;
  messageId?: MessageId;
  currentLevel?: string;
  nodeId?: string;
  workflowAboutId?: string;
  workflowAboutType?: string;
  mentions?: AgentMentionContext[];
}

export interface MastraAgentBaseRequest {
  agentId: string;
  requestId: string;
  context: MastraAgentContext;
  maxExecutionTime?: number;
  temperature?: number;
}

export interface MastraAgentMessagesRequest extends MastraAgentBaseRequest {
  messages: MastraMessage[];
}

export interface MastraAgentStructuredRequest<
  TInput extends Record<string, unknown> = Record<string, unknown>,
> extends MastraAgentBaseRequest {
  input: TInput;
  inputFormat?: string;
}

// Backwards compatibility alias
export type MastraAgentRequest = MastraAgentMessagesRequest;

export interface MastraMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Raw response from Mastra
export interface RawMastraResponse {
  text: string;
  toolResults?: unknown[];
  toolCalls?: unknown[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  };
  steps?: unknown[];
}

type MastraUsageStats = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

export type AgentResponseShape = {
  [key: string]: unknown;
};

// Our normalized response format
export interface MastraAgentResponse<T = AgentResponseShape> {
  executionId: string;
  status: 'completed' | 'failed' | 'timeout';
  result?: AgentExecutionResult<T>;
  error?: AgentExecutionError;
  executionTime: number;
  cost?: number;
}

export interface AgentExecutionResult<T = AgentResponseShape> {
  agentId: string;
  data?: T; // Parsed data from text if it's JSON
  confidence: number;
}

// Initiative agent response shape - standardized structure for all initiative agents
export interface InitiativeResponseShape {
  acceptanceCriteria?: string;
  description?: string;
  details?: string;
  summary: string;
}

export interface TaskResponseShape {
  acceptanceCriteria?: string;
  description?: string;
  details?: string;
  name?: string;
  summary: string;
}

// Legacy interface - maintained for backward compatibility
export interface InitiativeRefinementData {
  description?: string;
  details?: string;
  acceptanceCriteria?: string;
}

// Initiative feedback response data structure
export interface InitiativeFeedbackData {
  feedback: string;
  suggestedChanges?: {
    description?: string;
    details?: string;
    acceptanceCriteria?: string;
    name?: string;
    priority?: string;
    tags?: string[];
  };
  reasoning?: string;
}

export interface AgentChange {
  type:
    | 'initiative_update'
    | 'priority_change'
    | 'tag_addition'
    | 'content_refinement';
  field: string;
  oldValue?: unknown;
  newValue: unknown;
  reasoning: string;
}

export interface AgentToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface AgentExecutionError {
  code: string;
  message: string;
  type: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED' | 'TIMEOUT';
  retryAfter?: number;
}

// Zod schemas for validation - ensures no `any` types
export const MastraMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
});

const AgentMentionContextSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  messageId: z.string().min(1),
  summary: z.string().min(1).optional(),
});

const MastraAgentContextSchema = z
  .object({
    initiativeId: z.string().optional(),
    projectId: z.string(),
    conversationId: z.string(),
    organizationId: z.string(),
    planId: z.string().optional(),
    messageId: z.string().optional(),
    currentLevel: z.string().optional(),
    nodeId: z.string().optional(),
    workflowAboutId: z.string().optional(),
    workflowAboutType: z.string().optional(),
    mentions: z.array(AgentMentionContextSchema).optional(),
  })
  .passthrough();

export const MastraAgentBaseRequestSchema = z.object({
  agentId: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Agent ID must contain only alphanumeric characters, hyphens, and underscores',
    ),
  requestId: z.string().min(1),
  context: MastraAgentContextSchema,
  maxExecutionTime: z.number().min(1000).max(600000).nullable().optional(), // 1 second to 10 minutes
  temperature: z.number().min(0).max(1).nullable().optional(),
});

export const MastraAgentMessagesRequestSchema =
  MastraAgentBaseRequestSchema.extend({
    messages: z.array(MastraMessageSchema).min(1),
  });

export const MastraAgentStructuredRequestSchema =
  MastraAgentBaseRequestSchema.extend({
    input: z.object({}).passthrough(),
    inputFormat: z.string().min(1).optional(),
  });

// Backwards compatibility for existing imports
export const MastraAgentRequestSchema = MastraAgentMessagesRequestSchema;

type ParsedMessagesRequest = z.infer<typeof MastraAgentMessagesRequestSchema>;
type ParsedStructuredRequest = z.infer<
  typeof MastraAgentStructuredRequestSchema
>;
type ParsedContext = z.infer<typeof MastraAgentContextSchema>;
type NormalizedAgentRequest = {
  agentId: string;
  requestId: string;
  context: MastraAgentContext;
  maxExecutionTime?: number;
  temperature?: number;
  messages?: MastraMessage[];
  input?: Record<string, unknown>;
  inputFormat?: string;
};

export const AgentChangeSchema = z.object({
  type: z.enum([
    'initiative_update',
    'priority_change',
    'tag_addition',
    'content_refinement',
  ]),
  field: z.string().min(1),
  oldValue: z.unknown().nullable().optional(),
  newValue: z.unknown(),
  reasoning: z.string().min(1),
});

export const AgentToolCallSchema = z.object({
  name: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});

export const InitiativeResponseShapeSchema = z.object({
  acceptanceCriteria: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  summary: z.string().min(1), // Required field
});

export const TaskResponseShapeSchema = z.object({
  acceptanceCriteria: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  summary: z.string().min(1), // Required field
});

export const AgentExecutionResultSchema = z.object({
  text: z.string().min(1),
  summary: z.string().min(1),
  changes: z.array(AgentChangeSchema),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  toolCalls: z.array(AgentToolCallSchema).nullable().optional(),
});

const WORKFLOW_ABOUT_HEADERS: Record<WorkflowAboutType, string> = {
  task: 'X-Task-ID',
  initiative: 'X-Initiative-ID',
  'design-doc': 'X-Design-Doc-ID',
  'agent-session': 'X-Agent-Session-ID',
  conversation: 'X-Conversation-ID',
  project: 'X-Project-ID',
  message: 'X-Message-ID',
  proposal: 'X-Proposal-ID',
};

const isWorkflowAboutType = (value: string): value is WorkflowAboutType =>
  value in WORKFLOW_ABOUT_HEADERS;

const addWorkflowAboutTypeId = (
  headers: Record<string, string>,
  workflowAboutType?: string,
  workflowAboutId?: string,
): void => {
  if (!workflowAboutType || !workflowAboutId) {
    return;
  }
  if (!isWorkflowAboutType(workflowAboutType)) {
    return;
  }
  const headerName = WORKFLOW_ABOUT_HEADERS[workflowAboutType];
  if (!(headerName in headers)) {
    headers[headerName] = workflowAboutId;
  }
};

@Injectable()
export class MastraClientService {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(MastraClientService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly circuitBreakerThreshold: number;
  private readonly maxConcurrentExecutions: number;

  constructor(
    private configService: ConfigService,
    private readonly jwtService: JwtKeysService,
    private readonly llmTrackingService: LLMTrackingService,
    private readonly relationshipResolver: EntityRelationshipResolverService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'MASTRA_BASE_URL',
      'https://api.mastra.ai',
    );
    this.timeout = this.getNumericConfig('MASTRA_TIMEOUT', 300000); // 5 minutes default
    this.circuitBreakerThreshold = this.getNumericConfig(
      'MASTRA_CIRCUIT_BREAKER_THRESHOLD',
      5,
    );
    this.maxConcurrentExecutions = this.getNumericConfig(
      'MASTRA_MAX_CONCURRENT_EXECUTIONS',
      10,
    );

    this.logger.log(
      `MastraClientService initialized with base URL: ${this.baseUrl}`,
    );
  }

  private getNumericConfig(key: string, fallback: number): number {
    const value = this.configService.get<string | number>(key, fallback);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    this.logger.warn(
      `Invalid numeric config for ${key}: ${String(value)}. Falling back to ${fallback}`,
    );
    return fallback;
  }

  @WithWorkflowContext((...args) => {
    const [request, _responseSchema, source] = args as [
      MastraAgentMessagesRequest,
      z.ZodSchema<unknown>,
      (
        | {
            nodeId?: string;
            workflowId: string;
          }
        | undefined
      ),
    ];
    return {
      sourceService: 'MastraClientService',
      sourceMethod: 'executeAgent',
      context: {
        workflowId: source?.workflowId as WorkflowId | undefined,
      },
      metadata: {
        nodeId: source?.nodeId,
        operationType: 'agentExecution',
        agentId: request.agentId,
        requestId: request.requestId,
        messageCount: request.messages?.length || 0,
        hasContext: !!request.context,
        organizationId: request.context?.organizationId,
        projectId: request.context?.projectId,
      },
    };
  })
  @WithEventContext('MastraClientService')
  async executeAgent<T extends AgentResponseShape>(
    request: MastraAgentMessagesRequest,
    responseSchema: z.ZodSchema<T>,
    source?: {
      nodeId?: string;
      workflowId: string;
    },
  ): Promise<MastraAgentResponse<T>> {
    addToServiceChain('MastraClientService');
    const startTime = Date.now();

    const response = await this.executeAgentInternal(
      request,
      'messages',
      responseSchema,
      source,
    );

    trackProcessingTime('agentExecution', startTime);

    return response;
  }

  @WithWorkflowContext((...args) => {
    const [request, _responseSchema, source] = args as [
      MastraAgentStructuredRequest<Record<string, unknown>>,
      z.ZodSchema<unknown>,
      (
        | {
            nodeId?: string;
            workflowId: string;
          }
        | undefined
      ),
    ];
    return {
      sourceService: 'MastraClientService',
      sourceMethod: 'executeAgentStructured',
      context: {
        workflowId: source?.workflowId as WorkflowId | undefined,
      },
      metadata: {
        nodeId: source?.nodeId,
        operationType: 'agentExecution',
        agentId: request.agentId,
        requestId: request.requestId,
        inputFormat: request.inputFormat,
        hasContext: !!request.context,
        organizationId: request.context?.organizationId,
        projectId: request.context?.projectId,
      },
    };
  })
  @WithEventContext('MastraClientService')
  async executeAgentStructured<
    TInput extends Record<string, unknown>,
    T extends AgentResponseShape,
  >(
    request: MastraAgentStructuredRequest<TInput>,
    responseSchema: z.ZodSchema<T>,
    source?: {
      nodeId?: string;
      workflowId: string;
    },
  ): Promise<MastraAgentResponse<T>> {
    addToServiceChain('MastraClientService');
    const startTime = Date.now();

    const response = await this.executeAgentInternal(
      request,
      'structured',
      responseSchema,
      source,
    );

    trackProcessingTime('agentExecution', startTime);

    return response;
  }

  /**
   * Scan request payload for potential cross-org leakage
   */
  private scanRequestForSensitiveData(
    request: MastraAgentBaseRequest,
    messages?: MastraMessage[],
  ): void {
    // Validate that no organization-identifying information is in prompts
    const organizationId = request.context.organizationId;
    for (const message of messages ?? []) {
      // Check for potential organization ID leakage in content
      if (message.content.includes(organizationId)) {
        this.logger.warn(
          `Potential organization ID leakage detected in message content for ${organizationId}`,
        );
        // In production, you might want to sanitize or reject the request
      }

      // Check for other potentially sensitive information
      // This is a basic implementation - you'd want more sophisticated checks
      if (message.content.match(/org[-_]?id|organization[-_]?id/i)) {
        this.logger.warn(
          `Potential organization identifier detected in message content for ${organizationId}`,
        );
      }
    }

    // Validate context doesn't contain sensitive cross-org data
    if (request.context) {
      const sensitiveFields = ['userId', 'email', 'apiKey'];
      for (const field of sensitiveFields) {
        if (field in request.context) {
          this.logger.warn(
            `Sensitive field '${field}' detected in agent context for organization ${organizationId}`,
          );
        }
      }
    }
  }

  private normalizeContext(context: ParsedContext): MastraAgentContext {
    const {
      organizationId,
      projectId,
      conversationId,
      workflowAboutId,
      workflowAboutType,
      initiativeId,
      planId,
      messageId,
      nodeId,
      currentLevel,
      mentions,
    } = context;

    const normalized: MastraAgentContext = {
      organizationId: organizationId as OrganizationId,
      projectId: projectId as ProjectId,
      conversationId: conversationId as ConversationId,
      workflowAboutId,
      workflowAboutType,
    };

    if (planId) {
      normalized.planId = planId as PlanId;
    }

    if (messageId) {
      normalized.messageId = messageId as MessageId;
    }

    if (initiativeId) {
      normalized.initiativeId = initiativeId as InitiativeId;
    }

    if (nodeId) {
      normalized.nodeId = nodeId;
    }

    if (currentLevel) {
      normalized.currentLevel = currentLevel;
    }

    if (mentions && mentions.length > 0) {
      normalized.mentions = mentions as Array<
        Required<{
          summary?: string;
          messageId?: string;
          entityType?: string;
          entityId?: string;
        }>
      >;
    }

    return normalized;
  }

  /**
   * Get organization-specific API key
   */
  private async getJwt(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<string> {
    try {
      const resolvedKey = this.jwtService.getToken(
        { organizationId, projectId },
        { expiresIn: '1h' },
      );

      if (!resolvedKey) {
        throw new Error('Mastra API key is unavailable');
      }

      return resolvedKey;
    } catch (error) {
      // 3. If we fail to get the API key, throw an error
      throw new Error(
        `Failed to get API key for organization ${organizationId}: ${(error as Error).message}`,
      );
    }
  }

  private parseAndNormalizeRequest(
    payloadKind: 'messages' | 'structured',
    request: MastraAgentBaseRequest & {
      messages?: MastraMessage[];
      input?: Record<string, unknown>;
      inputFormat?: string;
    },
  ): {
    validatedRequest: NormalizedAgentRequest;
    messages?: MastraMessage[];
    structuredInput?: Record<string, unknown>;
  } {
    const validationResult =
      payloadKind === 'messages'
        ? MastraAgentMessagesRequestSchema.safeParse(request)
        : MastraAgentStructuredRequestSchema.safeParse(request);
    if (!validationResult.success) {
      const errorMessage = `Invalid agent request: ${validationResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`;
      throw new Error(errorMessage);
    }

    let validatedRequest: NormalizedAgentRequest;

    if (payloadKind === 'messages') {
      const parsed = validationResult.data as ParsedMessagesRequest;
      const normalizedContext = this.normalizeContext(parsed.context);
      const normalizedMessages: MastraMessage[] = parsed.messages.map(
        (message) => ({
          role: message.role,
          content: message.content,
        }),
      );

      validatedRequest = {
        agentId: parsed.agentId,
        requestId: parsed.requestId,
        context: normalizedContext,
        messages: normalizedMessages,
        maxExecutionTime: parsed.maxExecutionTime ?? undefined,
        temperature: parsed.temperature ?? undefined,
      };

      return {
        validatedRequest,
        messages: normalizedMessages,
      };
    }

    const parsed = validationResult.data as ParsedStructuredRequest;
    const normalizedContext = this.normalizeContext(parsed.context);

    validatedRequest = {
      agentId: parsed.agentId,
      requestId: parsed.requestId,
      context: normalizedContext,
      input: parsed.input as Record<string, unknown>,
      maxExecutionTime: parsed.maxExecutionTime ?? undefined,
      temperature: parsed.temperature ?? undefined,
      ...(parsed.inputFormat ? { inputFormat: parsed.inputFormat } : {}),
    };

    return {
      validatedRequest,
      structuredInput: parsed.input as Record<string, unknown>,
    };
  }

  private buildPromptString(
    payloadKind: 'messages' | 'structured',
    messages?: MastraMessage[],
    structuredInput?: Record<string, unknown>,
  ): string {
    if (payloadKind === 'messages') {
      return (
        messages
          ?.map(
            (message, index) =>
              `${index + 1}. [${message.role.toUpperCase()}] ${message.content}`,
          )
          .join('\n') ?? ''
      );
    }

    return JSON.stringify(structuredInput, null, 2);
  }

  private buildPayloadSummary(
    payloadKind: 'messages' | 'structured',
    messages?: MastraMessage[],
    structuredInput?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (payloadKind === 'messages') {
      return {
        messageCount: messages?.length ?? 0,
        messageRoles: messages?.map((m) => m.role),
        firstMessagePreview: messages?.[0]?.content?.substring(0, 200),
      };
    }

    return {
      structuredKeys: structuredInput
        ? Object.keys(structuredInput)
        : undefined,
      structuredPreview: structuredInput
        ? JSON.stringify(structuredInput).substring(0, 200)
        : undefined,
    };
  }

  private buildIdHeaders(
    context: MastraAgentContext,
    requestId: string,
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    const idHeaders: Record<string, string> = {
      'X-Organization-ID': context.organizationId,
      'X-Project-ID': context.projectId,
      'X-Conversation-ID': context.conversationId,
      'X-Request-ID': requestId,
    };

    if (context.initiativeId) {
      idHeaders['X-Initiative-ID'] = context.initiativeId;
    }
    if (context.planId && !('X-Plan-ID' in idHeaders)) {
      idHeaders['X-Plan-ID'] = context.planId;
    }
    if (context.messageId && !('X-Message-ID' in idHeaders)) {
      idHeaders['X-Message-ID'] = context.messageId;
    }
    addWorkflowAboutTypeId(
      idHeaders,
      context.workflowAboutType,
      context.workflowAboutId,
    );

    if (additionalHeaders) {
      for (const [key, value] of Object.entries(additionalHeaders)) {
        if (!(key in idHeaders)) {
          idHeaders[key] = value;
        }
      }
    }

    return idHeaders;
  }

  private mergeResolvedContext(
    context: MastraAgentContext,
    resolved: {
      planId?: PlanId;
      initiativeId?: InitiativeId;
      taskId?: string;
      designDocId?: string;
    },
  ): MastraAgentContext {
    const merged = { ...context };

    if (!merged.planId && resolved.planId) {
      merged.planId = resolved.planId;
    }

    if (!merged.initiativeId && resolved.initiativeId) {
      merged.initiativeId = resolved.initiativeId;
    }

    return merged;
  }

  private buildBodyPayload(
    payloadKind: 'messages' | 'structured',
    context: MastraAgentContext,
    validatedRequest: NormalizedAgentRequest,
    messages?: MastraMessage[],
    structuredInput?: Record<string, unknown>,
  ): Record<string, unknown> {
    const basePayload: Record<string, unknown> =
      payloadKind === 'messages'
        ? { messages }
        : { ...(structuredInput ?? {}) };

    const bodyPayload: Record<string, unknown> =
      context.mentions && context.mentions.length > 0
        ? {
            ...basePayload,
            mentions: context.mentions,
          }
        : basePayload;

    if (
      validatedRequest.temperature !== undefined &&
      validatedRequest.temperature !== null
    ) {
      bodyPayload.temperature = validatedRequest.temperature;
    }

    if (
      validatedRequest.maxExecutionTime !== undefined &&
      validatedRequest.maxExecutionTime !== null
    ) {
      bodyPayload.maxExecutionTime = validatedRequest.maxExecutionTime;
    }

    return bodyPayload;
  }

  private buildRequestArgs(
    payloadKind: 'messages' | 'structured',
    validatedRequest: NormalizedAgentRequest,
    context: MastraAgentContext,
    apiKey: string,
    messages?: MastraMessage[],
    structuredInput?: Record<string, unknown>,
    additionalHeaders?: Record<string, string>,
  ): {
    requestArgs: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal: AbortSignal;
    };
    endpoint: string;
    abortTimeout: number;
  } {
    const bodyPayload = this.buildBodyPayload(
      payloadKind,
      context,
      validatedRequest,
      messages,
      structuredInput,
    );
    const abortTimeout =
      validatedRequest.maxExecutionTime && validatedRequest.maxExecutionTime > 0
        ? validatedRequest.maxExecutionTime
        : this.timeout;
    const idHeaders = this.buildIdHeaders(
      context,
      validatedRequest.requestId,
      additionalHeaders,
    );

    const requestArgs = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'hey-hey-api/1.0',
        ...idHeaders,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(abortTimeout),
    };

    const endpoint = `${this.baseUrl}/${encodeURIComponent(validatedRequest.agentId)}`;

    return { requestArgs, endpoint, abortTimeout };
  }

  private parseMastraResponse(responseText: string): Record<string, unknown> {
    try {
      const repairedJson = jsonrepair(responseText);
      return JSON.parse(repairedJson) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse agent response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private extractUsageStats(
    rawResult: Record<string, unknown>,
  ): MastraUsageStats | undefined {
    const topLevelUsage = (rawResult as { usage?: MastraUsageStats }).usage;
    if (topLevelUsage && typeof topLevelUsage === 'object') {
      return topLevelUsage;
    }

    const nestedUsage = (
      rawResult as {
        data?: { usage?: MastraUsageStats };
      }
    ).data?.usage;
    if (nestedUsage && typeof nestedUsage === 'object') {
      return nestedUsage;
    }

    return undefined;
  }

  private summarizeValidationIssues(
    issues: z.ZodIssue[],
  ): Array<{ code: string; path: string; message: string }> {
    return issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }

  private async executeAgentInternal<T extends AgentResponseShape>(
    request: MastraAgentBaseRequest & {
      messages?: MastraMessage[];
      input?: Record<string, unknown>;
      inputFormat?: string;
    },
    payloadKind: 'messages' | 'structured',
    responseSchema: z.ZodSchema<T>,
    source?: {
      nodeId?: string;
      workflowId: string;
    },
  ): Promise<MastraAgentResponse<T>> {
    const { validatedRequest, messages, structuredInput } =
      this.parseAndNormalizeRequest(payloadKind, request);
    const originalContext = validatedRequest.context;
    const relationshipResolution =
      await this.relationshipResolver.resolveForWorkflowAbout({
        organizationId: originalContext.organizationId,
        conversationId: originalContext.conversationId,
        workflowAboutType:
          originalContext.workflowAboutType as WorkflowAboutType,
        workflowAboutId: originalContext.workflowAboutId,
      });
    const enrichedContext = this.mergeResolvedContext(
      originalContext,
      relationshipResolution.resolvedContext,
    );

    if (
      payloadKind === 'structured' &&
      (!structuredInput || typeof structuredInput !== 'object')
    ) {
      throw new Error(
        'Structured agent requests must include an object input payload',
      );
    }

    this.scanRequestForSensitiveData(validatedRequest, messages);

    const promptString = this.buildPromptString(
      payloadKind,
      messages,
      structuredInput,
    );

    let intervalId: NodeJS.Timeout | undefined;
    const startTime = Date.now();
    let executionTime = 0;
    let requestArgs:
      | {
          method: string;
          headers: Record<string, string>;
          body: string;
          signal: AbortSignal;
        }
      | undefined;
    let endpoint: string | undefined;
    let abortTimeout: number = this.timeout;
    const payloadSummary = this.buildPayloadSummary(
      payloadKind,
      messages,
      structuredInput,
    );
    let trackingRecorded = false;
    let usage: MastraUsageStats | undefined;
    let totalCost: number | undefined;

    try {
      this.logger.log(
        `Executing agent ${validatedRequest.agentId} for organization ${enrichedContext.organizationId} using ${payloadKind} payload`,
        {
          // Identification context
          organizationId: enrichedContext.organizationId,
          projectId: enrichedContext.projectId,
          conversationId: enrichedContext.conversationId,
          workflowId: source?.workflowId,
          nodeId: source?.nodeId ?? enrichedContext.nodeId,
          initiativeId: enrichedContext.initiativeId,
          workflowAboutType: enrichedContext.workflowAboutType,
          workflowAboutId: enrichedContext.workflowAboutId,

          // Request details
          agentId: validatedRequest.agentId,
          requestId: validatedRequest.requestId,
          payloadKind,
          messageRoles: messages?.map((m) => m.role),
          firstMessagePreview:
            messages?.[0]?.content?.substring(0, 100) ??
            (payloadKind === 'structured'
              ? JSON.stringify(structuredInput).substring(0, 100) + '...'
              : undefined),
          structuredKeys: structuredInput
            ? Object.keys(structuredInput)
            : undefined,
        },
      );

      const apiKey = await this.getJwt(
        enrichedContext.organizationId,
        enrichedContext.projectId,
      );

      const requestInfo = this.buildRequestArgs(
        payloadKind,
        validatedRequest,
        enrichedContext,
        apiKey,
        messages,
        structuredInput,
        relationshipResolution.additionalHeaders,
      );
      requestArgs = requestInfo.requestArgs;
      endpoint = requestInfo.endpoint;
      abortTimeout = requestInfo.abortTimeout;

      let iteration = 1;
      intervalId = setInterval(() => {
        this.logger.debug(
          `[executeAgentInternal:${payloadKind}] waiting on agent response ${iteration * 3000}ms`,
          {
            agentId: validatedRequest.agentId,
            workflowId: source?.workflowId,
            nodeId: source?.nodeId ?? enrichedContext.nodeId,
            conversationId: enrichedContext.conversationId,
          },
        );
        iteration++;
      }, 3000);

      const response = await fetch(endpoint, requestArgs);

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => 'Unable to read error response');
        throw new Error(
          `Mastra.ai API error: ${response.status} ${response.statusText}. Response: ${errorBody}`,
        );
      }

      // Parse response with JSON repair for malformed JSON
      const responseText = await response.text();
      let rawResult: Record<string, unknown>;
      try {
        rawResult = this.parseMastraResponse(responseText);
      } catch (error) {
        this.logger.error('Failed to parse agent response JSON', {
          agentId: validatedRequest.agentId,
          responsePreview: responseText.substring(0, 200),
          error: error instanceof Error ? error.message : error,
        });
        throw new Error(
          `Failed to parse agent response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
      executionTime = Date.now() - startTime;

      // AGGRESSIVE LOGGING - Debug the exact response structure
      this.logger.log('RAW AGENT RESPONSE STRUCTURE', {
        agentId: validatedRequest.agentId,
        rawResultType: typeof rawResult,
        rawResultKeys: rawResult ? Object.keys(rawResult) : 'null',
        hasDataField: rawResult && 'data' in rawResult,
        dataType: rawResult?.data ? typeof rawResult.data : 'undefined',
        dataKeys: rawResult?.data ? Object.keys(rawResult.data) : 'none',
        fullRawResult: JSON.stringify(rawResult, null, 2),
      });

      usage = this.extractUsageStats(rawResult);
      totalCost =
        typeof usage?.estimatedCostUsd === 'number'
          ? usage.estimatedCostUsd
          : undefined;

      // Extract the data field from the wrapped response. Some agents return
      // the payload directly (e.g., suspended responses), so fall back to
      // validating the top-level object when data is missing.
      let dataToValidate: unknown = rawResult?.data;
      if (!dataToValidate) {
        const directValidation = responseSchema.safeParse(rawResult ?? {});
        if (!directValidation.success) {
          throw new Error(
            `Invalid Mastra API response format: expected {data: {...}} or a direct response but got ${JSON.stringify(rawResult)}`,
          );
        }
        dataToValidate = rawResult;
      }

      this.logger.log('DATA TO VALIDATE', {
        agentId: validatedRequest.agentId,
        dataToValidateType: typeof dataToValidate,
        dataToValidateKeys: dataToValidate
          ? Object.keys(dataToValidate)
          : 'null',
        dataToValidate: JSON.stringify(dataToValidate, null, 2),
      });

      // Validate the data field with the provided schema
      const dataValidation = responseSchema.safeParse(dataToValidate);

      this.logger.log('VALIDATION RESULTS', {
        agentId: validatedRequest.agentId,
        validationSuccess: dataValidation.success,
        validationErrors: dataValidation.success
          ? 'none'
          : dataValidation.error.issues.map(
              (issue) => `${issue.path.join('.')}: ${issue.message}`,
            ),
        validatedData: dataValidation.success
          ? JSON.stringify(dataValidation.data, null, 2)
          : 'validation failed',
      });

      if (!dataValidation.success) {
        const errorMessage = `Invalid agent response data: ${dataValidation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`;
        this.logger.debug('VALIDATION FAILED', {
          agentId: validatedRequest.agentId,
          errorMessage,
          rawData: JSON.stringify(dataToValidate, null, 2),
        });

        // Record invalid response to database for debugging
        try {
          await this.llmTrackingService.recordPromptResponse({
            requestId: validatedRequest.requestId,
            organizationId: enrichedContext.organizationId,
            projectId: enrichedContext.projectId,
            conversationId: enrichedContext.conversationId,
            workflowId: (source?.workflowId ??
              enrichedContext.workflowAboutId) as WorkflowId | undefined,
            flowId: enrichedContext.workflowAboutId,
            nodeId: source?.nodeId ?? enrichedContext.nodeId,
            nodeType: enrichedContext.workflowAboutType,
            provider: 'mastra',
            model: validatedRequest.agentId,
            temperature: validatedRequest.temperature ?? undefined,
            stream: false,
            prompt: promptString,
            responseContent: JSON.stringify(dataToValidate, null, 2),
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            totalCost,
            durationMs: executionTime,
            success: false,
            errorMessage,
            errorType: 'VALIDATION_ERROR',
            metadata: {
              validationSummary: dataValidation.error.flatten(),
              validationIssues: this.summarizeValidationIssues(
                dataValidation.error.issues,
              ),
              fullRawResult: rawResult,
            },
          });
          trackingRecorded = true;
        } catch (trackingError) {
          this.logger.warn('Failed to record invalid Mastra response', {
            error:
              trackingError instanceof Error
                ? trackingError.message
                : trackingError,
          });
        }

        throw new Error(errorMessage);
      }

      const validatedData = dataValidation.data;

      const conversationTitle =
        typeof (validatedData as { conversationTitle?: unknown })
          .conversationTitle === 'string'
          ? (validatedData as { conversationTitle?: string }).conversationTitle
          : undefined;
      const hasConversationTitle =
        typeof conversationTitle === 'string' &&
        conversationTitle.trim().length > 0;
      this.logger.log('BUG202 conversationTitle check', {
        agentId: validatedRequest.agentId,
        requestId: validatedRequest.requestId,
        conversationId: enrichedContext.conversationId,
        hasConversationTitle,
        conversationTitle,
        eligibleForUpdate: hasConversationTitle,
      });

      const cost =
        (rawResult as { cost?: number }).cost ??
        (rawResult as { data?: { cost?: number } }).data?.cost;
      const hasCostData =
        typeof cost === 'number' || typeof totalCost === 'number';
      this.logger.log('BUG202 cost data presence', {
        agentId: validatedRequest.agentId,
        requestId: validatedRequest.requestId,
        conversationId: enrichedContext.conversationId,
        hasCostData,
        rawCost: cost,
        usageCost: totalCost,
      });

      // Convert Mastra response to our expected format
      const agentResponse: MastraAgentResponse<T> = {
        executionId: `mastra-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        status: 'completed',
        result: {
          agentId: validatedRequest.agentId,
          data: validatedData, // Validated structured data
          confidence: 0.9, // Default confidence
        },
        executionTime,
        ...(typeof cost === 'number' ? { cost } : {}),
      };

      // Log execution details
      this.logger.log(
        `Agent ${validatedRequest.agentId} executed in ${agentResponse.executionTime}ms with status: ${agentResponse.status}, cost: $${agentResponse.cost}`,
        {
          // Identification context
          organizationId: enrichedContext.organizationId,
          projectId: enrichedContext.projectId,
          conversationId: enrichedContext.conversationId,
          workflowId: source?.workflowId,
          nodeId: source?.nodeId ?? enrichedContext.nodeId,
          initiativeId: enrichedContext.initiativeId,
          workflowAboutType: enrichedContext.workflowAboutType,
          workflowAboutId: enrichedContext.workflowAboutId,

          // Execution results
          agentId: validatedRequest.agentId,
          executionTime: agentResponse.executionTime,
          status: agentResponse.status,
          cost: agentResponse.cost,
          validatedData,
        },
      );

      try {
        await this.llmTrackingService.recordPromptResponse({
          requestId: validatedRequest.requestId,
          organizationId: enrichedContext.organizationId,
          projectId: enrichedContext.projectId,
          conversationId: enrichedContext.conversationId,
          workflowId: (source?.workflowId ??
            enrichedContext.workflowAboutId) as WorkflowId | undefined,
          flowId: enrichedContext.workflowAboutId,
          nodeId: source?.nodeId ?? enrichedContext.nodeId,
          nodeType: enrichedContext.workflowAboutType,
          provider: 'mastra',
          model: validatedRequest.agentId,
          temperature: validatedRequest.temperature ?? undefined,
          stream: false,
          prompt: promptString,
          responseContent: JSON.stringify(agentResponse.result ?? {}),
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          totalCost,
          durationMs: executionTime,
          success: true,
          metadata:
            rawResult && typeof rawResult === 'object' ? rawResult : undefined,
        });
      } catch (trackingError) {
        this.logger.warn('Failed to record Mastra prompt/response', {
          error:
            trackingError instanceof Error
              ? trackingError.message
              : trackingError,
        });
      }

      return agentResponse;
    } catch (error) {
      executionTime = Date.now() - startTime;

      const errorType = this.classifyError(error);

      this.logger.error('Mastra agent execution failed', {
        agentId: validatedRequest.agentId,
        requestId: validatedRequest.requestId,
        organizationId: enrichedContext.organizationId,
        projectId: enrichedContext.projectId,
        conversationId: enrichedContext.conversationId,
        workflowId: source?.workflowId,
        nodeId: source?.nodeId ?? enrichedContext.nodeId,
        payloadKind,
        payloadSummary,
        endpoint,
        requestHeaderKeys: requestArgs ? Object.keys(requestArgs.headers) : [],
        abortTimeoutMs: abortTimeout,
        executionTime,
        errorType,
        errorMessage: error instanceof Error ? error.message : error,
        errorName: error instanceof Error ? error.name : undefined,
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      if (!trackingRecorded) {
        try {
          await this.llmTrackingService.recordPromptResponse({
            requestId: validatedRequest.requestId,
            organizationId: enrichedContext.organizationId,
            projectId: enrichedContext.projectId,
            conversationId: enrichedContext.conversationId,
            workflowId: source?.workflowId as WorkflowId,
            flowId: enrichedContext.workflowAboutId,
            nodeId: source?.nodeId ?? enrichedContext.nodeId,
            nodeType: enrichedContext.workflowAboutType,
            provider: 'mastra',
            model: validatedRequest.agentId,
            temperature: validatedRequest.temperature ?? undefined,
            stream: false,
            prompt: promptString,
            responseContent:
              error instanceof Error ? error.message : JSON.stringify(error),
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            totalCost,
            durationMs: executionTime,
            success: false,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
            errorType,
            metadata:
              error instanceof Error
                ? {
                    name: error.name,
                    stack: error.stack,
                    endpoint,
                    payloadKind,
                    payloadSummary,
                    abortTimeoutMs: abortTimeout,
                    requestHeaderKeys: requestArgs
                      ? Object.keys(requestArgs.headers)
                      : [],
                  }
                : {
                    endpoint,
                    payloadKind,
                    payloadSummary,
                    abortTimeoutMs: abortTimeout,
                    requestHeaderKeys: requestArgs
                      ? Object.keys(requestArgs.headers)
                      : [],
                  },
          });
        } catch (trackingError) {
          this.logger.warn('Failed to record Mastra prompt/response error', {
            error:
              trackingError instanceof Error
                ? trackingError.message
                : trackingError,
          });
        }
      }

      throw new Error(
        `Agent execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        } (Type: ${errorType})`,
      );
    } finally {
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
  }

  private classifyError(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('timeout') || message.includes('aborted')) {
        return 'TIMEOUT';
      }

      if (message.includes('rate limit') || message.includes('429')) {
        return 'RATE_LIMITED';
      }

      if (
        message.includes('auth') ||
        message.includes('401') ||
        message.includes('403')
      ) {
        return 'NON_RETRYABLE';
      }

      if (message.includes('400') || message.includes('invalid')) {
        return 'NON_RETRYABLE';
      }

      if (
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')
      ) {
        return 'RETRYABLE';
      }
    }

    // Default to retryable for unknown errors
    return 'RETRYABLE';
  }

  /**
   * Get circuit breaker key for agent execution monitoring
   * Used by FlowNodeProcessor for circuit breaker patterns
   */
  getCircuitBreakerKey(
    agentId: string,
    organizationId: OrganizationId,
  ): string {
    return `agent_${agentId}_${organizationId}`;
  }

  /**
   * Validate agent configuration before execution
   */
  validateAgentConfig(
    agentId: string,
    messages: MastraMessage[],
    context?: Record<string, unknown>,
  ): void {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('Agent ID must be a non-empty string');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Agent messages must be a non-empty array');
    }

    // Validate each message structure
    for (const message of messages) {
      if (
        !message.role ||
        !['user', 'assistant', 'system'].includes(message.role)
      ) {
        throw new Error(
          'Each message must have a valid role (user, assistant, or system)',
        );
      }
      if (!message.content || typeof message.content !== 'string') {
        throw new Error('Each message must have non-empty string content');
      }
    }

    // Validate context if provided
    if (
      context !== undefined &&
      (typeof context !== 'object' ||
        context === null ||
        Array.isArray(context))
    ) {
      throw new Error('Agent context must be an object');
    }

    // Check for potentially problematic payload size
    const totalSize = JSON.stringify({ messages, context }).length;
    if (totalSize > 100000) {
      // 100KB limit
      this.logger.warn(
        `Large agent payload detected: ${totalSize} bytes for agent ${agentId}`,
      );
    }
  }
}
