import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import type { IntermediateSystemMessageData } from 'src/types/flow-internal.types';
import { JsonExtractionUtil } from 'src/utils/json-extraction.util';
import { errorToLoggable } from 'src/utils/logging.util';
import type { ZodIssue } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ClaudeModel,
  LLMProviderName,
  llmTemperatureParams,
} from '../llm-shared';
import type { LLMCallOptions, LLMRequest, LLMResponse } from '../llm-types';
import { StructuredStreamProcessor } from '../streaming/structured-streaming.util';
import type { LLMProvider, LLMProviderContext } from './llm-provider.interface';

interface ClaudeStreamStats {
  promptTokens: number;
  completionTokens: number;
  requestId?: string;
}

type StructuredOutputValidationErrorContext = {
  provider: LLMProviderName;
  validationErrors: ZodIssue[];
  responseContent: string;
  requestId?: string;
  usage?: LLMResponse['usage'];
};

export class StructuredOutputValidationError extends Error {
  readonly provider: LLMProviderName;
  readonly validationErrors: ZodIssue[];
  readonly responseContent: string;
  readonly requestId?: string;
  readonly usage?: LLMResponse['usage'];

  constructor(context: StructuredOutputValidationErrorContext) {
    super('Claude structured output failed schema validation');
    this.name = 'StructuredOutputValidationError';
    this.provider = context.provider;
    this.validationErrors = context.validationErrors;
    this.responseContent = context.responseContent;
    this.requestId = context.requestId;
    this.usage = context.usage;
  }
}

type ClaudeStructuredOutputError = Error & {
  responseContent?: string;
  validationErrors?: ZodIssue[];
  requestId?: string;
  usage?: LLMResponse['usage'];
};

export class ClaudeLLMProvider implements LLMProvider {
  readonly name = LLMProviderName.CLAUDE;

