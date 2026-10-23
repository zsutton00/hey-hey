import type { MockLlmSessionId, WorkflowId } from 'src/types';
import type { IntermediateSystemMessageData } from 'src/types/flow-internal.types';
import type { LLMCallOptions, LLMRequest, LLMResponse } from '../llm-types';
import type { LLMProviderName } from '../llm-shared';

export interface LLMProviderContext {
  workflowId?: WorkflowId;
  nodeId?: string;
  nodeType?: string;
  requestId?: string;
  mockLlmSessionId?: MockLlmSessionId;
}

export type OnChunk = (snapshot: IntermediateSystemMessageData) => boolean;

export interface LLMProvider {
  readonly name: LLMProviderName;

  callStructured<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>>;

  streamStructured(
    request: LLMRequest,
    options: LLMCallOptions,
    onChunk: OnChunk,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>>;

  callRaw(
    request: LLMRequest,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<string>>;

  streamRaw(
    request: LLMRequest,
    onChunk: OnChunk,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>>;

  healthCheck?(): Promise<{ status: string; message?: string }>;
}
