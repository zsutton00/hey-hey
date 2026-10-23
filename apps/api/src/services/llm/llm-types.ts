import type {
  FlowUserMessage,
  IntermediateSystemMessageData,
} from 'src/types/flow-internal.types';
import type { WorkflowId } from 'src/types';
import z from 'zod';
import type {
  AnthropicTier,
  LLMModel,
  LLMProviderName,
  OpenAITier,
} from './llm-shared';

export interface ModelSelectionCriteria {
  provider: LLMProviderName;
  model?: LLMModel;
  anthropicTier?: AnthropicTier;
  openaiTier?: OpenAITier;
  maxInputCostPer1M?: number;
  maxOutputCostPer1M?: number;
  requiresFeatures?: string[];
}

export enum TaskType {
  STRUCTURED_OUTPUT = 'structured_output',
  SIMPLE_TEXT = 'simple_text',
  AGENT_REASONING = 'agent_reasoning',
  ANALYSIS = 'analysis',
  CONVERSATION = 'conversation',
}

export interface LLMCallOptions {
  modelCriteria?: ModelSelectionCriteria;
  model?: string;
  temperature?: number;
  topP?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: 'json_object' | 'text' | null;
  maxTokens?: number;
  timeout?: number;
  userMessage?: FlowUserMessage;
  stream?: boolean;
  onProgress?: LLMStreamProgressHandler;
  responseType?: 'raw' | 'analysis';
  responseSchema: z.Schema;
  useToolCallSchema?: boolean;
  toolName?: string;
  taskType?: TaskType;
  allowFallback?: boolean;
}

export interface LLMCostData {
  model: LLMModel;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface LLMResponse<T = string> {
  content: T;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  requestId?: string;
  costData?: LLMCostData;
}

export type LLMStreamProgressHandler = (
  snapshot: IntermediateSystemMessageData,
) => void;

export interface LLMRequest {
  prompt: string;
  model?: string;
  temperature?: number;
  topP?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: 'json_object' | 'text' | null;
  maxTokens?: number;
  stream?: boolean;
  timeout?: number;
  workflowId?: WorkflowId;
}
