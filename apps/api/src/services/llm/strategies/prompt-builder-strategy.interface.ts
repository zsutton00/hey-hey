import { z } from 'zod';
import {
  ConversationNode,
  FlowContext,
  TransitionDefinition,
} from '../../../types/flow-internal.types';
import { PlaceholderRegistry } from '../placeholders';

/**
 * Interface for prompt building strategies
 * Allows modular prompt construction with different strategies for different node types
 */
export interface IPromptBuilderStrategy {
  /**
   * Build instructions section for the prompt
   * @param node - The conversation node being processed
   * @param promptConfig - Prompt configuration from the node
   * @param availableTransitions - Available transitions with descriptions for routing
   * @returns Instructions section string
   */
  buildInstructionsSection(
    node: ConversationNode | { id: string; type: string },
    promptConfig: {
      nodeInstructions?: string;
      responseSchema?: z.ZodSchema;
      skipTransitionInstructions?: boolean;
    },
    availableTransitions?: Record<string, TransitionDefinition>,
  ): Promise<string>;

  /**
   * Build response format section for the prompt
   * @param responseSchema - Zod schema for the response
   * @param nodeType - Type of the node
   * @param customExample - Optional custom example
   * @returns Response format instructions string
   */
  buildResponseFormatSection(
    responseSchema: z.ZodSchema,
    nodeType: string,
    customExample?: string,
  ): Promise<string>;

  /**
   * Build routing prompt for LLM-based transition selection
   * @param transitions - Available transitions with descriptions
   * @param context - Current flow context for contextual routing
   * @param nodeContext - Optional node-specific context or guidance
   * @returns Routing prompt string
   */
  buildRoutingPrompt(
    transitions: Record<string, TransitionDefinition>,
    context: FlowContext,
    nodeContext?: string,
  ): Promise<string>;

  /**
   * Get strategy name for logging and debugging
   */
  getStrategyName(): string;

  /**
   * Convert Zod schema to JSON schema for serialization
   */
  zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown>;

  /**
   * Check if schema represents a scalar type
   */
  isScalarSchemaCheck(responseSchema?: z.ZodSchema): boolean;

  /**
   * Get the placeholder registry for this strategy
   * Used by the new placeholder system for type-safe template resolution
   */
  getPlaceholderRegistry(): PlaceholderRegistry;
}
