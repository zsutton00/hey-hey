import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jsonrepair } from 'jsonrepair';
import OpenAI from 'openai';
import {
  ConversationId,
  MockLlmSessionId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import { IntermediateSystemMessageData } from 'src/types/flow-internal.types';
import { errorToLoggable } from 'src/utils/logging.util';
import type { ZodIssue } from 'zod';
import {
  addToServiceChain,
  enrichEventContext,
  trackProcessingTime,
} from '../../core/events/context-utils';
import {
  WithEventContext,
  WithWorkflowContext,
} from '../../core/events/observable-event.context';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';
import { JsonExtractionUtil } from '../../utils/json-extraction.util';
import { ClassificationClientService } from '../classification/classification-client.service';
import {
  ALL_MODEL_TIERS,
  ANTHROPIC_TIER_MODELS,
  CLAUDE_MODEL_TIERS,
  ClaudeModel,
  DEFAULT_SYNTHETIC_MODEL,
  DEFAULT_MAX_TOKENS,
  LLMModel,
  LLMProviderName,
  ModelTier,
  OPENAI_MODEL_TIERS,
  OPENAI_TIER_MODELS,
  OpenAIModel,
} from './llm-shared';
import { LLMTrackingService } from './llm-tracking.service';
import { providerTargetsMockLlmServer } from './mock-llm-routing';
import {
  type LLMCallOptions,
  type LLMCostData,
  type LLMRequest,
  type LLMResponse,
  ModelSelectionCriteria,
  TaskType,
} from './llm-types';
import { ClaudeLLMProvider } from './providers/claude-llm.provider';
import type { LLMProvider as StructuredLLMProvider } from './providers/llm-provider.interface';
import { OpenAILLMProvider } from './providers/openai-llm.provider';
import { SyntheticLLMProvider } from './providers/synthetic-llm.provider';
import type { MutableIntermediateSystemMessageData } from './streaming/structured-streaming.util';
import {
  createSchemaFieldValidators,
  ensureSystemMessageData,
} from './streaming/structured-streaming.util';

/**
 * Structured error class for LLM API failures
 */
export class LLMApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly provider: LLMProviderName,
    public readonly originalError?: string,
  ) {
    super(message);
    this.name = 'LLMApiError';
  }
}

type StructuredStreamValidationErrorContext = {
  responseContent: string;
  validationErrors?: ZodIssue[];
  requestId?: string;
  costData?: LLMCostData;
  usage?: LLMResponse['usage'];
};

type StructuredValidationTrackingContext = {
  responseContent?: string;
  validationErrors?: ZodIssue[];
  requestId?: string;
  costData?: LLMCostData;
  usage?: LLMResponse['usage'];
};

export class StructuredStreamValidationError extends Error {
  responseContent: string;
  validationErrors?: ZodIssue[];
  requestId?: string;
  costData?: LLMCostData;
  usage?: LLMResponse['usage'];

  constructor(
    message: string,
    context: StructuredStreamValidationErrorContext,
  ) {
    super(message);
    this.name = 'StructuredStreamValidationError';
    this.responseContent = context.responseContent;
    this.validationErrors = context.validationErrors;
    this.requestId = context.requestId;
    this.costData = context.costData;
    this.usage = context.usage;
  }
}

type StructuredValidationTrackingError = Error &
  StructuredValidationTrackingContext;

function hasStructuredValidationTrackingContext(
  error: unknown,
): error is StructuredValidationTrackingError {
  if (!(error instanceof Error)) {
    return false;
  }

  const context = error as Partial<StructuredValidationTrackingContext>;
  return (
    context.responseContent !== undefined ||
    context.validationErrors !== undefined ||
    context.requestId !== undefined ||
    context.costData !== undefined ||
    context.usage !== undefined
  );
}
// import { testResponse } from '../flows/mocks/testResponse';
// import { testResponseInitiatives } from '../flows/mocks/testResponse2';

/**
 * LLM Client Service - Can be configured for internal or external LLM service
 *
 * SCALABILITY APPROACH:
 * - Use separate LLM service for better resource management
 * - Configure dedicated thread pools and timeouts
 * - Implement proper circuit breaking and retries
 */
@Injectable()
export class LLMClientService {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(LLMClientService.name);
  private readonly apiKey: string;
  private readonly timeout: number;

  // Local LLM Configuration
  private readonly localEnabled: boolean;
  private readonly localUrl: string;
  private readonly localModel: string;
  private readonly localTimeout: number;

  // Provider Configuration
  private readonly provider: LLMProviderName;
  private readonly openaiApiKey: string;
  private readonly openaiBaseUrl: string;
  private readonly openaiOrganization: string;
  private readonly anthropicBaseUrl: string;
  private readonly openaiClient: OpenAI;
  private readonly syntheticApiKey: string;
  private readonly syntheticBaseUrl: string;
  private readonly syntheticAnthropicBaseUrl: string;
  private readonly syntheticModel: string;
  private readonly providers = new Map<
    LLMProviderName,
    StructuredLLMProvider
  >();

