import { Injectable, Logger } from '@nestjs/common';
import { zodSchemaToJson } from 'src/utils/zod-to-json';
import { z } from 'zod';
import {
  ConversationNode,
  FlowContext,
  TransitionDefinition,
} from '../../../types/flow-internal.types';
import { ArtifactService } from '../../artifacts/artifact.service';
import { StandardPlaceholderRegistry } from '../placeholders';
import { IPromptBuilderStrategy } from './prompt-builder-strategy.interface';
import { getResponseGuidance } from './utils';
import { ArtifactType } from 'src/generated';

/**
 * Standard prompt building strategy for basic prompt construction
 * Handles the core functionality without optimization-specific features
 */
@Injectable()
export class StandardPromptBuilderStrategy implements IPromptBuilderStrategy {
  private readonly logger = new Logger(StandardPromptBuilderStrategy.name);

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
  protected nodeTypeNeedsUIElements(
    nodeType: string,
    schema: z.ZodSchema,
  ): boolean {
    if (schema && schema instanceof z.ZodObject) {
      if (!('uiElements' in schema.shape)) {
        return false;
      }
    } else {
      return false;
    }
    return nodeType === 'llm_questions';
  }

  getStrategyName(): string {
    return 'StandardPromptBuilderStrategy';
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
      // Provide standard default instructions
      instructions += this.getStandardInstructions(
        node.type,
        promptConfig.responseSchema,
      );
    }

    // Add standard transition instructions
    if (
      availableTransitions &&
      Object.keys(availableTransitions).length > 0 &&
      !promptConfig.skipTransitionInstructions
    ) {
      instructions +=
        this.getStandardTransitionInstructions(availableTransitions);
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

    // Use custom example if provided, otherwise generate from schema
    let structure: Record<string, unknown> | string;
    if (customExample) {
      structure = customExample;
    } else {
      // Generate example structure from the actual response schema
      structure = this.generateStandardExample(responseSchema);
    }

    this.logger.debug(
      `[buildResponseFormatSection] generating schema-driven format instructions`,
      {
        nodeType,
        customExample: !!customExample,
        structureType: typeof structure,
      },
    );

    if (structure) {
      if (typeof structure === 'string') {
        instructions += structure + '\n\n';
      } else {
        instructions += JSON.stringify(structure, null, 2) + '\n\n';
      }
    }

    // Add mapping instructions based on the response schema and node type
    // Skip complex mapping instructions if custom example is provided (assumes custom example handles this)
    if (
      !customExample &&
      responseSchema &&
      responseSchema instanceof z.ZodObject
    ) {
      const shape = responseSchema.shape;

      instructions += 'MAPPING INSTRUCTIONS:\n';
      instructions +=
        'Transform your response to match the exact structure shown above.\n\n';

      // Always map feedback to response
      if (shape.feedback) {
        instructions +=
          '- Put your "feedback" message in the "response" field\n';
      }

      // Node-type specific mappings
      if (nodeType === 'llm_questions' && shape.questions) {
        instructions +=
          '- Convert each question from your response schema to a UIElement in the "uiElements" array:\n';
        instructions += '  {\n';
        instructions += '    "id": string (from question.id),\n';
        instructions +=
          '    "type": "text" | "textarea" | "select" (from question.fieldType),\n';
        instructions += '    "label": string (the question text),\n';
        instructions +=
          '    "placeholder": string (optional placeholder text),\n';
        instructions += '    "required": boolean (default true),\n';
        instructions += '    "multiline": boolean (true for textarea type)\n';
        instructions += '  }\n';
      }

      // Intent detection fields (common to all types)
      if (shape.detectedIntent) {
        instructions +=
          '- Put "detectedIntent" in data.detectedIntent (required)\n';
      }

      if (shape.intentConfidence) {
        instructions +=
          '- Put "intentConfidence" in data.intentConfidence (required)\n';
      }

      if (shape.reasoning) {
        instructions += '- Put "reasoning" in data.reasoning (optional)\n';
      }

      if (nodeType === 'analyze') {
        if (shape.analysis) {
          instructions += '- Put "analysis" object in data.analysis\n';
        }
      }

      if (nodeType === 'generate') {
        if (shape.initiatives) {
          instructions += '- Put "initiatives" array in data.initiatives\n';
        }
        if (shape.summary) {
          instructions += '- Put "summary" object in data.summary\n';
        }
      }

      // Common optional field
      if (shape.interactionComplete) {
        instructions +=
          '- Map "interactionComplete" to root level "interaction_complete"\n';
      }
    }

    // Only include UI element instructions if this node type needs them
    const includeUIElements = this.nodeTypeNeedsUIElements(
      nodeType,
      responseSchema,
    );
    if (includeUIElements) {
      instructions += getResponseGuidance();
    }

    // Add appropriate output format rule based on schema type
    if (isScalar) {
      instructions += '\nSTRING-ONLY OUTPUT RULE:\n';
      instructions +=
        'ALWAYS respond with plain text (no JSON wrapping) matching the example format above.\n';
    } else {
      instructions += '\nJSON-ONLY OUTPUT RULE:\n';
      instructions +=
        'ALWAYS respond in valid JSON format matching the structure above.\n';
    }

    return instructions;
  }

