import { Injectable, Logger } from '@nestjs/common';
import { ContextResolutionService } from '../../context/services/context-resolution.service';
import { ConversationId, InitiativeId, OrganizationId } from '../../types';
import { FlowUserMessage } from '../../types/flow-internal.types';
import { LLMClientService } from '../llm/llm-client.service';
import { OpenAIModel } from '../llm/llm-shared';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import {
  messageClassificationSchema,
  safeValidateMessageClassification,
} from './types/classification.schemas';
import {
  ClassificationConfig,
  ConversationContext,
  DEFAULT_CLASSIFICATION_CONFIG,
  InitiativeContextResult,
  MessageClassificationResult,
  MessageIntent,
  WorkflowSignalPayload,
} from './types/classification.types';

/**
 * Service for classifying user messages and determining initiative refinement intent
 *
 * This service uses LLM-based analysis to:
 * 1. Classify raw user messages by intent (feedback, content updates, reviews, etc.)
 * 2. Extract initiative context and relevance
 * 3. Generate appropriate workflow signal payloads for routing
 * 4. Maintain security boundaries and organization isolation
 */
@Injectable()
export class MessageClassificationService {
  private readonly logger = new Logger(MessageClassificationService.name);
  private readonly config: ClassificationConfig;

  constructor(
    private readonly llmClientService: LLMClientService,
    private readonly promptBuilderService: PromptBuilderService,
    private readonly contextResolutionService: ContextResolutionService,
  ) {
    // Load configuration from environment or use defaults
    this.config = {
      ...DEFAULT_CLASSIFICATION_CONFIG,
      confidenceThreshold: parseFloat(
        process.env.MESSAGE_CLASSIFICATION_CONFIDENCE_THRESHOLD || '0.7',
      ),
      autoRoutingEnabled:
        process.env.MESSAGE_CLASSIFICATION_AUTO_ROUTING !== 'false',
      maxMessageLength: parseInt(
        process.env.MESSAGE_CLASSIFICATION_MAX_LENGTH || '2000',
      ),
      model:
        process.env.MESSAGE_CLASSIFICATION_MODEL || 'claude-3-5-haiku-20241022',
      temperature: parseFloat(
        process.env.MESSAGE_CLASSIFICATION_TEMPERATURE || '0.1',
      ),
    };

    this.logger.log('MessageClassificationService initialized', {
      config: this.config,
    });
  }
  /**
   * Classify a user message with level-aware context for initiative refinement
   *
   * @param messageContent - The message content to classify
   * @param context - Conversation context for classification
   * @param currentLevel - Current initiative level for level-aware classification
   * @param organizationId - Organization identifier for security boundaries
   * @returns Level-aware classification result with refined routing intent
   */
  async classifyMessageWithLevel(
    messageContent: string,
    context: ConversationContext,
    currentLevel: 'description' | 'details' | 'acceptanceCriteria',
    organizationId: OrganizationId,
  ): Promise<MessageClassificationResult> {
    const startTime = Date.now();

    this.logger.debug('[classifyMessageWithLevel] starting', {
      messageContent: messageContent.substring(0, 200),
      currentLevel,
      organizationId,
    });

    try {
      // 1. Validate input
      if (!messageContent?.trim()) {
        throw new Error('Message content is required');
      }
      if (!context) {
        throw new Error('Context is required');
      }
      if (!currentLevel) {
        throw new Error('Current level is required');
      }
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      if (messageContent.length > this.config.maxMessageLength) {
        throw new Error(
          `Message exceeds maximum length of ${this.config.maxMessageLength} characters`,
        );
      }

      // 2. Build level-aware classification prompt
      const prompt = await this.buildLevelAwareClassificationPrompt(
        messageContent,
        context,
        currentLevel,
      );

      // 3. Call LLM with structured output
      const llmResponse =
        await this.llmClientService.callStructured<MessageClassificationResult>(
          prompt,
          {
            model: OpenAIModel.GPT_5_MINI,
            temperature: this.config.temperature,
            maxTokens: 1000,
            timeout: 30000,
            responseSchema: messageClassificationSchema,
          },
          {
            organizationId,
            nodeId: 'classifyMessageWithLevel',
            workflowId: context.workflowId,
            projectId: context.projectId,
            conversationId: context.conversationId,
          },
        );

      this.logger.debug('[classifyMessageWithLevel] response received', {
        llmResponse,
      });

      // 4. Validate and parse LLM response
      const validationResult = safeValidateMessageClassification(
        llmResponse.content,
      );
      if (!validationResult.success) {
        this.logger.warn('Level-aware LLM response validation failed', {
          currentLevel,
          error: validationResult.error,
          rawResponse: llmResponse.content,
        });

        throw new Error(
          `Level-aware message classification validation failed: ${validationResult.error}`,
        );
      }

      const rawClassification = validationResult.data;

      if (!rawClassification) {
        // this shouldn't happen due to validation but we'll appease the type checker anyways
        throw new Error(
          `Classification data missing for conversation ${context.conversationId}`,
        );
      }

      // 5. Convert to full MessageClassificationResult with level context
      const classification: MessageClassificationResult = {
        intent: rawClassification.intent,
        confidence: rawClassification.confidence,
        reasoning: rawClassification.reasoning,
        targetInitiativeId:
          rawClassification.targetInitiativeId as InitiativeId,
        targetLevel: rawClassification.targetLevel || currentLevel, // Default to current level
        suggestedAction: rawClassification.suggestedAction ?? undefined,
        metadata: {
          autoClassified: true,
          model: this.config.model,
          levelAware: true,
          currentLevel,
        },
      };

      // 6. Level-specific validation and confidence adjustment
      await this.validateLevelAwareClassification(
        classification,
        currentLevel,
        context,
      );

      this.logger.log('Message classified with level awareness', {
        intent: classification.intent,
        confidence: classification.confidence,
        currentLevel,
        targetLevel: classification.targetLevel,
        processingTimeMs: Date.now() - startTime,
        organizationId,
      });

      return classification;
    } catch (error) {
      // Don't catch validation errors - those should bubble up
      if (
        error instanceof Error &&
        (error.message.includes('is required') ||
          error.message.includes('exceeds maximum length'))
      ) {
        throw error;
      }

      this.logger.error('Level-aware message classification failed', {
        currentLevel,
        organizationId,
        error: error instanceof Error ? error.message : error,
        processingTimeMs: Date.now() - startTime,
      });

      throw new Error(
        `Level-aware message classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Extract initiative context from a message
   *
   * @param message - The message to analyze
   * @param conversationId - Conversation context
   * @returns Initiative context extraction result
   */
  async extractInitiativeContext(
    message: FlowUserMessage,
    conversationId: ConversationId,
  ): Promise<InitiativeContextResult> {
    try {
      // Extract all string values from message.data object
      const messageContent = this.extractAllStringValues(message.data);

      // Basic keyword-based initiative detection
      const hasInitiativeKeywords =
        this.containsInitiativeKeywords(messageContent);

      return {
        hasInitiativeContext: hasInitiativeKeywords,
        mentionedInitiativeIds: [], // Could be enhanced with entity extraction
        relevanceConfidence: hasInitiativeKeywords ? 0.6 : 0.1,
      };
    } catch (error) {
      this.logger.error('Initiative context extraction failed', {
        messageId: message.id,
        conversationId,
        error: error instanceof Error ? error.message : error,
      });

      return {
        hasInitiativeContext: false,
        mentionedInitiativeIds: [],
        relevanceConfidence: 0.0,
      };
    }
  }

  /**
   * Generate workflow signal payload from classification result
   *
   * @param classification - Classification result
   * @param message - Original message
   * @param context - Conversation context
   * @returns Workflow signal payload or null if not routable
   */
  async generateWorkflowSignal(
    classification: MessageClassificationResult,
    message: FlowUserMessage,
    context: ConversationContext,
  ): Promise<WorkflowSignalPayload | null> {
    try {
      // Only generate signals for high-confidence initiative-related messages
      if (
        classification.intent === MessageIntent.GENERAL ||
        classification.confidence < this.config.confidenceThreshold
      ) {
        return null;
      }

      const basePayload = {
        conversationId: context.conversationId,
        organizationId: context.organizationId,
        userId: context.userId,
        timestamp: new Date(),
        metadata: {
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          autoClassified: true,
        },
      };

      switch (classification.intent) {
        case MessageIntent.INITIATIVE_FEEDBACK:
          return {
            type: 'InitiativeRefinementFeedbackPayload',
            initiativeId: classification.targetInitiativeId,
            content: this.extractAllStringValues(message.data),
            ...basePayload,
          };

        case MessageIntent.CONTENT_UPDATE:
          return {
            type: 'InitiativeContentUpdatePayload',
            initiativeId: classification.targetInitiativeId,
            content: this.extractAllStringValues(message.data),
            ...basePayload,
          };

        case MessageIntent.REVIEW_REQUEST:
        case MessageIntent.APPROVAL:
        case MessageIntent.REJECTION:
          return {
            type: 'InitiativeReviewPayload',
            initiativeId: classification.targetInitiativeId,
            content: this.extractAllStringValues(message.data),
            ...basePayload,
            metadata: {
              ...basePayload.metadata,
              approved: classification.intent === MessageIntent.APPROVAL,
            },
          };

        default:
          return null;
      }
    } catch (error) {
      this.logger.error('Workflow signal generation failed', {
        messageId: message.id,
        intent: classification.intent,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Check if a message should be routed based on classification
   *
   * @param classification - Classification result
   * @returns Whether message should be routed to workflow
   */
  shouldRouteMessage(classification: MessageClassificationResult): boolean {
    return (
      this.config.autoRoutingEnabled &&
      classification.intent !== MessageIntent.GENERAL &&
      classification.confidence >= this.config.confidenceThreshold
    );
  }

  /**
   * Get current classification configuration
   */
  getConfig(): ClassificationConfig {
    return { ...this.config };
  }

  /**
   * Build level-aware classification prompt with initiative level context
   */
  private async buildLevelAwareClassificationPrompt(
    messageContent: string,
    context: ConversationContext,
    currentLevel: 'description' | 'details' | 'acceptanceCriteria',
  ): Promise<string> {
    try {
      // Get level-specific template
      const baseTemplate = this.getLevelSpecificTemplate(currentLevel);

      return 'no';
      // Use PromptBuilderService for proper template processing with level context
      // return await this.promptBuilderService.buildClassificationPrompt(
      //   messageContent,
      //   {
      //     conversationId: context.conversationId,
      //     organizationId: context.organizationId,
      //     projectId: context.projectId || '',
      //     availableInitiatives: context.availableInitiatives,
      //     currentLevel,
      //   },
      //   baseTemplate,
      // );
    } catch (error) {
      this.logger.error('Failed to build level-aware classification prompt', {
        currentLevel,
        error: error instanceof Error ? error.message : error,
      });
      throw new Error(
        `Level-aware prompt building failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get level-specific classification template
   */
  private getLevelSpecificTemplate(
    level: 'description' | 'details' | 'acceptanceCriteria',
  ): string {
    const templates = {
      description: this.getDescriptionLevelTemplate(),
      details: this.getDetailsLevelTemplate(),
      acceptanceCriteria: this.getAcceptanceCriteriaTemplate(),
    };
    return templates[level];
  }

  /**
   * Get classification template for description level initiatives
   */
  private getDescriptionLevelTemplate(): string {
    return `
You are classifying user messages for initiative refinement at the DESCRIPTION level.

At this level, focus on:
- High-level concept approval/rejection
- Major scope changes or clarifications  
- Basic priority adjustments
- General feedback on the initiative idea

Level-specific intents to classify:
- approve_level: User approves description and wants to move to detailed planning
- edit_content: User wants to modify the high-level description or scope
- general_response: General question or comment not requiring specific action

Consider the context that this initiative is at the description stage - users are reviewing the basic concept.
`;
  }

  /**
   * Get classification template for details level initiatives
   */
  private getDetailsLevelTemplate(): string {
    return `
You are classifying user messages for initiative refinement at the DETAILS level.

At this level, focus on:
- Technical implementation feedback
- Resource and timeline concerns
- Detailed requirement clarifications
- Implementation approach validation

Level-specific intents to classify:
- approve_level: User approves details and wants to move to acceptance criteria
- edit_content: User wants to modify technical details or implementation approach
- general_response: General question or comment not requiring specific action

Consider the context that this initiative has an approved description and is now being detailed.
`;
  }

  /**
   * Get classification template for acceptance criteria level initiatives
   */
  private getAcceptanceCriteriaTemplate(): string {
    return `
You are classifying user messages for initiative refinement at the ACCEPTANCE_CRITERIA level.

At this level, focus on:
- Validation criteria feedback
- Testing approach concerns
- Definition of done adjustments
- Final approval for implementation

Level-specific intents to classify:
- finalize: User approves acceptance criteria and initiative is ready for implementation
- edit_content: User wants to modify testing or validation requirements
- general_response: General question or comment not requiring specific action

Consider the context that this initiative has approved description and details, and is being finalized.
`;
  }

  /**
   * Validate level-aware classification result for security and consistency
   */
  private async validateLevelAwareClassification(
    classification: MessageClassificationResult,
    currentLevel: 'description' | 'details' | 'acceptanceCriteria',
    context: ConversationContext,
  ): Promise<void> {
    // Validate target level consistency
    if (
      classification.targetLevel &&
      classification.targetLevel !== currentLevel
    ) {
      // Allow progression to next level, but not regression
      const levelOrder = ['description', 'details', 'acceptanceCriteria'];
      const currentIndex = levelOrder.indexOf(currentLevel);
      const targetIndex = levelOrder.indexOf(classification.targetLevel);

      if (targetIndex < currentIndex) {
        this.logger.warn(
          'Classification suggests regression to previous level',
          {
            currentLevel,
            targetLevel: classification.targetLevel,
          },
        );
        // Reduce confidence for regression attempts
        classification.confidence = Math.max(
          0.1,
          classification.confidence - 0.2,
        );
      }
    }

    // Level-specific confidence adjustments
    if (
      currentLevel === 'description' &&
      classification.intent === MessageIntent.APPROVAL &&
      classification.confidence < 0.8
    ) {
      // High-level approvals should be quite confident
      this.logger.debug('Low confidence approval at description level', {
        currentLevel,
        intent: classification.intent,
        confidence: classification.confidence,
      });
    }

    // Apply base security validation
    await this.validateClassificationSecurity(classification, context);
  }

  /**
   * Validate input parameters
   */
  private validateInput(
    message: FlowUserMessage,
    context: ConversationContext,
  ): void {
    if (!message) {
      throw new Error('Message is required');
    }

    if (!context) {
      throw new Error('Context is required');
    }

    if (!context.organizationId) {
      throw new Error('Organization ID is required');
    }

    if (!context.conversationId) {
      throw new Error('Conversation ID is required');
    }

    const messageContent = this.extractAllStringValues(message.data);
    if (messageContent.length > this.config.maxMessageLength) {
      throw new Error(
        `Message exceeds maximum length of ${this.config.maxMessageLength} characters`,
      );
    }
  }

  /**
   * Validate classification result for security constraints
   */
  private async validateClassificationSecurity(
    classification: MessageClassificationResult,
    context: ConversationContext,
  ): Promise<void> {
    // Basic validation - for now just ensure organization context is preserved
    // TODO: Add proper initiative validation when getInitiativeById is implemented
    if (classification.targetInitiativeId && !context.organizationId) {
      this.logger.warn(
        'Classification has initiative ID but no organization context',
        {
          targetInitiativeId: classification.targetInitiativeId,
        },
      );
      classification.targetInitiativeId = undefined;
      classification.confidence = Math.max(
        0.1,
        classification.confidence - 0.3,
      );
    }
  }

  /**
   * Extract all string values from a data object and join them
   */
  private extractAllStringValues(data: unknown): string {
    this.logger.debug(`[extractAllStringValues] starting`, {
      data,
    });
    if (!data || typeof data !== 'object') {
      return '';
    }

    const stringValues: string[] = [];

    const extractStrings = (obj: unknown): void => {
      if (typeof obj === 'string' && obj.trim()) {
        stringValues.push(obj.trim());
      } else if (Array.isArray(obj)) {
        obj.forEach(extractStrings);
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(extractStrings);
      }
    };

    extractStrings(data);
    this.logger.debug(`[extractAllStringValues] found string values`, {
      stringValues,
    });
    return stringValues.join(' ');
  }

  /**
   * Simple keyword-based initiative detection
   */
  private containsInitiativeKeywords(content: string): boolean {
    const keywords = [
      'initiative',
      'feature',
      'requirement',
      'story',
      'task',
      'implement',
      'develop',
      'build',
      'create',
      'add',
      'update',
      'change',
      'modify',
      'improve',
      'enhance',
      'review',
      'approve',
      'reject',
      'feedback',
      'bug',
      'issue',
      'problem',
      'error',
    ];

    const lowerContent = content.toLowerCase();
    return keywords.some((keyword) => lowerContent.includes(keyword));
  }
}