  constructor(
    private configService: ConfigService,
    private classificationClientService: ClassificationClientService,
    private llmTrackingService: LLMTrackingService,
  ) {
    // Provider selection
    this.provider = this.configService.get<LLMProviderName>(
      'LLM_PROVIDER',
      LLMProviderName.CLAUDE,
    );
    this.apiKey = this.configService.get<string>('CLAUDE_API_KEY', '');
    this.timeout = this.configService.get<number>('LLM_TIMEOUT', 120000);

    // OpenAI Configuration
    this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY', '');
    this.openaiBaseUrl = this.configService.get<string>(
      'OPENAI_BASE_URL',
      'https://api.openai.com/v1',
    );
    this.openaiOrganization = this.configService.get<string>(
      'OPENAI_ORGANIZATION',
      '',
    );
    this.anthropicBaseUrl = this.configService.get<string>(
      'ANTHROPIC_BASE_URL',
      'https://api.anthropic.com',
    );
    this.syntheticApiKey = this.configService.get<string>(
      'SYNTHETIC_LLM_API_KEY',
      this.configService.get<string>('SYNTHETIC_API_KEY', ''),
    );
    this.syntheticBaseUrl = this.configService.get<string>(
      'SYNTHETIC_BASE_URL_OPENAI',
      this.configService.get<string>(
        'SYNTHETIC_BASE_URL',
        'https://api.synthetic.new/openai/v1',
      ),
    );
    this.syntheticAnthropicBaseUrl = this.configService.get<string>(
      'SYNTHETIC_BASE_URL_ANTHROPIC',
      '',
    );
    this.syntheticModel = this.configService.get<string>(
      'SYNTHETIC_MODEL',
      DEFAULT_SYNTHETIC_MODEL,
    );

    // Initialize OpenAI client
    this.openaiClient = new OpenAI({
      apiKey: this.openaiApiKey,
      baseURL: this.openaiBaseUrl,
      organization: this.openaiOrganization || undefined,
    });

    const openaiProvider = new OpenAILLMProvider(
      this.logger,
      this.openaiClient,
      this.openaiBaseUrl,
      this.openaiApiKey,
      this.openaiOrganization || undefined,
      this.timeout,
      DEFAULT_MAX_TOKENS,
      OPENAI_MODEL_TIERS,
    );
    const claudeProvider = new ClaudeLLMProvider(
      this.logger,
      this.apiKey,
      this.timeout,
      DEFAULT_MAX_TOKENS,
      this.anthropicBaseUrl,
    );
    const syntheticProvider = new SyntheticLLMProvider(
      this.logger,
      this.syntheticApiKey,
      this.syntheticBaseUrl,
      this.timeout,
      DEFAULT_MAX_TOKENS,
      this.syntheticModel,
    );

    this.providers.set(LLMProviderName.OPENAI, openaiProvider);
    this.providers.set(LLMProviderName.CLAUDE, claudeProvider);
    this.providers.set(LLMProviderName.SYNTHETIC, syntheticProvider);

    // Local LLM Configuration
    const localEnabledValue = this.configService.get<string>(
      'LLM_LOCAL_ENABLED',
      'false',
    );
    this.localEnabled = localEnabledValue === 'true';
    this.localUrl = this.configService.get<string>(
      'LLM_LOCAL_URL',
      'http://192.168.50.212:11434',
    );
    this.localModel = this.configService.get<string>(
      'LLM_LOCAL_MODEL',
      'llama3.2:3b',
    );
    this.localTimeout = this.configService.get<number>(
      'LLM_LOCAL_TIMEOUT',
      this.timeout,
    );

    console.log('LLM Provider:', this.provider);
    console.log('Local enabled:', this.localEnabled, typeof this.localEnabled);

    // Validation for production environments
    if (this.localEnabled && process.env.NODE_ENV === 'production') {
      throw new Error('Local LLM cannot be enabled in production environments');
    }

    // Comprehensive configuration validation
    this.validateConfiguration();
  }

  /**
   * Validate all LLM configuration based on selected provider
   * @private
   */
  private validateConfiguration(): void {
    // Validate provider selection
    if (!Object.values(LLMProviderName).includes(this.provider)) {
      throw new Error(
        `Invalid LLM_PROVIDER: ${this.provider}. Must be one of: ${Object.values(LLMProviderName).join(', ')}`,
      );
    }

    // Provider-specific validation
    switch (this.provider) {
      case LLMProviderName.CLAUDE:
        this.validateClaudeConfig();
        break;
      case LLMProviderName.OPENAI:
        this.validateOpenAIConfig();
        break;
      case LLMProviderName.SYNTHETIC:
        this.validateSyntheticConfig();
        break;
      case LLMProviderName.LOCAL:
        this.validateLocalLLMConfig();
        break;
    }

    this.logger.debug('LLM configuration validated successfully', {
      provider: this.provider,
      localEnabled: this.localEnabled,
    });
  }

  /**
   * Validate Claude configuration
   * @private
   */
  private validateClaudeConfig(): void {
    if (!this.apiKey) {
      throw new Error('CLAUDE_API_KEY is required when using Claude provider');
    }
  }

  /**
   * Validate OpenAI configuration
   * @private
   */
  private validateOpenAIConfig(): void {
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required when using OpenAI provider');
    }