  /**
   * Get standard instructions by node type
   */
  private getStandardInstructions(
    nodeType: string,
    responseSchema?: z.ZodSchema,
  ): string {
    const hasDetectedIntent = this.schemaHasDetectedIntent(responseSchema);

    switch (nodeType) {
      case 'llm_questions':
        return `\n\nQUESTION INSTRUCTIONS:
- Ask focused, relevant questions based on the context
- Build on previous answers naturally, avoiding repetition
- Show that you understand and value their input${hasDetectedIntent ? '\n- Set detectedIntent based on user response patterns' : ''}`;

      case 'analyze':
        return `\n\nANALYZE INSTRUCTIONS:
- Provide thorough but concise analysis
- Focus on actionable insights
- Base recommendations on the specific context provided${hasDetectedIntent ? '\n- Set detectedIntent based on analysis outcome' : ''}`;

      case 'generate':
        return `\n\nGENERATE INSTRUCTIONS:
- Create specific, actionable content based on the response schema
- Ensure generated content is relevant to the user's stated goals
- Structure output for easy understanding and next steps${hasDetectedIntent ? '\n- Set detectedIntent based on generation success' : ''}`;

      case 'confirm':
        return `\n\nCONFIRM INSTRUCTIONS:
- Summarize what has been accomplished
- Highlight key decisions and outcomes
- Provide clear next steps${hasDetectedIntent ? '\n- Set detectedIntent based on user confirmation' : ''}`;

      case 'action':
        return `\n\nACTION INSTRUCTIONS:
- Execute the required actions based on context
- Provide clear feedback about what was done
- Handle any errors gracefully${hasDetectedIntent ? '\n- Set detectedIntent based on action result' : ''}`;

      default:
        return hasDetectedIntent
          ? '\n\n- Set detectedIntent based on user response'
          : '';
    }
  }

  /**
   * Get standard transition instructions with predictive routing
   */
  private getStandardTransitionInstructions(
    availableTransitions: Record<string, TransitionDefinition>,
  ): string {
    let instructions = '\n\nROUTING DECISION:\n';
    instructions +=
      'Based on what the user has answered and the questions/content you are about to provide, select the most appropriate next step.\n\n';
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
      'Also include "reasoning" explaining why you selected this transition based on:\n';
    instructions += '1. What the user has already communicated\n';
    instructions += '2. The questions/content you are generating\n';
    instructions += '3. What information those questions will likely clarify\n';

    return instructions;
  }

  /**
   * Generate examples from schema with full compatibility
   */
  private generateStandardExample(
    responseSchema: z.ZodSchema,
  ): Record<string, unknown> | string {
    return zodSchemaToJson(responseSchema) as Record<string, unknown> | string;
  }

  // Abstract method implementations required by interface
  zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
    return zodSchemaToJson(schema) as Record<string, unknown>;
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
    return new StandardPlaceholderRegistry();
  }

  /**
   * Build routing prompt for LLM-based transition selection
   * Creates a prompt that asks the LLM to choose the best transition based on conversation context
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
          type: ArtifactType.QaPair,
          status: 'ACTIVE',
          limit: 10,
        },
        context.core.organizationId,
      );

      const artifactList = artifacts?.data || [];
      if (artifactList.length > 0) {
        recentHistory = artifactList
          .map((artifact) => {
            // Artifacts store conversation data in JSON data field
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const content = (artifact.data as any)?.message || '[No content]';
            return `${artifact.type}: ${content}`;
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

    return `Based on the conversation history and current context, determine the most appropriate next step in the workflow.

## Recent Conversation History
${recentHistory}

## Current Context
- Project: ${context.core.projectId}
- Workflow: ${context.core.workflowId}
- Current Node: ${context.flowPath.previousNode || 'start'}
- Interaction Count: ${context.core.session.interactionCount}
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