  constructor(
    private readonly logger: ContextAwareLogger,
    private readonly apiKey: string,
    private readonly timeout: number,
    private readonly defaultMaxTokens: number,
    baseUrl?: string,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.apiKey,
      baseURL: baseUrl,
    });
  }

  private readonly anthropic: Anthropic;

  async callStructured<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    if (options.useToolCallSchema) {
      return this.callWithToolSchema<T>(prompt, options, context);
    }
    return this.callWithZodSchema(prompt, options, context);
  }

  async streamStructured(
    request: LLMRequest,
    options: LLMCallOptions,
    onChunk: (snapshot: IntermediateSystemMessageData) => boolean,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    return this.streamClaudeResponse(
      request,
      onChunk,
      this.buildStructuredOutputFormat(options),
    );
  }

  async callRaw(request: LLMRequest): Promise<LLMResponse<string>> {
    return this.callClaudeAPI(request);
  }

  async streamRaw(
    request: LLMRequest,
    onChunk: (snapshot: IntermediateSystemMessageData) => boolean,
  ): Promise<LLMResponse<IntermediateSystemMessageData | string>> {
    return this.streamClaudeResponse(request, onChunk);
  }

  async healthCheck(): Promise<{ status: string; message?: string }> {
    if (!this.apiKey) {
      return { status: 'unconfigured', message: 'Missing Anthropic API key' };
    }
    return { status: 'unknown', message: 'Provider configured' };
  }

  private async callWithZodSchema<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    this.logger.debug('[callWithZodSchema] Starting Claude structured output', {
      nodeId: context?.nodeId,
      toolName: options.toolName,
    });

    const request: LLMRequest = {
      prompt,
      model: options.model,
      ...llmTemperatureParams(options.model, options.temperature),
      maxTokens: options.maxTokens || this.defaultMaxTokens,
      timeout: options.timeout || this.timeout,
    };
    const outputFormat = this.buildStructuredOutputFormat(options);

    try {
      const response = await this.callClaudeAPI(request, outputFormat, context);
      const rawText = response.content;
      this.logger.log('[callWithZodSchema] raw Claude content received', {
        nodeId: context?.nodeId,
        rawContentPreview:
          typeof rawText === 'string' ? rawText.slice(0, 400) : rawText,
        rawContentType: typeof rawText,
      });

      if (!options.responseSchema) {
        throw new Error('responseSchema is required for structured outputs');
      }

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
            `Claude response validation failed: ${parseResult.error.message}`,
          );
        }

        parsedContent = parseResult.data;
      } catch (parseError) {
        const parseErrorMessage =
          parseError instanceof Error
            ? parseError.message
            : errorToLoggable(parseError);
        this.logger.error(
          '[callWithZodSchema] Failed to parse Claude response',
          {
            nodeId: context?.nodeId,
            error: parseErrorMessage,
            content: response.content,
          },
        );

        const structuredError: ClaudeStructuredOutputError = new Error(
          parseErrorMessage,
        );
        structuredError.name = 'ClaudeStructuredOutputError';
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
        costData: response.costData,
      };
    } catch (error) {
      this.logger.error('[callWithZodSchema] failed', {
        nodeId: context?.nodeId,
        error: error instanceof Error ? error.message : errorToLoggable(error),
      });
      throw error;
    }
  }

  private async callWithToolSchema<T extends object>(
    prompt: string,
    options: LLMCallOptions,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<T>> {
    if (!options.responseSchema) {
      throw new Error(
        'responseSchema is required for tool call structured outputs',
      );
    }

    const toolName = options.toolName || 'structured_response';
    const jsonSchema = zodToJsonSchema(options.responseSchema, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    });
    const rootSchema = jsonSchema as Record<string, unknown>;

    if (rootSchema.type !== 'object') {
      throw new Error('Claude tool input schema must be an object');
    }

    const strictInputSchema = jsonSchemaOutputFormat(
      rootSchema as Parameters<typeof jsonSchemaOutputFormat>[0],
    ).schema;

    const model = options.model || ClaudeModel.CLAUDE_4_SONNET_6;
    this.logger.debug('[callWithToolSchema] Starting Claude tool call', {
      nodeId: context?.nodeId,
      toolName,
      model,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout || this.timeout,
    );

    try {
      const createParams: Anthropic.Messages.MessageCreateParams = {
        model,
        max_tokens: options.maxTokens || this.defaultMaxTokens,
        ...llmTemperatureParams(options.model, options.temperature),
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
        tools: [
          {
            name: toolName,
            description:
              'Respond with the structured output matching this schema.',
            input_schema:
              strictInputSchema as Anthropic.Messages.Tool.InputSchema,
            strict: true,
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
      };
      if (typeof options.topP === 'number') {
        createParams.top_p = options.topP;
      }

      const message = await this.anthropic.messages.create(createParams, {
        signal: controller.signal,
        headers: this.mockSessionHeaders(context),
      });

      const toolUseBlock = message.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === 'tool_use',
      );

      if (!toolUseBlock) {
        throw new Error(
          'Claude did not return a tool_use block despite forced tool_choice',
        );
      }

      const parseResult = options.responseSchema.safeParse(toolUseBlock.input);
      if (!parseResult.success) {
        this.logger.warn('[callWithToolSchema] Schema validation failed', {
          nodeId: context?.nodeId,
          error: parseResult.error,
          content: toolUseBlock.input,
        });
        throw new StructuredOutputValidationError({
          provider: LLMProviderName.CLAUDE,
          validationErrors: parseResult.error.issues,
          responseContent: JSON.stringify(toolUseBlock.input),
          requestId: message.id,
          usage: message.usage
            ? {
                promptTokens: message.usage.input_tokens,
                completionTokens: message.usage.output_tokens,
                totalTokens:
                  message.usage.input_tokens + message.usage.output_tokens,
              }
            : undefined,
        });
      }

      const parsedContent = parseResult.data as T;

      this.logger.debug('[callWithToolSchema] success', {
        nodeId: context?.nodeId,
        responseKeys: Object.keys(parsedContent),
        usage: message.usage,
      });

      return {
        content: {
          ...parsedContent,
          nodeId: context?.nodeId,
        } as T,
        usage: message.usage
          ? {
              promptTokens: message.usage.input_tokens,
              completionTokens: message.usage.output_tokens,
              totalTokens:
                message.usage.input_tokens + message.usage.output_tokens,
            }
          : undefined,
        requestId: message.id,
      };
    } catch (error) {
      this.logger.error('[callWithToolSchema] failed', {
        nodeId: context?.nodeId,
        error: error instanceof Error ? error.message : errorToLoggable(error),
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async callClaudeAPI(
    request: LLMRequest,
    outputFormat?: Anthropic.Messages.JSONOutputFormat,
    context?: LLMProviderContext,
  ): Promise<LLMResponse<string>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeout || this.timeout,
    );

    try {
      const createParams: Anthropic.Messages.MessageCreateParams = {
        model: request.model || ClaudeModel.CLAUDE_4_SONNET_6,
        max_tokens: request.maxTokens || this.defaultMaxTokens,
        ...llmTemperatureParams(request.model, request.temperature),
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: request.prompt }],
          },
        ],
      };
      if (outputFormat) {
        createParams.output_config = { format: outputFormat };
      }
      if (typeof request.topP === 'number') {
        createParams.top_p = request.topP;
      }

      const message = await this.anthropic.messages.create(createParams, {
        signal: controller.signal,
        headers: this.mockSessionHeaders(context),
      });

      const textContent = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        content: textContent,
        usage: message.usage
          ? {
              promptTokens: message.usage.input_tokens,
              completionTokens: message.usage.output_tokens,
              totalTokens:
                message.usage.input_tokens + message.usage.output_tokens,
            }
          : undefined,
        requestId: message.id,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private mockSessionHeaders(
    context: LLMProviderContext | undefined,
  ): Record<string, string> | undefined {
    return context?.mockLlmSessionId
      ? { 'X-Mock-Session': context.mockLlmSessionId }
      : undefined;
  }

  private async streamClaudeResponse(
    request: LLMRequest,
    onChunk: (snapshot: IntermediateSystemMessageData) => boolean,
    outputFormat?: Anthropic.Messages.JSONOutputFormat,
  ): Promise<LLMResponse<IntermediateSystemMessageData>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeout || this.timeout,
    );

    try {
      const streamParams: Anthropic.Messages.MessageStreamParams = {
        model: request.model || ClaudeModel.CLAUDE_4_SONNET_6,
        max_tokens: request.maxTokens || this.defaultMaxTokens,
        ...llmTemperatureParams(request.model, request.temperature),
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: request.prompt }],
          },
        ],
      };
      if (outputFormat) {
        streamParams.output_config = { format: outputFormat };
      }
      if (typeof request.topP === 'number') {
        streamParams.top_p = request.topP;
      }

      const stream = this.anthropic.messages.stream(streamParams, {
        signal: controller.signal,
      });

      const stats: ClaudeStreamStats = { promptTokens: 0, completionTokens: 0 };

      const processor = new StructuredStreamProcessor(onChunk, this.logger, [
        'response',
        'uiElements',
      ]);

      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_start' ||
            event.type === 'content_block_delta' ||
            event.type === 'content_block_stop'
          ) {
            processor.ingestEvent(event);
          }
        }

        const finalMessage = await stream.finalMessage();
        if (finalMessage?.usage) {
          stats.promptTokens = finalMessage.usage.input_tokens ?? 0;
          stats.completionTokens = finalMessage.usage.output_tokens ?? 0;
        }
        stats.requestId = finalMessage?.id ?? stats.requestId;

        const content = await processor.finalize();
        if (!content) {
          throw new Error('Structured stream did not produce content');
        }

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
        stream.controller?.abort();
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private applyStreamUsageMetadata(
    metadata: Record<string, unknown>,
    stats: ClaudeStreamStats,
  ) {
    const input = metadata.input_tokens;
    const output = metadata.output_tokens;

    if (typeof input === 'number') {
      stats.promptTokens = input;
    }
    if (typeof output === 'number') {
      stats.completionTokens = output;
    }
  }

  private buildStructuredOutputFormat(
    options: LLMCallOptions,
  ): Anthropic.Messages.JSONOutputFormat {
    if (!options.responseSchema) {
      throw new Error('responseSchema is required for structured outputs');
    }

    const jsonSchema = zodToJsonSchema(options.responseSchema, {
      $refStrategy: 'none',
      target: 'openApi3',
    });
    const rootSchema = jsonSchema as Record<string, unknown>;

    if (rootSchema.type !== 'object') {
      throw new Error('Claude structured output schema must be an object');
    }

    return jsonSchemaOutputFormat(
      rootSchema as Parameters<typeof jsonSchemaOutputFormat>[0],
    );
  }
}
