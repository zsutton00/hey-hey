import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import type { IntermediateSystemMessageData } from 'src/types/flow-internal.types';
import { JsonExtractionUtil } from 'src/utils/json-extraction.util';
import { errorToLoggable } from 'src/utils/logging.util';
import type { ZodIssue } from 'zod';
import { DEFAULT_SYNTHETIC_MODEL, LLMProviderName } from '../llm-shared';
import type { LLMCallOptions, LLMRequest, LLMResponse } from '../llm-types';
import { ensureSystemMessageData } from '../streaming/structured-streaming.util';
import type {
  LLMProvider,
  LLMProviderContext,
  OnChunk,
} from './llm-provider.interface';

type SyntheticStructuredOutputError = Error & {
  responseContent?: string;
  validationErrors?: ZodIssue[];
  requestId?: string;
  usage?: LLMResponse['usage'];
};

interface SyntheticStreamStats {
  promptTokens: number;
  completionTokens: number;
  requestId?: string;
}

export class SyntheticLLMProvider implements LLMProvider {
  readonly name = LLMProviderName.SYNTHETIC;

  constructor(
    private readonly logger: ContextAwareLogger,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeout: number,
    private readonly defaultMaxTokens: number,
    private readonly defaultModel: string = DEFAULT_SYNTHETIC_MODEL,
  ) {}

