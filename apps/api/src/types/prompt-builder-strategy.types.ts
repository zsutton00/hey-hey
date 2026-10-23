/**
 * Types and interfaces for PromptBuilderService strategy pattern integration
 * Enables parameter-based strategy selection for different prompt building approaches
 */

export enum PromptBuilderStrategyType {
  STANDARD = 'standard',
  INITIATIVE_REFINEMENT = 'initiative-refinement',
  TASK_REFINEMENT = 'task-refinement',
}

/**
 * Options for prompt builder method calls
 * Allows selection of specific strategies and configuration
 */
export interface PromptBuilderOptions {
  /** Strategy to use for prompt building. Defaults to STANDARD if not provided */
  strategy?: PromptBuilderStrategyType;
}

/**
 * Context information used for strategy selection decisions
 * Provides hints for automatic strategy selection when no explicit strategy provided
 */
export interface StrategySelectionContext {
  /** Conversation node being processed */
  node?: unknown;
  /** Flow or prompt context */
  context?: unknown;
  /** User message if available */
  userMessage?: unknown;
  /** Explicit options provided by caller */
  options?: PromptBuilderOptions;
  /** Whether initiative refinement features should be used */
  useInitiativeRefinement?: boolean;
  /** Initiative refinement context data */
  initiativeRefinementContext?: unknown;
}

/**
 * Strategy selection result with metadata
 * Used internally for tracking and monitoring strategy decisions
 */
export interface StrategySelectionResult {
  /** Selected strategy type */
  strategy: PromptBuilderStrategyType;
  /** Reason for strategy selection */
  reason: 'explicit' | 'context-hint' | 'default';
  /** Selection metadata for monitoring */
  metadata?: Record<string, unknown>;
}
