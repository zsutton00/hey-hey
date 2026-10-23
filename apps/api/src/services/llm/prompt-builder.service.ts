import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import {
  ArtifactResponseDto,
  ConversationResponseDto,
  InitiativeResponseDto,
  ProjectResponseDto,
} from 'src/generated';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import { ContextResolutionService } from '../../context/services/context-resolution.service';
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
import {
  AnalyzeNodeBase,
  ClassificationNodeBase,
  FlowContext,
  FlowUserMessage,
  GenerateNodeBase,
  isPromptConfigurableNode,
  LLMPrompt,
  LlmQuestionsNodeBase,
  MutableContextHandle,
  NodeBuildContext,
  NonInteractiveNodeBase,
  OpenerNodeBase,
  PromptConfig,
  TransitionDefinition,
} from '../../types/flow-internal.types';
import {
  PromptBuilderOptions,
  PromptBuilderStrategyType,
} from '../../types/prompt-builder-strategy.types';
import { ArtifactService } from '../artifacts/artifact.service';
import { DesignDocService } from '../design-doc/design-doc.service';
import { EntitySummaryService } from '../entity-summary/entity-summary.service';
import { SubfacetService } from '../entity-summary/subfacet.service';
import { InitiativeService } from '../initiatives/initiative.service';
import { TaskService } from '../tasks/task.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { MessageService } from '../message.service';
import { PlaceholderContext } from './placeholders/base/placeholder-types';
import { PlaceholderResolver } from './placeholders/resolver.service';
import { llmTemperatureParams } from './llm-shared';
import { sanitizePrompt } from './prompt-security.util';
import { InitiativeRefinementPromptBuilderStrategy } from './strategies/initiative-refinement-prompt-builder.strategy';
import { IPromptBuilderStrategy } from './strategies/prompt-builder-strategy.interface';
import { StandardPromptBuilderStrategy } from './strategies/standard-prompt-builder.strategy';

type PromptConfigurableNode<T extends FlowContext = FlowContext> =
  | LlmQuestionsNodeBase<T>
  | AnalyzeNodeBase<T>
  | GenerateNodeBase<T>
  | ClassificationNodeBase<T>
  | NonInteractiveNodeBase<T>
  | OpenerNodeBase<T>;

export type PromptContext = {
  artifacts?: ArtifactResponseDto[];
  workflowId?: WorkflowId;
  project?: ProjectResponseDto;
  projectId: ProjectId;
  organizationId: OrganizationId;
  conversation?: ConversationResponseDto;
  conversationId: ConversationId;
  workflowAboutId: string;
  workflowAboutType: string;
  user: {
    id: UserId;
    role: string;
  };
  initiative?: InitiativeResponseDto;
  initiativeId?: InitiativeId;
};

@Injectable()
export class PromptBuilderService {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(PromptBuilderService.name);

  constructor(
    private artifactService: ArtifactService,
    private initiativeService: InitiativeService,
    private standardStrategy: StandardPromptBuilderStrategy,
    private initiativeRefinementStrategy: InitiativeRefinementPromptBuilderStrategy,
    private placeholderResolver: PlaceholderResolver,
    private taskService: TaskService,
    private designDocService: DesignDocService,
    private readonly entitySummaryService: EntitySummaryService,
    private readonly subfacetService: SubfacetService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    private readonly entityRegistryService: EntityRegistryService,
    @Optional()
    private readonly contextResolutionService?: ContextResolutionService,
  ) {}

  /**
   * Get strategy instance with simple if/else logic
   * Checks node-specified strategy first, then options, then defaults to standard
   */
  private getStrategy(
    _context: FlowContext,
    options?: PromptBuilderOptions,
    nodeStrategy?: PromptBuilderStrategyType,
  ): IPromptBuilderStrategy {
    // Priority: 1. Node-specified strategy, 2. Options strategy, 3. Default standard
    const effectiveStrategy = nodeStrategy || options?.strategy;

    if (effectiveStrategy === PromptBuilderStrategyType.INITIATIVE_REFINEMENT) {
      this.logger.debug('Using initiative refinement strategy', {
        source: nodeStrategy ? 'node-specified' : 'options-specified',
      });
      return this.initiativeRefinementStrategy;
    }

    this.logger.debug('Using standard strategy (default)');
    return this.standardStrategy;
  }

  /**
   * Build template using new placeholder registry system
   */
  private async buildWithRegistry(
    template: string,
    strategy: IPromptBuilderStrategy,
    placeholderContext: PlaceholderContext,
  ): Promise<string> {
    // Check if strategy supports the new placeholder system
    if (!strategy.getPlaceholderRegistry) {
      this.logger.warn('Strategy does not support placeholder system', {
        strategy: strategy.getStrategyName(),
      });
      throw new Error('Strategy does not support placeholder system');
    }

    const registry = strategy.getPlaceholderRegistry();

    this.logger.debug('Using new placeholder registry system', {
      registry: registry.getName(),
      templateLength: template.length,
    });

    return await this.placeholderResolver.resolve(
      template,
      registry,
      placeholderContext,
      {
        enableCaching: true,
        cacheTtl: 30000, // 30 seconds
        throwOnMissing: true,
        defaultValue: '[PLACEHOLDER_MISSING]',
      },
    );
  }

