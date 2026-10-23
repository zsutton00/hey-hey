import { Injectable, Logger } from '@nestjs/common';
import { zodSchemaToJson } from 'src/utils/zod-to-json';
import { z } from 'zod';
import {
  ConversationNode,
  FlowContext,
  TransitionDefinition,
} from '../../../types/flow-internal.types';
import { ArtifactService } from '../../artifacts/artifact.service';
import { InitiativeRefinementPlaceholderRegistry } from '../placeholders/registries/initiative-refinement-placeholders.registry';
import { IPromptBuilderStrategy } from './prompt-builder-strategy.interface';
import { getResponseGuidance } from './utils';
import { ArtifactType } from 'src/generated';

/**
 * Strategy for building initiative refinement prompts with change detection context
 * Handles the complexity of incorporating initiative data and change analysis
 */
@Injectable()
export class InitiativeRefinementPromptBuilderStrategy
  implements IPromptBuilderStrategy
{
  private readonly logger = new Logger(
    InitiativeRefinementPromptBuilderStrategy.name,
  );

  constructor(private readonly artifactService: ArtifactService) {}

  /**
   * Check if a Zod schema represents a scalar type
   */
  protected isScalarSchema(responseSchema: z.ZodSchema): boolean {
    const typeName = (responseSchema._def as { typeName: string }).typeName;
    return (
      typeName === 'ZodString' ||
      typeName === 'ZodNumber' ||
      typeName === 'ZodBoolean'
    );
  }

  /**
   * Check if schema has detectedIntent field
   */
  protected schemaHasDetectedIntent(responseSchema?: z.ZodSchema): boolean {
    if (!responseSchema) return false;

    if (responseSchema._def) {
      const def = responseSchema._def as { shape?: Record<string, unknown> };
      if (def.shape && typeof def.shape === 'object') {
        return 'detectedIntent' in def.shape;
      }
    }

    return false;
  }

  /**
   * Check if node type needs UI elements
   */
  protected nodeTypeNeedsUIElements(nodeType: string): boolean {
    return nodeType === 'llm_questions';
  }

  getStrategyName(): string {
    return 'InitiativeRefinementPromptBuilderStrategy';
  }

  async buildInstructionsSection(
    node: ConversationNode | { id: string; type: string },
    promptConfig: {
      nodeInstructions?: string;
      responseSchema?: z.ZodSchema;
      skipTransitionInstructions?: boolean;
    },
    availableTransitions?: Record<string, TransitionDefinition>,
  ): Promise<string> {
    let instructions = '';

    // Use custom instructions if provided
    if (promptConfig.nodeInstructions) {
      instructions += `\n\n${promptConfig.nodeInstructions}`;
    } else {
      // Provide optimization-aware default instructions
      instructions += this.getOptimizationAwareInstructions(
        node.type,
        promptConfig.responseSchema,
      );
    }

    // Add optimization-specific transition instructions
    if (
      availableTransitions &&
      Object.keys(availableTransitions).length > 0 &&
      !promptConfig.skipTransitionInstructions
    ) {
      instructions +=
        this.getOptimizationTransitionInstructions(availableTransitions);
    }

    return instructions;
  }

  async buildResponseFormatSection(
    responseSchema: z.ZodSchema,
    nodeType: string,
    customExample?: string,
  ): Promise<string> {
    let instructions = '\n\nRESPONSE FORMAT:\n';

    const isScalar = this.isScalarSchema(responseSchema);

    if (isScalar) {
      instructions += 'Respond with a simple string value:\n\n';
    } else {
      instructions +=
        'You must respond with a JSON object that matches this structure:\n\n';
    }

    // Generate optimization-aware examples
    let structure: Record<string, unknown> | string;
    if (customExample) {
      structure = customExample;
    } else {
      structure = this.generateOptimizationAwareExample(responseSchema);
    }

    if (structure) {
      if (typeof structure === 'string') {
        instructions += structure + '\n\n';
      } else {
        instructions += JSON.stringify(structure) + '\n\n';
      }
    }

    instructions += this.getResponseGuidance(nodeType);

    // Add optimization-specific mapping instructions
    instructions += this.getOptimizationMappingInstructions(
      responseSchema,
      nodeType,
    );

    return instructions;
  }

  private getResponseGuidance(nodeType: string): string {
    let instructions = '';

    // Add anti-repetition guidance for LLM_QUESTIONS nodes
    if (this.nodeTypeNeedsUIElements(nodeType)) {
      instructions += getResponseGuidance();
    }
    return instructions;
  }

  /**
   * Get optimization-aware default instructions
   */
  private getOptimizationAwareInstructions(
    nodeType: string,
    responseSchema?: z.ZodSchema,
  ): string {
    const hasDetectedIntent = this.schemaHasDetectedIntent(responseSchema);
    const baseInstructions = this.getMinimalOptimizationInstructions(nodeType);

    let instructions = `\n\nOPTIMIZATION-AWARE ${nodeType.toUpperCase()} INSTRUCTIONS:\n`;
    instructions += baseInstructions;

    if (hasDetectedIntent) {
      instructions +=
        '\n- Consider optimization context when setting detectedIntent';
      instructions +=
        '\n- Use higher confidence for decisions supported by change detection';
    }

    instructions +=
      '\n- Leverage original generation data to avoid redundant work';
    instructions += '\n- Focus on areas where changes have been detected';

    return instructions;
  }

  /**
   * Get minimal optimization instructions by node type
   */
  private getMinimalOptimizationInstructions(nodeType: string): string {
    switch (nodeType) {
      case 'llm_questions':
        return '- Use change detection to focus questions on modified areas\n- Reference original assumptions when building on previous work\n- Avoid re-asking questions already answered unless changes detected';

      case 'classification':
        return '- Analyze user messages for intent classification based on change detection context\n- Use optimization context to improve classification accuracy\n- Consider change patterns when determining user intent';

      case 'analyze':
        return '- Compare current context with original analysis results\n- Focus analysis on areas where changes have been detected\n- Build upon previous insights rather than starting from scratch';

      case 'generate':
        return '- Use original generation data as starting point for improvements\n- Apply detected changes to refine existing content\n- Maintain consistency with unchanged aspects of original generation';

      case 'confirm':
        return '- Reference change detection results in confirmation summary\n- Highlight what has been modified vs. what remains the same\n- Provide confidence based on optimization analysis';

      case 'action':
        return '- Execute optimization-aware actions based on change detection\n- Apply changes efficiently using original generation context\n- Report on optimization effectiveness';

      default:
        return '- Leverage optimization context for informed decision making\n- Consider change detection results in response generation';
    }
  }

  /**
   * Get optimization-specific transition instructions with predictive routing
   */
  private getOptimizationTransitionInstructions(
    availableTransitions: Record<string, TransitionDefinition>,
  ): string {
    let instructions = '\n\nROUTING DECISION (Initiative Refinement):\n';
    instructions +=
      'Based on what the user has answered, the content you are generating, and optimization analysis, select the most appropriate next step.\n\n';
    instructions += 'Available transitions:\n';

    Object.entries(availableTransitions).forEach(([key, transition]) => {
      instructions += `- **${key}**: ${transition.description}`;
      if (transition.condition) {
        instructions += ` (Condition: ${transition.condition})`;
      }
      instructions += '\n';
    });

    instructions +=
      '\nIMPORTANT: Set the "detectedIntent" field to one of these exact transition keys.\n';
    instructions +=
      'Also include "reasoning" explaining your selection based on:\n';
    instructions += '1. User feedback and optimization goals\n';
    instructions += '2. Content/questions you are generating\n';
    instructions += '3. Change detection confidence and refinement progress\n';

    return instructions;
  }

  /**
   * Get optimization consideration for specific transitions
   */
  private getOptimizationTransitionConsideration(transition: string): string {
    const considerations: Record<string, string> = {
      needs_clarification:
        'Use when changes detected but unclear - leverage original context',
      ready_to_proceed:
        'High confidence if changes align with optimization strategy',
      refine_initiatives:
        'Recommended when change detection shows specific improvements needed',
      initiatives_accepted:
        'Use when change detection shows high similarity/satisfaction',
      default: 'Consider optimization context confidence in decision',
    };

    return (
      considerations[transition] ||
      'Apply optimization context to transition decision'
    );
  }

  /**
   * Generate optimization-aware examples for response schema
   */
  private generateOptimizationAwareExample(
    responseSchema: z.ZodSchema,
  ): Record<string, unknown> | string {
    return zodSchemaToJson(responseSchema) as Record<string, unknown> | string;
  }

  /**
   * Get optimization mapping instructions
   */
  private getOptimizationMappingInstructions(
    responseSchema: z.ZodSchema,
    nodeType: string,
  ): string {
    let instructions = 'OPTIMIZATION MAPPING INSTRUCTIONS:\n';
    instructions += 'When using optimization context:\n\n';

    if (responseSchema instanceof z.ZodObject) {
      const shape = responseSchema.shape;

      if (shape.optimizationMetadata) {
        instructions +=
          '- Include optimization metadata showing strategy used and changes detected\n';
      }

      if (shape.changesSummary) {
        instructions +=
          '- Provide summary of how change detection influenced the response\n';
      }

      // Node-specific optimization mappings
      if (nodeType === 'generate' && shape.initiatives) {
        instructions +=
          '- Reference original initiatives when building optimized versions\n';
        instructions += '- Include change rationale for modified initiatives\n';
      }
    }

    instructions +=
      '- Use change detection confidence to inform response confidence\n';
    instructions +=
      '- Reference original generation data in reasoning when applicable\n\n';

    // Add strict JSON-only output enforcement
    const isScalar = this.isScalarSchema(responseSchema);
    if (isScalar) {
      instructions += 'OUTPUT RULE:\n';
      instructions +=
        'RESPOND ONLY with the requested string value. NO additional text, explanations, or commentary.\n\n';
    } else {
      instructions += 'CRITICAL OUTPUT RULE:\n';
      instructions +=
        'RESPOND ONLY with valid JSON matching the structure above. NO additional text, explanations, or commentary after the JSON object.\n';
      instructions +=
        'The entire response must be parseable as JSON. Do NOT add any text before or after the JSON.\n\n';
    }

    return instructions;
  }

  // Abstract method implementations required by interface
  zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
    // For optimization strategy, we can delegate to a shared utility or implement our own
    // For now, we'll use a basic implementation
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(
        shape as Record<string, z.ZodTypeAny>,
      )) {
        const zodValue = value;
        properties[key] = { type: 'unknown' }; // Basic implementation
        if (!zodValue.isOptional()) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      };
    }

    return { type: 'unknown' };
  }

  isScalarSchemaCheck(responseSchema?: z.ZodSchema): boolean {
    if (!responseSchema) return false;
    return this.isScalarSchema(responseSchema);
  }

  /**
   * Get the placeholder registry for this strategy
   * Used by the new placeholder system for type-safe template resolution
   */
  getPlaceholderRegistry() {
    return new InitiativeRefinementPlaceholderRegistry();
  }

  /**
   * Build routing prompt for LLM-based transition selection
   * Initiative refinement flows typically use programmatic routing (ClassificationTransitions)
   * But this supports standard transition routing when needed
   */
  async buildRoutingPrompt(
    transitions: Record<string, TransitionDefinition>,
    context: FlowContext,
    nodeContext?: string,
  ): Promise<string> {
    const transitionKeys = Object.keys(transitions);

    // Load conversation history from database (last 10 exchanges)
    let recentHistory = 'No conversation history available';
    try {
      const artifacts = await this.artifactService.findMany(
        {
          projectId: context.core.projectId,
          sourceId: String(context.core.conversationId),
          status: 'ACTIVE',
          type: ArtifactType.QaPair,
          limit: 10,
        },
        context.core.organizationId,
      );

      const artifactList = artifacts?.data || [];
      if (artifactList.length > 0) {
        recentHistory = artifactList
          .map((artifact: any) => {
            const content = artifact.content || '[No content]';
            const role = artifact.type === 'USER_MESSAGE' ? 'User' : 'System';
            return `${role}: ${content}`;
          })
          .join('\n');
      }
    } catch (error) {
      this.logger.warn('Failed to load conversation history for routing', {
        error,
        conversationId: context.core.conversationId,
      });
    }

    // Build transitions list with descriptions
    const transitionsList = transitionKeys
      .map((key) => {
        const transition = transitions[key];
        if (!transition) {
          throw new Error(`Missing transition definition for ${key}`);
        }
        return `- **${key}**: ${transition.description}${
          transition.condition ? ` (${transition.condition})` : ''
        }`;
      })
      .join('\n');

    // Node-specific guidance
    const contextGuidance = nodeContext
      ? `\n\n## Node-Specific Guidance\n${nodeContext}`
      : '';

    // Add initiative-specific context if available
    const contextWithCustom = context as any;
    const initiativeContext = contextWithCustom.custom?.initiativeId
      ? `\n- Initiative ID: ${String(contextWithCustom.custom.initiativeId)}`
      : '';

    return `Based on the conversation history and current context, determine the most appropriate next step in the initiative refinement workflow.

## Recent Conversation History
${recentHistory}

## Current Context
- Project: ${context.core.projectId}
- Workflow: ${context.core.workflowId}
- Current Node: ${context.flowPath.previousNode || 'start'}
- Interaction Count: ${context.core.session.interactionCount}${initiativeContext}
${contextGuidance}

## Available Transitions
${transitionsList}

## Instructions
1. Analyze the conversation history and current context
2. Identify which transition best matches the current situation
3. Choose the transition key that represents the appropriate next step
4. Provide clear reasoning for your choice
5. Include a confidence score (0-1) for your decision

You must respond with:
- \`selectedTransition\`: The exact key of the chosen transition (one of: ${transitionKeys.join(', ')})
- \`reasoning\`: Clear explanation of why this transition was chosen
- \`confidence\`: Number between 0 and 1 indicating confidence in this decision`;
  }
}