  async callStructured<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    return this.callWithZodSchema(prompt, options, context);
  }

  async streamStructured(
    request: LLMRequest,
    _options: LLMCallOptions,
    onChunk: OnChunk,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    return this.streamSyntheticResponse(request, onChunk, true);
  }

  async callRaw(request: LLMRequest): Promise<LLMResponse<string>> {
    return this.callSyntheticAPI(request, false);
  }

  async streamRaw(
    request: LLMRequest,
    onChunk: OnChunk,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    return this.streamSyntheticResponse(request, onChunk, false);
  }

  async healthCheck(): Promise<{ status: string; message?: string }> {
    if (!this.apiKey) {
      return { status: 'unconfigured', message: 'Missing Synthetic API key' };
    }
    return { status: 'unknown', message: 'Provider configured' };
  }

  private async callWithZodSchema<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    this.logger.debug(
      '[callWithZodSchema] Starting Synthetic structured output',
      {
        nodeId: context?.nodeId,
        toolName: options.toolName,
      },
    );

    if (!options.responseSchema) {
      throw new Error('responseSchema is required for structured outputs');
    }

    const request: LLMRequest = {
      prompt,
      model: options.model || this.defaultModel,
      temperature: options.temperature ?? 0.7,
      topP: options.topP,
      reasoningEffort: options.reasoningEffort,
      responseFormat: options.responseFormat,
      maxTokens: options.maxTokens ?? this.defaultMaxTokens,
      timeout: options.timeout ?? this.timeout,
    };

    try {
      const response = await this.callSyntheticAPI(request, true);
      const rawText = response.content;
      this.logger.log('[callWithZodSchema] raw Synthetic content received', {
        nodeId: context?.nodeId,
        rawContentPreview:
          typeof rawText === 'string' ? rawText.slice(0, 400) : rawText,
        rawContentType: typeof rawText,
      });

      let parsedContent: T;
      let extractedJsonContent: string | undefined;
      let validationIssues: ZodIssue[] | undefined;

      try {
        extractedJsonContent = JsonExtractionUtil.extractJSONFromResponse(
          response.content,
        );
        const parsedJsonContent = JSON.parse(extractedJsonContent);
        const parseResult = options.responseSchema.safeParse(parsedJsonContent);

        if (!parseResult.success) {
          validationIssues = parseResult.error.issues;
          this.logger.warn('[callWithZodSchema] Schema validation failed', {
            nodeId: context?.nodeId,
            error: parseResult.error,
            content: parsedJsonContent,
          });
          throw new Error(
            `Synthetic response validation failed: ${parseResult.error.message}`,
          );
        }

        parsedContent = parseResult.data;
      } catch (parseError) {
        const parseErrorMessage =
          parseError instanceof Error
            ? parseError.message
            : errorToLoggable(parseError);
        this.logger.error(
          '[callWithZodSchema] Failed to parse Synthetic response',
          {
            nodeId: context?.nodeId,
            error: parseErrorMessage,
            content: response.content,
          },
        );

        const structuredError: SyntheticStructuredOutputError = new Error(
          parseErrorMessage,
        );
        structuredError.name = 'SyntheticStructuredOutputError';
        structuredError.responseContent =
          extractedJsonContent ?? response.content;
        structuredError.validationErrors = validationIssues;
        structuredError.requestId = response.requestId;
        structuredError.usage = response.usage;
        throw structuredError;
      }

      this.logger.debug('[callWithZodSchema] success', {
        nodeId: context?.nodeId,
        responseKeys: Object.keys(parsedContent),
        usage: response.usage,
      });

      return {
        content: {
          ...parsedContent,
          nodeId: context?.nodeId,
        } as T,
        usage: response.usage,
        requestId: response.requestId,
      };
    } catch (error) {
      this.logger.error('[callWithZodSchema] failed', {
        nodeId: context?.nodeId,
        error: error instanceof Error ? error.message : errorToLoggable(error),
      });
      throw error;
    }
  }

  private async callSyntheticAPI(
    request: LLMRequest,
    structuredOutput: boolean,
  ): Promise<LLMResponse<string>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeout || this.timeout,
    );

    try {
      const requestBody: Record<string, unknown> = {
        model: request.model || this.defaultModel,
        messages: this.buildMessages(request.prompt, structuredOutput),
        temperature: request.temperature ?? 0.7,
        max_completion_tokens: request.maxTokens ?? this.defaultMaxTokens,
        stream: false,
      };
      if (typeof request.topP === 'number') {
        requestBody.top_p = request.topP;
      }
      if (request.reasoningEffort) {
        requestBody.reasoning_effort = request.reasoningEffort;
      }
      if (request.responseFormat === 'json_object') {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Synthetic API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      const choices = Array.isArray(data.choices)
        ? (data.choices as Record<string, unknown>[])
        : [];
      const firstChoice = choices[0];
      const message = firstChoice?.message as
        | Record<string, unknown>
        | undefined;
      const content = this.extractContentText(message?.content);
      if (!content) {
        this.logger.error('Invalid response format from Synthetic API', {
          data: JSON.stringify(data, null, 2),
        });
        throw new Error('Invalid response format from Synthetic API');
      }

      const usage = data.usage as Record<string, unknown> | undefined;
      const promptTokens = usage?.prompt_tokens;
      const completionTokens = usage?.completion_tokens;
      const totalTokens = usage?.total_tokens;

      return {
        content,
        usage:
          typeof promptTokens === 'number' &&
          typeof completionTokens === 'number' &&
          typeof totalTokens === 'number'
            ? {
                promptTokens,
                completionTokens,
                totalTokens,
              }
            : undefined,
        requestId: typeof data.id === 'string' ? data.id : undefined,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async streamSyntheticResponse(
    request: LLMRequest,
    onChunk: OnChunk,
    structuredOutput: boolean,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeout || this.timeout,
    );

    try {
      const requestBody: Record<string, unknown> = {
        model: request.model || this.defaultModel,
        messages: this.buildMessages(request.prompt, structuredOutput),
        temperature: request.temperature ?? 0.7,
        max_completion_tokens: request.maxTokens ?? this.defaultMaxTokens,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (typeof request.topP === 'number') {
        requestBody.top_p = request.topP;
      }
      if (request.reasoningEffort) {
        requestBody.reasoning_effort = request.reasoningEffort;
      }
      if (request.responseFormat === 'json_object') {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Synthetic API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const buffer = { text: '' };

      let aggregatedResponse = '';
      let latestStructuredSnapshot: IntermediateSystemMessageData | undefined;
      const stats: SyntheticStreamStats = {
        promptTokens: 0,
        completionTokens: 0,
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
            ? (parsed.choices as Record<string, unknown>[])
            : [];

          for (const choice of choices) {
            const delta = choice.delta as Record<string, unknown> | undefined;
            if (!delta) {
              continue;
            }

            const textDelta = this.extractContentText(delta.content);
            if (!textDelta) {
              continue;
            }

            aggregatedResponse += textDelta;
            if (structuredOutput) {
              const structuredSnapshot =
                this.tryParseStructuredSnapshot(aggregatedResponse);
              if (structuredSnapshot) {
                latestStructuredSnapshot = structuredSnapshot;
                onChunk(structuredSnapshot);
              } else {
                onChunk(
                  ensureSystemMessageData({ response: aggregatedResponse }),
                );
              }
            } else {
              onChunk(
                ensureSystemMessageData({ response: aggregatedResponse }),
              );
            }
          }
        } catch (error) {
          this.logger.warn('Failed to parse Synthetic streaming payload', {
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
        this.logger.warn('Synthetic streaming response missing body reader');
      }

      return {
        content:
          structuredOutput && latestStructuredSnapshot
            ? latestStructuredSnapshot
            : aggregatedResponse,
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

  private buildMessages(prompt: string, structuredOutput: boolean) {
    if (structuredOutput) {
      return [
        {
          role: 'developer',
          content: 'Return only valid JSON object output.',
        },
        { role: 'user', content: prompt },
      ];
    }

    return [{ role: 'user', content: prompt }];
  }

  private buildHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private tryParseStructuredSnapshot(
    content: string,
  ): IntermediateSystemMessageData | null {
    const extractedContent =
      JsonExtractionUtil.extractJSONFromResponse(content);
    if (!extractedContent.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(extractedContent);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return ensureSystemMessageData(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private extractContentText(content: unknown): string {
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