  @WithWorkflowContext((...args) => {
    const [node, context] = args as [
      PromptConfigurableNode,
      FlowContext | PromptContext,
    ];
    const hasFlowContext = 'flowId' in context;
    return {
      sourceService: 'PromptBuilderService',
      sourceMethod: 'buildPrompt',
      context: hasFlowContext
        ? context.core
        : {
            workflowId: context.workflowId,
            projectId: context.projectId,
            organizationId: context.organizationId,
            conversationId: context.conversationId,
          },
      workflowId: hasFlowContext ? context.core.workflowId : context.workflowId,
      nodeId: node.id,
      metadata: {
        operationType: 'promptBuild',
        nodeType: node.type,
        flowId: hasFlowContext ? context.flowId : undefined,
      },
    };
  })
  @WithEventContext('PromptBuilderService')
  async buildPrompt<T extends FlowContext = FlowContext>(
    node: PromptConfigurableNode<T>,
    tracker: MutableContextHandle<FlowContext>,
    userMessage?: FlowUserMessage,
    availableTransitions?: Record<string, TransitionDefinition>,
    options?: PromptBuilderOptions,
  ): Promise<LLMPrompt> {
    // Enrich context with prompt building metadata
    const promptBuildStartTime = Date.now();
    const context = tracker.getContext();

    enrichEventContext({
      nodeId: node.id,
      nodeType: node.type,
      promptBuildStartTime,
      hasUserMessage: !!userMessage,
      availableTransitionsCount: availableTransitions
        ? Object.keys(availableTransitions).length
        : 0,
      flowId: context.flowId,
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('PromptBuilderService');

    if (!isPromptConfigurableNode(node) || !node.promptConfig) {
      throw new Error(`Node ${node.id} does not have prompt configuration`);
    }

    this.logger.debug(`[buildPrompt] starting...`, {
      nodeId: node.id,
      context,
      userMessage,
    });

    const promptConfig = node.promptConfig as PromptConfig<FlowContext>;

    // Get strategy for this build operation (check node-specified strategy first)
    const nodeStrategy =
      'promptConfig' in node && node.promptConfig
        ? node.promptConfig.promptStrategy
        : undefined;
    const strategy = this.getStrategy(context, options, nodeStrategy);

    // Note: buildContext is only available on AGENT nodes, which don't use buildPrompt
    // AGENT nodes use a different prompt building path through the agent pipeline
    // This method only processes CLASSIFICATION, ANALYZE, and GENERATE nodes (isLLMNode check above)
    const customContext: NodeBuildContext = {};

    // Build system prompt using strategy delegation
    let systemPrompt = '';

    // 2. Build template using placeholder system
    if (promptConfig.systemPromptTemplate) {
      // Use placeholder registry system
      if (!strategy.getPlaceholderRegistry) {
        throw new Error(
          `Strategy ${strategy.getStrategyName()} does not support placeholder system`,
        );
      }

      // Create placeholder context for new system
      const placeholderContext: PlaceholderContext = {
        flowContext: context,
        userMessage,
        nodeBuildContext: customContext,
        services: {
          initiativeService: this.initiativeService,
          artifactService: this.artifactService,
          taskService: this.taskService,
          designDocService: this.designDocService,
          messageService: this.messageService,
          entityRegistryService: this.entityRegistryService,
          contextResolutionService: this.contextResolutionService,
          entitySummaryService: this.entitySummaryService,
          subfacetService: this.subfacetService,
        },
        options: {},
      };

      this.logger.debug('Using placeholder system for template resolution', {
        nodeId: node.id,
        templateLength: promptConfig.systemPromptTemplate.length,
        strategy: strategy.getStrategyName(),
      });

      const systemPromptTemplate =
        typeof promptConfig.systemPromptTemplate === 'string'
          ? promptConfig.systemPromptTemplate
          : promptConfig.systemPromptTemplate(context, userMessage);

      const substitutedTemplate = await this.buildWithRegistry(
        systemPromptTemplate,
        strategy,
        placeholderContext,
      );

      systemPrompt += substitutedTemplate;
    }

    // 3. Build instructions section using strategy
    systemPrompt += await strategy.buildInstructionsSection(
      node,
      promptConfig,
      availableTransitions,
    );

    // 4. Build response format section using strategy
    if (promptConfig.responseSchema) {
      systemPrompt += await strategy.buildResponseFormatSection(
        promptConfig.responseSchema,
        node.type,
        promptConfig.exampleResponse,
      );
    }

    // No user prompt needed - conversation history provides all context
    const userPrompt = '';

    // Sanitize prompts to prevent injection
    const sanitizedSystemPrompt = sanitizePrompt(systemPrompt);
    const sanitizedUserPrompt = sanitizePrompt(userPrompt);

    const promptData: LLMPrompt = {
      systemPrompt: sanitizedSystemPrompt,
      userPrompt: sanitizedUserPrompt,
      fullPrompt: `${sanitizedSystemPrompt}${sanitizedUserPrompt ? `\n\nHuman: ${sanitizedUserPrompt}` : ''}`,
      responseSchema: promptConfig.responseSchema
        ? strategy.zodToJsonSchema(promptConfig.responseSchema)
        : undefined,
      ...llmTemperatureParams(
        promptConfig.modelCriteria?.model,
        promptConfig.temperature,
      ),
      responseFormat: strategy.isScalarSchemaCheck(promptConfig.responseSchema)
        ? 'text'
        : 'json_object',
    };

    this.logger.log(`[buildPrompt] Generated prompt for node ${node.id}`, {
      conversationId:
        'conversationId' in context ? context.conversationId : undefined,
      flowId: context.flowId,
      workflowId: context.core.workflowId,
      strategy: strategy.getStrategyName(),
    });

    // Track prompt building completion time and enrich context with results
    trackProcessingTime('promptBuild', promptBuildStartTime);
    enrichEventContext({
      promptLength: promptData.fullPrompt.length,
      hasResponseSchema: !!promptConfig.responseSchema,
      ...llmTemperatureParams(
        promptConfig.modelCriteria?.model,
        promptConfig.temperature,
      ),
    });

    return promptData;
  }

  async buildAgentPrompts(
    flowContext: FlowContext,
    userPromptTemplate: string,
    userMessage?: FlowUserMessage,
  ): Promise<{ systemPrompt?: string; userPrompt?: string }> {
    const promptContext: PromptContext = {
      projectId: flowContext.core.projectId,
      organizationId: flowContext.core.organizationId,
      conversationId: flowContext.core.conversationId,
      workflowId: flowContext.core.workflowId,
      workflowAboutId: flowContext.core.workflowAboutId,
      workflowAboutType: flowContext.core.workflowAboutType,
      user: flowContext.core.user,
    };

    if ('initiativeId' in flowContext) {
      promptContext.initiativeId = flowContext.initiativeId as InitiativeId;
    }

    const shouldUseInitiativeStrategy =
      'initiativeId' in flowContext && flowContext.initiativeId;

    const strategy = this.getStrategy(
      flowContext,
      shouldUseInitiativeStrategy
        ? { strategy: PromptBuilderStrategyType.INITIATIVE_REFINEMENT }
        : undefined,
    );

    if (!strategy.getPlaceholderRegistry) {
      this.logger.warn(
        'Selected strategy does not support placeholder registry',
        {
          strategy: strategy.getStrategyName(),
        },
      );

      return {
        userPrompt: userPromptTemplate
          ? sanitizePrompt(userPromptTemplate)
          : undefined,
      };
    }

    const placeholderContext: PlaceholderContext = {
      flowContext,
      userMessage,
      nodeBuildContext: {},
      services: {
        initiativeService: this.initiativeService,
        artifactService: this.artifactService,
        taskService: this.taskService,
        designDocService: this.designDocService,
        messageService: this.messageService,
        entityRegistryService: this.entityRegistryService,
        contextResolutionService: this.contextResolutionService,
      },
      options: {},
    };

    let resolvedUserPrompt: string | undefined;
    if (userPromptTemplate) {
      try {
        resolvedUserPrompt = await this.buildWithRegistry(
          userPromptTemplate,
          strategy,
          placeholderContext,
        );
      } catch (error) {
        this.logger.error('Failed to resolve user prompt template for agent', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        resolvedUserPrompt = userPromptTemplate;
      }
    }

    return {
      userPrompt: resolvedUserPrompt
        ? sanitizePrompt(resolvedUserPrompt)
        : undefined,
    };
  }

  /**
   * Build a routing prompt for LLM-based transition selection
   * Delegates to the appropriate strategy based on context
   *
   * @param transitions - Available transitions with descriptions
   * @param context - Current flow context
   * @param nodeContext - Optional node-specific guidance
   * @param options - Optional strategy selection options
   * @returns Routing prompt string
   */
  async buildRoutingPrompt(
    transitions: Record<string, TransitionDefinition>,
    context: FlowContext,
    nodeContext?: string,
    options?: PromptBuilderOptions,
  ): Promise<string> {
    const strategy = this.getStrategy(context, options);
    return strategy.buildRoutingPrompt(transitions, context, nodeContext);
  }
}