    try {
      new URL(this.openaiBaseUrl);
    } catch {
      throw new Error(
        `Invalid OPENAI_BASE_URL: ${this.openaiBaseUrl}. Must be a valid URL`,
      );
    }
  }

  /**
   * Validate Synthetic configuration
   * @private
   */
  private validateSyntheticConfig(): void {
    if (!this.syntheticApiKey) {
      throw new Error(
        'SYNTHETIC_LLM_API_KEY is required when using Synthetic provider',
      );
    }

    try {
      new URL(this.syntheticBaseUrl);
    } catch {
      throw new Error(
        `Invalid SYNTHETIC_BASE_URL_OPENAI: ${this.syntheticBaseUrl}. Must be a valid URL`,
      );
    }

    if (this.syntheticAnthropicBaseUrl) {
      try {
        new URL(this.syntheticAnthropicBaseUrl);
      } catch {
        throw new Error(
          `Invalid SYNTHETIC_BASE_URL_ANTHROPIC: ${this.syntheticAnthropicBaseUrl}. Must be a valid URL`,
        );
      }
    }
  }

  /**
   * Validate classifier configuration when used
   * @private
   */
  private validateClassifierConfig(): void {
    if (!this.classificationClientService.isEnabled()) {
      throw new Error(
        'Classifier provider requested but LOCAL_CLASSIFIER_ENABLED is false or not set',
      );
    }
  }

  /**
   * Validate local LLM configuration when enabled
   * @private
   */
  private validateLocalLLMConfig(): void {
    if (!this.localUrl) {
      throw new Error('LLM_LOCAL_URL is required when using local provider');
    }

    if (!this.localModel) {
      throw new Error('LLM_LOCAL_MODEL is required when using local provider');
    }

    try {
      new URL(this.localUrl);
    } catch {
      throw new Error(
        `Invalid LLM_LOCAL_URL: ${this.localUrl}. Must be a valid URL (e.g., http://localhost:11434)`,
      );
    }

    if (this.localTimeout < 1000 || this.localTimeout > 600000) {
      throw new Error(
        'LLM_LOCAL_TIMEOUT must be between 1000ms and 600000ms (1 second to 10 minutes)',
      );
    }
  }

  /**
   * Model selection helpers
   */
  static calculateCost(
    model: LLMModel,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens?: number,
  ): LLMCostData {
    const tier = ALL_MODEL_TIERS[model];
    const inputCost = (inputTokens / 1_000_000) * tier.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * tier.outputCostPer1M;
    const cachedInputCost =
      cachedInputTokens && tier.cachedInputCostPer1M
        ? (cachedInputTokens / 1_000_000) * tier.cachedInputCostPer1M
        : 0;

    return {
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputCost: inputCost + cachedInputCost,
      outputCost,
      totalCost: inputCost + outputCost + cachedInputCost,
    };
  }

  private resolveCostData(
    model: string | undefined,
    usage: LLMResponse['usage'] | undefined,
    costData: LLMCostData | undefined,
  ): LLMCostData | undefined {
    if (costData) {
      return costData;
    }

    if (!model || !usage) {
      return undefined;
    }

    const tier = ALL_MODEL_TIERS[model as LLMModel];
    if (!tier) {
      return undefined;
    }

    return LLMClientService.calculateCost(
      model as LLMModel,
      usage.promptTokens,
      usage.completionTokens,
    );
  }

  /**
   * Select model based on criteria - handles complex requirements
   */
  static selectModelByCriteria(criteria: ModelSelectionCriteria): LLMModel {
    const provider = criteria.provider;
    if (!provider) {
      throw new Error('provider is required for model selection');
    }
    if (provider === LLMProviderName.LOCAL) {
      throw new Error('local provider does not support model selection');
    }
    if (provider === LLMProviderName.SYNTHETIC) {
      throw new Error(
        'Synthetic provider requires explicit model selection via options.model or SYNTHETIC_MODEL',
      );
    }

    const candidates: ModelTier[] =
      provider === LLMProviderName.CLAUDE
        ? Object.values(CLAUDE_MODEL_TIERS)
        : Object.values(OPENAI_MODEL_TIERS);

    const resolveTierModel = (): LLMModel => {
      if (provider === LLMProviderName.CLAUDE) {
        if (criteria.openaiTier) {
          throw new Error('openaiTier is not valid for Claude provider');
        }
        if (criteria.anthropicTier) {
          return ANTHROPIC_TIER_MODELS[criteria.anthropicTier];
        }
        throw new Error('anthropicTier is required for Claude provider');
      }

      if (criteria.anthropicTier) {
        throw new Error('anthropicTier is not valid for OpenAI provider');
      }
      if (criteria.openaiTier) {
        return OPENAI_TIER_MODELS[criteria.openaiTier];
      }
      throw new Error('openaiTier is required for OpenAI provider');
    };

    const selectedModel = criteria.model ?? resolveTierModel();
    const selectedTier = candidates.find(
      (tier) => tier.model === selectedModel,
    );
    if (!selectedTier) {
      throw new Error(`Model "${selectedModel}" does not match provider`);
    }

    if (criteria.model) {
      if (provider === LLMProviderName.CLAUDE && criteria.anthropicTier) {
        const expected = ANTHROPIC_TIER_MODELS[criteria.anthropicTier];
        if (selectedModel !== expected) {
          throw new Error(
            `Model "${selectedModel}" does not match anthropicTier "${criteria.anthropicTier}"`,
          );
        }
      }
      if (provider === LLMProviderName.OPENAI && criteria.openaiTier) {
        const expected = OPENAI_TIER_MODELS[criteria.openaiTier];
        if (selectedModel !== expected) {
          throw new Error(
            `Model "${selectedModel}" does not match openaiTier "${criteria.openaiTier}"`,
          );
        }
      }
    }

    const requiredFeatures = criteria.requiresFeatures ?? [];
    if (
      requiredFeatures.length > 0 &&
      !requiredFeatures.every((feature) =>
        selectedTier.specialFeatures?.includes(feature),
      )
    ) {
      throw new Error('Selected model does not satisfy requiresFeatures');
    }

    if (
      criteria.maxInputCostPer1M !== undefined &&
      selectedTier.inputCostPer1M > criteria.maxInputCostPer1M
    ) {
      throw new Error('Selected model exceeds maxInputCostPer1M');
    }
    if (
      criteria.maxOutputCostPer1M !== undefined &&
      selectedTier.outputCostPer1M > criteria.maxOutputCostPer1M
    ) {
      throw new Error('Selected model exceeds maxOutputCostPer1M');
    }

    return selectedModel;
  }

  /**
   * Unified LLM call method for structured data - replaces callLLM() and processClaudeLlmAnalysisRequest()
   * Includes "hey hey" mocking logic and Claude 4 model support
   */
  @WithWorkflowContext((...args) => {
    const [_prompt, options, source] = args as [
      string,
      LLMCallOptions,
      {
        workflowId?: WorkflowId;
        nodeId?: string;
        nodeType?: string;
        requestId?: string;
      },
    ];
    return {
      sourceService: 'LLMClientService',
      sourceMethod: 'callStructured',
      context: {
        workflowId: source.workflowId,
      },
      metadata: {
        nodeId: source.nodeId,
        operationType: 'llmCall',
        nodeType: source.nodeType,
        requestId: source.requestId,
        hasResponseSchema: !!options.responseSchema,
        taskType: options.taskType,
        model: options.model,
      },
    };
  })
  @WithEventContext('LLMClientService')
  async callStructured<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    source: {
      organizationId: OrganizationId;
      workflowId?: WorkflowId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
      nodeId: string;
      nodeType?: string;
      requestId?: string;
      mockLlmSessionId?: MockLlmSessionId;
    },
  ): Promise<LLMResponse<T>> {
    if (!options || !options.responseSchema) {
      throw new Error('responseSchema is required for structured LLM calls');
    }

    // Enrich context with LLM call metadata for debugging and cost tracking
    const llmCallStartTime = Date.now();
    const nodeId = source.nodeId;
    let iteration = 1;
    const intervalId = setInterval(() => {
      this.logger.debug(
        `[callStructured] waiting on llm response ${iteration * 3000}ms`,
        {
          nodeId,
        },
      );
      iteration++;
    }, 3000);

    // Add this service to the service call chain for tracing
    addToServiceChain('LLMClientService');

    this.logger.log(
      `[LLM-DEBUG] callStructured method called with nodeId: ${nodeId}, NODE_ENV: ${process.env.NODE_ENV}`,
      source,
    );
    const startTime = Date.now();
    const timeoutMs = options.timeout || this.timeout;

    // Declare variables before try block so they're accessible in catch
    let selectedModel: string | undefined;
    let targetProvider: LLMProviderName = this.provider;
    let trackingRecordId: string | undefined;

    try {
      // Determine provider preference before selecting a model so we can align the
      // default model choice with the actual provider that will service the request.
      const explicitModel = options.modelCriteria?.model || options.model;
      const inferredProvider = this.inferProviderFromModel(explicitModel);
      const preferredProvider =
        options.modelCriteria?.provider ?? this.provider;

      if (
        inferredProvider &&
        preferredProvider &&
        inferredProvider !== preferredProvider
      ) {
        const message =
          'Model/provider mismatch; model implies different provider';
        const requestedProviderExplicit =
          options.modelCriteria?.provider !== undefined;

        const logPayload = {
          nodeId,
          explicitModel,
          preferredProvider,
          inferredProvider,
          requestedProviderExplicit,
        };

        if (requestedProviderExplicit) {
          this.logger.error(message, logPayload);
          throw new Error(
            `${message}. Model "${explicitModel}" -> ${inferredProvider}, requested provider -> ${preferredProvider}`,
          );
        }

        // If the provider came from default config (not explicitly requested),
        // prefer the model-implied provider but keep the signal in logs.
        this.logger.warn(message, logPayload);
      }

      const requestedProvider = inferredProvider ?? preferredProvider;

      const structuredProvider = this.resolveStructuredProvider(
        requestedProvider,
        options.taskType,
      );

      targetProvider = this.resolveProviderAvailability(structuredProvider, {
        workflowId: source.workflowId,
        nodeId,
      });

      // LLM model selection for external APIs
      // Use default criteria if none provided
      const defaultCriteria: ModelSelectionCriteria =
        targetProvider === LLMProviderName.OPENAI
          ? { provider: targetProvider, openaiTier: 'mini' }
          : targetProvider === LLMProviderName.CLAUDE
            ? { provider: targetProvider, anthropicTier: 'haiku' }
            : { provider: targetProvider };

      const criteriaWithProvider = {
        ...defaultCriteria,
        ...options.modelCriteria,
        // Ensure we select the model based on the actual provider that will
        // handle the request so fallbacks stay consistent.
        provider: targetProvider,
      };

      // Debug logging to track provider selection
      this.logger.debug('[callStructured] Provider selection debug', {
        nodeId,
        serviceDefaultProvider: this.provider,
        nodeModelCriteriaProvider: options.modelCriteria?.provider,
        requestedProvider,
        structuredProvider,
        finalProvider: targetProvider,
        hasResponseSchema: !!options.responseSchema,
      });

      // Model selection based on provider and configuration
      selectedModel = options.modelCriteria?.model || options.model;
      if (!selectedModel) {
        if (this.localEnabled && targetProvider === LLMProviderName.LOCAL) {
          // Use local model name directly (e.g., "qwen3:30b", "llama3.2:3b")
          selectedModel = this.localModel;
        } else if (targetProvider === LLMProviderName.SYNTHETIC) {
          selectedModel = this.syntheticModel;
        } else {
          const llmModel =
            LLMClientService.selectModelByCriteria(criteriaWithProvider);
          selectedModel = llmModel as string;
        }
      }

      // Now we can enrich context with the selected model
      enrichEventContext({
        nodeId,
        promptLength: prompt.length,
        llmCallStartTime,
        llmModel: selectedModel,
      });

      // Convert to legacy request format for existing methods
      const request: LLMRequest = {
        prompt,
        model: selectedModel,
        temperature: options.temperature,
        topP: options.topP,
        reasoningEffort: options.reasoningEffort,
        responseFormat: options.responseFormat,
        maxTokens: options.maxTokens,
        stream: options.stream,
        timeout: timeoutMs,
      };

      await this.llmTrackingService
        .recordPromptStart({
          requestId: source.requestId,
          organizationId: source.organizationId,
          projectId: source.projectId,
          conversationId: source.conversationId,
          workflowId: source.workflowId,
          userId: source.userId,
          nodeId: source.nodeId,
          nodeType: source.nodeType,
          provider: targetProvider,
          model: selectedModel || 'unknown',
          taskType: options.taskType,
          toolName: options.toolName,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          stream: options.stream || false,
          prompt,
          responseSchema: options.responseSchema
            ? JSON.parse(JSON.stringify(options.responseSchema))
            : undefined,
        })
        .then((id) => {
          trackingRecordId = id;
          this.logger.log('[callStructured] recorded prompt start', {
            nodeId,
            workflowId: source.workflowId,
            requestId: source.requestId,
            trackingRecordId: id,
            provider: targetProvider,
            model: selectedModel,
          });
        })
        .catch((trackingError) => {
          this.logger.error('Failed to record LLM prompt start to database', {
            nodeId,
            workflowId: source.workflowId,
            requestId: source.requestId,
            provider: targetProvider,
            model: selectedModel,
            error:
              trackingError instanceof Error
                ? trackingError.message
                : errorToLoggable(trackingError),
          });
        });

      let response: LLMResponse<T>;
      if (options.stream) {
        response = await this.streamWithResponseSchema<T>(
          request,
          options,
          {
            ...source,
            nodeId,
          },
          targetProvider,
        );
      } else {
        response = await this.callWithResponseSchema<T>(
          options,
          targetProvider,
          nodeId,
          prompt,
          source,
          selectedModel,
        );
      }

      const duration = Date.now() - startTime;
      this.logger.log('[callStructured] provider response received', {
        nodeId,
        workflowId: source.workflowId,
        requestId: source.requestId,
        provider: targetProvider,
        model: selectedModel,
        durationMs: duration,
        responseRequestId: response.requestId,
        hasUsage: !!response.usage,
        totalTokens: response.usage?.totalTokens,
      });

      if (trackingRecordId) {
        await this.llmTrackingService
          .finalizePromptResponse(trackingRecordId, {
            requestId: response.requestId ?? source.requestId,
            responseContent: JSON.stringify(response.content),
            promptTokens: response.usage?.promptTokens,
            completionTokens: response.usage?.completionTokens,
            totalTokens: response.usage?.totalTokens,
            inputCost: response.costData?.inputCost,
            outputCost: response.costData?.outputCost,
            totalCost: response.costData?.totalCost,
            durationMs: duration,
            success: true,
            metadata: {
              costData: response.costData,
            },
          })
          .then(() => {
            this.logger.log(
              '[callStructured] finalized prompt response tracking',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                trackingRecordId,
                status: 'SUCCEEDED',
                durationMs: duration,
              },
            );
          })
          .catch((trackingError) => {
            this.logger.error(
              'Failed to finalize LLM prompt/response tracking in database',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                trackingRecordId,
                status: 'SUCCEEDED',
                error:
                  trackingError instanceof Error
                    ? trackingError.message
                    : errorToLoggable(trackingError),
              },
            );
          });
      } else {
        await this.llmTrackingService
          .recordPromptResponse({
            requestId: response.requestId ?? source.requestId,
            organizationId: source.organizationId,
            projectId: source.projectId,
            conversationId: source.conversationId,
            workflowId: source.workflowId,
            userId: source.userId,
            nodeId: source.nodeId,
            nodeType: source.nodeType,
            provider: targetProvider,
            model: selectedModel || 'unknown',
            taskType: options.taskType,
            toolName: options.toolName,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: options.stream || false,
            prompt,
            responseContent: JSON.stringify(response.content),
            responseSchema: options.responseSchema
              ? JSON.parse(JSON.stringify(options.responseSchema))
              : undefined,
            promptTokens: response.usage?.promptTokens,
            completionTokens: response.usage?.completionTokens,
            totalTokens: response.usage?.totalTokens,
            inputCost: response.costData?.inputCost,
            outputCost: response.costData?.outputCost,
            totalCost: response.costData?.totalCost,
            durationMs: duration,
            success: true,
            metadata: {
              costData: response.costData,
            },
          })
          .then((id) => {
            this.logger.log(
              '[callStructured] inserted fallback prompt response tracking',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                fallbackTrackingRecordId: id,
                status: 'SUCCEEDED',
                durationMs: duration,
              },
            );
          })
          .catch((fallbackTrackingError) => {
            this.logger.error(
              'Failed to insert fallback LLM prompt/response tracking in database',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                status: 'SUCCEEDED',
                error:
                  fallbackTrackingError instanceof Error
                    ? fallbackTrackingError.message
                    : errorToLoggable(fallbackTrackingError),
              },
            );
          });
      }

      trackProcessingTime('llmCall', llmCallStartTime);
      enrichEventContext({
        llmStatus: 'success',
        llmTokensUsed: response.usage?.totalTokens || 0,
      });
      this.logger.log('[callStructured] completed successfully', {
        nodeId,
        workflowId: source.workflowId,
        requestId: source.requestId,
        provider: targetProvider,
        model: selectedModel,
        durationMs: duration,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`LLM call failed after ${duration}ms`, {
        nodeId,
        workflowId: source.workflowId,
        requestId: source.requestId,
        provider: targetProvider,
        model: selectedModel,
        error: error instanceof Error ? error.message : errorToLoggable(error),
      });

      let responseContentForTracking = '';
      let metadata: Record<string, unknown> | undefined;
      let requestId = source.requestId;
      let errorType: string | undefined =
        error instanceof LLMApiError ? error.statusCode.toString() : 'unknown';
      let costData: LLMCostData | undefined;
      let usage: LLMResponse['usage'] | undefined;

      const structuredValidationError =
        error instanceof StructuredStreamValidationError
          ? error
          : hasStructuredValidationTrackingContext(error)
            ? error
            : undefined;

      if (structuredValidationError) {
        responseContentForTracking =
          structuredValidationError.responseContent ?? '';
        requestId = structuredValidationError.requestId ?? requestId;
        if (structuredValidationError.validationErrors?.length) {
          metadata = {
            validationErrors: structuredValidationError.validationErrors,
          };
          errorType = 'VALIDATION_ERROR';
        } else {
          errorType = 'PARSE_ERROR';
        }
        usage = structuredValidationError.usage;
        costData = this.resolveCostData(
          selectedModel,
          usage,
          structuredValidationError.costData,
        );
      }

      if (trackingRecordId) {
        await this.llmTrackingService
          .finalizePromptResponse(trackingRecordId, {
            requestId,
            responseContent: responseContentForTracking,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            inputCost: costData?.inputCost,
            outputCost: costData?.outputCost,
            totalCost: costData?.totalCost,
            durationMs: duration,
            success: false,
            metadata,
            errorMessage:
              error instanceof Error ? error.message : errorToLoggable(error),
            errorType,
          })
          .then(() => {
            this.logger.log(
              '[callStructured] finalized prompt response tracking',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                trackingRecordId,
                status: 'FAILED',
                durationMs: duration,
                errorType,
              },
            );
          })
          .catch((trackingError) => {
            this.logger.error(
              'Failed to finalize LLM error tracking in database',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                trackingRecordId,
                status: 'FAILED',
                error:
                  trackingError instanceof Error
                    ? trackingError.message
                    : errorToLoggable(trackingError),
              },
            );
          });
      } else {
        await this.llmTrackingService
          .recordPromptResponse({
            requestId,
            organizationId: source.organizationId,
            projectId: source.projectId,
            conversationId: source.conversationId,
            workflowId: source.workflowId,
            userId: source.userId,
            nodeId: source.nodeId,
            nodeType: source.nodeType,
            provider: targetProvider,
            model: selectedModel || 'unknown',
            taskType: options.taskType,
            toolName: options.toolName,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: options.stream || false,
            prompt,
            responseContent: responseContentForTracking,
            responseSchema: options.responseSchema
              ? JSON.parse(JSON.stringify(options.responseSchema))
              : undefined,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            inputCost: costData?.inputCost,
            outputCost: costData?.outputCost,
            totalCost: costData?.totalCost,
            durationMs: duration,
            success: false,
            metadata,
            errorMessage:
              error instanceof Error ? error.message : errorToLoggable(error),
            errorType,
          })
          .then((id) => {
            this.logger.log(
              '[callStructured] inserted fallback prompt response tracking',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                fallbackTrackingRecordId: id,
                status: 'FAILED',
                durationMs: duration,
                errorType,
              },
            );
          })
          .catch((fallbackTrackingError) => {
            this.logger.error(
              'Failed to insert fallback LLM error tracking in database',
              {
                nodeId,
                workflowId: source.workflowId,
                requestId: source.requestId,
                status: 'FAILED',
                error:
                  fallbackTrackingError instanceof Error
                    ? fallbackTrackingError.message
                    : errorToLoggable(fallbackTrackingError),
              },
            );
          });
      }

      throw error;
    } finally {
      clearInterval(intervalId);
    }
  }

  private async callWithResponseSchema<T extends object>(
    options: LLMCallOptions,
    targetProvider: LLMProviderName,
    nodeId: string | undefined,
    prompt: string,
    source: {
      workflowId?: WorkflowId;
      organizationId: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
      nodeId?: string;
      nodeType?: string;
      requestId?: string;
      mockLlmSessionId?: MockLlmSessionId;
    },
    selectedModel: string | undefined,
  ) {
    this.logger.debug('Using structured output provider', {
      nodeId,
      toolName: options.toolName,
      taskType: options.taskType,
      selectedProvider: targetProvider,
      allowFallback: options.allowFallback !== false,
    });

    const provider = this.requireProvider(targetProvider);
    const optionsWithModel = selectedModel
      ? { ...options, model: selectedModel }
      : options;
    const providerContext = {
      ...source,
      nodeId,
      mockLlmSessionId:
        source.mockLlmSessionId &&
        this.shouldForwardMockLlmSession(targetProvider)
          ? source.mockLlmSessionId
          : undefined,
    };
    const structuredResponse = await provider.callStructured<T>(
      prompt,
      optionsWithModel,
      providerContext,
    );

    const resolvedModel =
      selectedModel || options.model || structuredResponse.costData?.model;
    const resolvedCostData = this.resolveCostData(
      resolvedModel,
      structuredResponse.usage,
      structuredResponse.costData,
    );

    const resolvedResponse = {
      ...structuredResponse,
      costData: resolvedCostData,
    };

    return resolvedResponse;
  }

  private shouldForwardMockLlmSession(provider: LLMProviderName): boolean {
    return providerTargetsMockLlmServer(provider, {
      NODE_ENV: this.configService.get<string>(
        'NODE_ENV',
        process.env.NODE_ENV ?? 'development',
      ),
      MOCK_LLM_SESSION_ROUTING_ENABLED: this.configService.get<string>(
        'MOCK_LLM_SESSION_ROUTING_ENABLED',
        'false',
      ),
      MOCK_LLM_SERVER_URL: this.configService.get<string>(
        'MOCK_LLM_SERVER_URL',
        '',
      ),
      ANTHROPIC_BASE_URL: this.anthropicBaseUrl,
      OPENAI_BASE_URL: this.openaiBaseUrl,
    });
  }

  private async streamWithResponseSchema<T extends object>(
    request: LLMRequest,
    options: LLMCallOptions,
    source: {
      workflowId?: WorkflowId;
      organizationId: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
      nodeId?: string;
      nodeType?: string;
      requestId?: string;
    },
    targetProvider: LLMProviderName,
  ): Promise<LLMResponse<T>> {
    this.logger.debug('Streaming structured response', {
      nodeId: source.nodeId,
      selectedProvider: targetProvider,
    });

    const fieldValidators = createSchemaFieldValidators(options.responseSchema);

    const streamingHandler = (snapshot: IntermediateSystemMessageData) => {
      const validatedSnapshot: MutableIntermediateSystemMessageData = {};
      let hasValidData = false;

      for (const field of Object.keys(snapshot)) {
        const value = (snapshot as Record<string, unknown>)[field];

        const validator = fieldValidators[field];
        if (!validator) {
          this.logger.debug(
            'Skipping structured stream field with no validator',
            {
              field,
            },
          );
          continue;
        }

        if (validator.isArray && Array.isArray(value)) {
          // For array fields, validate each item individually
          const validItems: unknown[] = [];

          for (const item of value) {
            try {
              if (validator.validateItem) {
                validator.validateItem(item);
                validItems.push(item);
              } else {
                // No item validator, include all items
                validItems.push(item);
              }
            } catch (error) {
              // Stop processing this array when we hit an invalid item
              this.logger.debug('Stopping array validation at invalid item', {
                field,
                validItemCount: validItems.length,
                totalItemCount: value.length,
                error: errorToLoggable(error),
              });
              break;
            }
          }

          // Include the array if we have at least one valid item
          if (validItems.length > 0) {
            validatedSnapshot[field] = validItems;
            hasValidData = true;
          }
        } else {
          // For non-array fields, validate the value
          try {
            validator.validateValue(value);
            validatedSnapshot[field] = value;
            hasValidData = true;
          } catch (error) {
            this.logger.debug('Skipping invalid structured stream field', {
              field,
              value,
              error: errorToLoggable(error),
            });
          }
        }
      }

      // Only call onProgress if we have valid data to emit
      if (hasValidData && options.onProgress) {
        options.onProgress(ensureSystemMessageData(validatedSnapshot));
      }

      return hasValidData;
    };

    const provider = this.requireProvider(targetProvider);
    const streamingResponse = await provider.streamStructured(
      request,
      options,
      streamingHandler,
    );

    const resolvedCostData = this.resolveCostData(
      request.model,
      streamingResponse.usage,
      streamingResponse.costData,
    );

    let responseContent = streamingResponse.content;
    if (typeof responseContent === 'string') {
      const cleanedContent =
        JsonExtractionUtil.extractJSONFromResponse(responseContent);
      try {
        // Try to repair malformed JSON before parsing
        const repairedContent = jsonrepair(cleanedContent);
        responseContent = JSON.parse(
          repairedContent,
        ) as IntermediateSystemMessageData;
      } catch (error) {
        this.logger.warn('Failed to parse structured stream content JSON', {
          provider: targetProvider,
          cleanedContent,
          error: errorToLoggable(error),
        });
      }
    }

    const parseResult = options.responseSchema.safeParse(responseContent);

    if (!parseResult.success) {
      const serializedContent =
        typeof responseContent === 'string'
          ? responseContent
          : JSON.stringify(responseContent);

      this.logger.warn('Structured stream final payload validation failed', {
        provider: targetProvider,
        model: request.model,
        serializedContent,
        validationError: parseResult.error.message,
      });

      throw new StructuredStreamValidationError(
        `Structured stream final payload validation failed: ${parseResult.error.message}`,
        {
          responseContent: serializedContent,
          validationErrors: parseResult.error.issues,
          requestId: streamingResponse.requestId,
          costData: resolvedCostData,
          usage: streamingResponse.usage,
        },
      );
    }

    const structuredResponse: LLMResponse<T> = {
      ...streamingResponse,
      costData: resolvedCostData,
      content: parseResult.data as T,
    };

    return structuredResponse;
  }

  private resolveStructuredProvider(
    preferredProvider: LLMProviderName | undefined,
    taskType: TaskType | undefined,
  ): LLMProviderName {
    // When the caller explicitly chose a model we may have inferred the provider
    // from that model string above; in that case prefer the inferred provider.
    if (preferredProvider && this.providers.has(preferredProvider)) {
      return preferredProvider;
    }

    if (preferredProvider && !this.providers.has(preferredProvider)) {
      this.logger.warn('Requested structured provider is unavailable', {
        preferredProvider,
        configuredProviders: Array.from(this.providers.keys()),
      });
    }

    if (taskType) {
      if (
        taskType === TaskType.STRUCTURED_OUTPUT ||
        taskType === TaskType.AGENT_REASONING ||
        taskType === TaskType.ANALYSIS
      ) {
        if (this.providers.has(LLMProviderName.OPENAI)) {
          return LLMProviderName.OPENAI;
        }
        if (this.providers.has(LLMProviderName.SYNTHETIC)) {
          return LLMProviderName.SYNTHETIC;
        }
      } else if (
        taskType === TaskType.SIMPLE_TEXT ||
        taskType === TaskType.CONVERSATION
      ) {
        if (this.providers.has(LLMProviderName.CLAUDE)) {
          return LLMProviderName.CLAUDE;
        }
        if (this.providers.has(LLMProviderName.SYNTHETIC)) {
          return LLMProviderName.SYNTHETIC;
        }
      }
    }

    if (this.providers.has(this.provider)) {
      return this.provider;
    }

    if (this.providers.has(LLMProviderName.OPENAI)) {
      return LLMProviderName.OPENAI;
    }

    if (this.providers.has(LLMProviderName.CLAUDE)) {
      return LLMProviderName.CLAUDE;
    }

    if (this.providers.has(LLMProviderName.SYNTHETIC)) {
      return LLMProviderName.SYNTHETIC;
    }

    throw new Error('No structured LLM providers are configured');
  }

  private inferProviderFromModel(model?: string): LLMProviderName | undefined {
    if (!model) {
      return undefined;
    }

    if (Object.values(OpenAIModel).includes(model as OpenAIModel)) {
      return LLMProviderName.OPENAI;
    }

    if (Object.values(ClaudeModel).includes(model as ClaudeModel)) {
      return LLMProviderName.CLAUDE;
    }

    const normalized = model.toLowerCase();
    if (
      normalized.startsWith('gpt-') ||
      normalized.startsWith('o1') ||
      normalized.startsWith('o3')
    ) {
      return LLMProviderName.OPENAI;
    }

    if (normalized.startsWith('claude')) {
      return LLMProviderName.CLAUDE;
    }
    if (normalized.startsWith('hf:')) {
      return LLMProviderName.SYNTHETIC;
    }

    return undefined;
  }

  private resolveProviderAvailability(
    targetProvider: LLMProviderName,
    context: { workflowId?: WorkflowId; nodeId?: string },
  ): LLMProviderName {
    if (this.providers.has(targetProvider)) {
      return targetProvider;
    }

    this.logger.warn('Falling back due to unavailable structured provider', {
      requestedProvider: targetProvider,
      workflowId: context.workflowId,
      nodeId: context.nodeId,
      configuredProviders: Array.from(this.providers.keys()),
    });

    if (this.providers.has(this.provider)) {
      return this.provider;
    }

    if (this.providers.has(LLMProviderName.CLAUDE)) {
      return LLMProviderName.CLAUDE;
    }

    if (this.providers.has(LLMProviderName.OPENAI)) {
      return LLMProviderName.OPENAI;
    }

    if (this.providers.has(LLMProviderName.SYNTHETIC)) {
      return LLMProviderName.SYNTHETIC;
    }

    throw new Error('No available LLM providers to fulfill structured request');
  }

  private requireProvider(
    providerName: LLMProviderName,
  ): StructuredLLMProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`LLM provider ${providerName} is not configured`);
    }
    return provider;
  }

  getProvider(): LLMProviderName {
    return this.provider;
  }

  async checkHealth(): Promise<{
    provider: LLMProviderName;
    status: string;
    message: string;
  }> {
    if (!this.providers.has(this.provider)) {
      return {
        provider: this.provider,
        status: 'unconfigured',
        message: 'Configured provider is not registered',
      };
    }

    try {
      const provider = this.requireProvider(this.provider);
      if (provider.healthCheck) {
        const result = await provider.healthCheck();
        return {
          provider: provider.name,
          status: result.status,
          message: result.message || 'Health check completed',
        };
      }

      return {
        provider: this.provider,
        status: 'unknown',
        message: 'No provider health check implemented; assuming configured',
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      return { provider: this.provider, status: 'unhealthy', message };
    }
  }
}
