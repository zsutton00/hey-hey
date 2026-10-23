import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import type { IntermediateSystemMessageData } from 'src/types/flow-internal.types';
import { errorToLoggable } from 'src/utils/logging.util';
import type { ModelTier } from '../llm-shared';
import { LLMProviderName, OpenAIModel } from '../llm-shared';
import type { LLMCallOptions, LLMRequest, LLMResponse } from '../llm-types';
import type { MutableIntermediateSystemMessageData } from '../streaming/structured-streaming.util';
import { ensureSystemMessageData } from '../streaming/structured-streaming.util';
import type { LLMProvider, LLMProviderContext } from './llm-provider.interface';

interface OpenAIStreamStats {
  promptTokens: number;
  completionTokens: number;
  requestId?: string;
}

const TEMPERATURE_ONE_ONLY_MODELS = [
  OpenAIModel.GPT_5_MINI,
  OpenAIModel.GPT_5_NANO,
];

export class OpenAILLMProvider implements LLMProvider {
  readonly name = LLMProviderName.OPENAI;

  constructor(
    private readonly logger: ContextAwareLogger,
    private readonly client: OpenAI,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly organization: string | undefined,
    private readonly timeout: number,
    private readonly defaultMaxTokens: number,
    private readonly modelTiers: Record<string, ModelTier>,
  ) {}

  async callStructured<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    return this.callOpenAIResponsesAPI(prompt, options, context);
  }

  async streamStructured(
    request: LLMRequest,
    _options: LLMCallOptions,
    onChunk: (snapshot: IntermediateSystemMessageData) => void,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    return this.streamOpenAIResponse(request, onChunk);
  }

  async callRaw(request: LLMRequest): Promise<LLMResponse<string>> {
    return this.callOpenAIAPI(request);
  }

  async streamRaw(
    request: LLMRequest,
    onChunk: (snapshot: IntermediateSystemMessageData) => void,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    return this.streamOpenAIResponse(request, onChunk);
  }

  async healthCheck(): Promise<{ status: string; message?: string }> {
    if (!this.apiKey) {
      return { status: 'unconfigured', message: 'Missing OpenAI API key' };
    }
    return { status: 'unknown', message: 'Provider configured' };
  }

  private async callOpenAIResponsesAPI<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    if (!options.responseSchema) {
      throw new Error(
        'responseSchema is required for OpenAI structured outputs',
      );
    }

    const model = (options.model as OpenAIModel) || OpenAIModel.GPT_5_1;

    this.logger.debug(
      `Calling openai with ${model} model for ${context?.workflowId ?? 'unknown workflowId'} ${context?.nodeId ?? 'unknown node'}`,
    );

    try {
      const response = await this.client.responses.parse(
        {
          model,
          input: [{ role: 'user', content: prompt }],
          text: {
            format: zodTextFormat(
              options.responseSchema,
              options.toolName || 'structured_response',
            ),
          },
        },
        {
          headers: context?.mockLlmSessionId
            ? { 'X-Mock-Session': context.mockLlmSessionId }
            : undefined,
        },
      );

      if (response.status !== 'completed') {
        throw new Error(
          `OpenAI request failed with status: ${response.status}`,
        );
      }

      const parsedContent = response.output_parsed as T;
      const costData = this.calculateCostData(model, response.usage);

      this.logger.debug(`[callOpenAIResponsesAPI] success`, {
        nodeId: context?.nodeId,
        responseKeys: Object.keys(parsedContent),
        usage: response.usage,
      });

      return {
        content: {
          ...parsedContent,
          nodeId: context?.nodeId,
        } as T,
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        requestId: response.id,
        costData,
      };
    } catch (error) {
      this.logger.error(`[callOpenAIResponsesAPI] failed`, {
        nodeId: context?.nodeId,
        error: error instanceof Error ? error.message : errorToLoggable(error),
      });
      throw error;
    }
  }

  private calculateCostData(
    model: OpenAIModel,
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    },
  ) {
    if (!usage) {
      return undefined;
    }

    const modelTier = this.modelTiers[model];
    if (!modelTier) {
      return undefined;
    }

    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const totalTokens = usage.total_tokens;

    const inputCost = (inputTokens / 1_000_000) * modelTier.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * modelTier.outputCostPer1M;
    const totalCost = inputCost + outputCost;

    return {
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      inputCost,
      outputCost,
      totalCost,
    };
  }

  private requiresSetTemperature(model: OpenAIModel) {
    return TEMPERATURE_ONE_ONLY_MODELS.includes(model);
  }

  private async callOpenAIAPI(
    request: LLMRequest,
  ): Promise<LLMResponse<string>> {
    const model = (request.model || OpenAIModel.GPT_5_MINI) as OpenAIModel;
    this.logger.debug(`[callOpenAIAPI] starting`, {
      model,
      temperature: request.temperature || 0.7,
      max_completion_tokens: request.maxTokens || this.defaultMaxTokens,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      };

      if (this.organization) {
        headers['OpenAI-Organization'] = this.organization;
      }

      let temperature = request.temperature || 0.7;
      if (this.requiresSetTemperature(model)) {
        temperature = 1;
      }

      const requestBody: Record<string, unknown> = {
        model,
        messages: [
          { role: 'developer', content: 'You are a helpful assistant.' },
          { role: 'user', content: request.prompt },
        ],
        temperature,
        max_completion_tokens: request.maxTokens || this.defaultMaxTokens,
        stream: false,
      };

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        this.logger.error('Invalid response format', {
          data: JSON.stringify(data, null, 2),
        });
        throw new Error('Invalid response format from OpenAI API');
      }

      const costData = this.calculateChatCost(model, data.usage);

      return {
        content,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        requestId: data.id,
        costData,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private calculateChatCost(
    model: string,
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    },
  ) {
    if (!usage) {
      return undefined;
    }

    const tier = this.modelTiers[model];
    if (!tier) {
      return undefined;
    }

    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || 0;
    const inputCost = (inputTokens / 1_000_000) * tier.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * tier.outputCostPer1M;

    const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
    const cachedInputCost = tier.cachedInputCostPer1M
      ? (cachedTokens / 1_000_000) * tier.cachedInputCostPer1M
      : 0;

    const adjustedInputCost = inputCost - cachedInputCost;
    const totalCost = adjustedInputCost + outputCost + cachedInputCost;

    return {
      model: model as OpenAIModel,
      inputTokens,
      outputTokens,
      totalTokens,
      inputCost: adjustedInputCost,
      outputCost,
      totalCost,
    };
  }

  private async streamOpenAIResponse(
    request: LLMRequest,
    onChunk: (snapshot: IntermediateSystemMessageData) => void,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    const model = (request.model || OpenAIModel.GPT_5_MINI) as OpenAIModel;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      };

      if (this.organization) {
        headers['OpenAI-Organization'] = this.organization;
      }

      let temperature = request.temperature || 0.7;
      if (this.requiresSetTemperature(model)) {
        temperature = 1;
      }

      const requestBody: Record<string, unknown> = {
        model,
        messages: [
          { role: 'developer', content: 'You are a helpful assistant.' },
          { role: 'user', content: request.prompt },
        ],
        temperature,
        max_completion_tokens: request.maxTokens || this.defaultMaxTokens,
        stream: true,
        stream_options: { include_usage: true },
      };

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const buffer = { text: '' };

      let aggregatedResponse = '';
      const aggregatedState: MutableIntermediateSystemMessageData = {};
      let latestSnapshot: IntermediateSystemMessageData | undefined;
      const stats: OpenAIStreamStats = { promptTokens: 0, completionTokens: 0 };

      const emitSnapshotUpdate = (fragment: unknown, originType?: string) => {
        const snapshot = ensureSystemMessageData(aggregatedState);
        onChunk(snapshot);
      };

      const handlePayload = (payload: string) => {
        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;

          if (!stats.requestId && typeof parsed.id === 'string') {
            stats.requestId = parsed.id;
          }

          const usage = parsed.usage as Record<string, unknown> | undefined;
          if (usage) {
            const prompt = usage.prompt_tokens ?? usage.input_tokens;
            const completion = usage.completion_tokens ?? usage.output_tokens;
            if (typeof prompt === 'number') {
              stats.promptTokens = prompt;
            }
            if (typeof completion === 'number') {
              stats.completionTokens = completion;
            }
          }

          const choices = Array.isArray(parsed.choices)
            ? (parsed.choices as unknown[])
            : [];

          for (const choice of choices) {
            if (!choice || typeof choice !== 'object') {
              continue;
            }

            const choiceRecord = choice as Record<string, unknown>;
            const delta = choiceRecord.delta as
              | Record<string, unknown>
              | undefined;

            if (!delta) {
              continue;
            }

            const textDelta = this.collectTextSegments(
              delta.content,
              emitSnapshotUpdate,
            );
            if (textDelta) {
              aggregatedResponse += textDelta;
              emitSnapshotUpdate({ response: aggregatedResponse });
            }

            if (delta.parsed !== undefined) {
              emitSnapshotUpdate(delta.parsed, 'openai.delta');
            }

            if (
              Array.isArray(delta.tool_calls) &&
              delta.tool_calls.length > 0
            ) {
              emitSnapshotUpdate(
                { tool_calls: delta.tool_calls },
                'openai.tool_calls',
              );
            }
          }
        } catch (error) {
          this.logger.warn('Failed to parse OpenAI streaming payload', {
            error: errorToLoggable(error),
          });
        }
      };

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            if (value) {
              const decoded = decoder.decode(value, { stream: true });
              const payloads = this.extractSSEPayloads(buffer, decoded);
              for (const payload of payloads) {
                handlePayload(payload);
              }
            }
          }
        } finally {
          const remainderPayloads = this.extractSSEPayloads(buffer, '', true);
          for (const payload of remainderPayloads) {
            handlePayload(payload);
          }
          reader.releaseLock();
        }
      } else {
        this.logger.warn('OpenAI streaming response missing body reader');
      }

      const content = latestSnapshot ? latestSnapshot : aggregatedResponse;

      return {
        content,
        usage: {
          promptTokens: stats.promptTokens,
          completionTokens: stats.completionTokens,
          totalTokens: stats.promptTokens + stats.completionTokens,
        },
        requestId: stats.requestId,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private collectTextSegments(
    content: unknown,
    emitStructuredUpdate: (fragment: unknown, originType?: string) => void,
  ): string {
    if (!content) {
      return '';
    }

    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    let textAccumulator = '';
    for (const part of content) {
      if (!part) {
        continue;
      }

      if (typeof part === 'string') {
        textAccumulator += part;
        continue;
      }

      if (typeof part !== 'object') {
        continue;
      }

      const partRecord = part as Record<string, unknown>;
      if (typeof partRecord.text === 'string') {
        textAccumulator += partRecord.text;
      }

      if (partRecord.parsed !== undefined) {
        emitStructuredUpdate(partRecord.parsed, 'openai.content');
      }
    }

    return textAccumulator;
  }

  private extractSSEPayloads(
    buffer: { text: string },
    chunk: string,
    flush = false,
  ): string[] {
    buffer.text += chunk;
    const lines = buffer.text.split('\n');
    if (!flush) {
      buffer.text = lines.pop() ?? '';
    } else {
      buffer.text = '';
    }

    const payloads: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.substring('data:'.length).trim();
        if (payload && payload !== '[DONE]') {
          payloads.push(payload);
        }
      }
    }

    return payloads;
  }
}
