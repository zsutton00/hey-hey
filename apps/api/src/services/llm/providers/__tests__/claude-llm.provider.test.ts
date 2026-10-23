import { z } from 'zod';
import { ClaudeModel, LLMProviderName } from '../../llm-shared';
import {
  ClaudeLLMProvider,
  StructuredOutputValidationError,
} from '../claude-llm.provider';

describe('ClaudeLLMProvider', () => {
  const logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  const createProvider = () =>
    new ClaudeLLMProvider(logger, 'anthropic-key', 30000, 4096);

  const mockMessagesCreate = (provider: ClaudeLLMProvider, content: string) => {
    const create = jest.fn().mockResolvedValue({
      id: 'msg_test',
      content: [{ type: 'text', text: content }],
      usage: {
        input_tokens: 12,
        output_tokens: 8,
      },
    });

    const anthropic = (
      provider as unknown as {
        anthropic: { messages: { create: jest.Mock } };
      }
    ).anthropic;
    anthropic.messages.create = create;

    return create;
  };

  const mockToolUse = (provider: ClaudeLLMProvider, input: unknown) => {
    const create = jest.fn().mockResolvedValue({
      id: 'msg_tool_test',
      content: [
        {
          type: 'tool_use',
          id: 'tool_use_test',
          name: 'structured_response',
          input,
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    });

    const anthropic = (
      provider as unknown as {
        anthropic: { messages: { create: jest.Mock } };
      }
    ).anthropic;
    anthropic.messages.create = create;

    return create;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([undefined, 0.4, 0.7])(
    'omits temperature for Haiku 5.5 raw and native structured calls (%s)',
    async (temperature) => {
      const provider = createProvider();
      const create = mockMessagesCreate(provider, '{"response":"ok"}');
      await provider.callRaw({
        prompt: 'Respond normally',
        model: ClaudeModel.CLAUDE_5_HAIKU_5,
        temperature,
      });
      await provider.callStructured('Generate a response', {
        model: ClaudeModel.CLAUDE_5_HAIKU_5,
        temperature,
        responseSchema: z.object({ response: z.string() }),
      });
      for (const [request] of create.mock.calls) {
        expect(request.model).toBe('claude-haiku-5-5');
        expect(request).not.toHaveProperty('temperature');
      }
    },
  );

  it('omits temperature for Haiku 5.5 strict tool calls', async () => {
    const provider = createProvider();
    const create = mockToolUse(provider, { response: 'ok' });
    await provider.callStructured('Generate a response', {
      model: ClaudeModel.CLAUDE_5_HAIKU_5,
      temperature: 0.4,
      responseSchema: z.object({ response: z.string() }),
      useToolCallSchema: true,
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(create.mock.calls[0][0].tools[0].strict).toBe(true);
  });

  it('preserves temperature defaults and overrides for other Claude models', async () => {
    const provider = createProvider();
    const create = mockMessagesCreate(provider, 'ok');
    await provider.callRaw({ prompt: 'Respond normally' });
    await provider.callRaw({
      prompt: 'Respond normally',
      model: ClaudeModel.CLAUDE_4_HAIKU_5,
      temperature: 0.4,
    });
    expect(create.mock.calls[0][0].temperature).toBe(0.7);
    expect(create.mock.calls[1][0].temperature).toBe(0.4);
  });

  it('omits temperature for Haiku 5.5 streaming calls', async () => {
    const provider = createProvider();
    const stream = jest.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {},
      finalMessage: async () => ({
        id: 'msg_stream',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      controller: { abort: jest.fn() },
    });
    const anthropic = (
      provider as unknown as {
        anthropic: { messages: { stream: jest.Mock } };
      }
    ).anthropic;
    anthropic.messages.stream = stream;
    await expect(
      provider.streamRaw(
        {
          prompt: 'Respond normally',
          model: ClaudeModel.CLAUDE_5_HAIKU_5,
          temperature: 0.4,
        },
        () => true,
      ),
    ).rejects.toThrow('Structured stream did not produce content');
    expect(stream.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('uses native structured output without assistant prefill', async () => {
    const provider = createProvider();
    const create = mockMessagesCreate(provider, '{"response":"ok"}');

    const result = await provider.callStructured(
      'Generate a response',
      {
        model: ClaudeModel.CLAUDE_4_SONNET_6,
        responseSchema: z.object({ response: z.string() }),
      },
      { nodeId: 'shared-generate-features' },
    );

    const request = create.mock.calls[0][0];
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Generate a response' }],
      },
    ]);
    expect(request.output_config).toEqual({
      format: expect.objectContaining({
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            response: { type: 'string' },
          },
          additionalProperties: false,
          required: ['response'],
        },
      }),
    });
    expect(result).toEqual({
      content: {
        response: 'ok',
        nodeId: 'shared-generate-features',
      },
      usage: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      },
      requestId: 'msg_test',
    });
  });

  it('keeps raw calls user-ended and returns their text unchanged', async () => {
    const provider = createProvider();
    const create = mockMessagesCreate(provider, 'plain text');

    const result = await provider.callRaw({ prompt: 'Respond normally' });

    const request = create.mock.calls[0][0];
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Respond normally' }],
      },
    ]);
    expect(request.output_config).toBeUndefined();
    expect(result.content).toBe('plain text');
  });

  it('sends strict tool schemas and retains local validation', async () => {
    const provider = createProvider();
    const create = mockToolUse(provider, { response: 'ok' });

    const result = await provider.callStructured(
      'Generate a response',
      {
        model: ClaudeModel.CLAUDE_4_SONNET_6,
        responseSchema: z.object({
          response: z.string(),
          optionalNote: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1).optional(),
        }),
        useToolCallSchema: true,
      },
      { nodeId: 'onboarding-clarify-concept' },
    );

    const tool = create.mock.calls[0][0].tools[0];

    expect(tool).toEqual(
      expect.objectContaining({
        name: 'structured_response',
        strict: true,
        input_schema: expect.objectContaining({
          type: 'object',
          required: ['response'],
          additionalProperties: false,
          properties: expect.objectContaining({
            optionalNote: expect.objectContaining({
              type: ['string', 'null'],
            }),
          }),
        }),
      }),
    );
    expect(tool.input_schema.properties.confidence).not.toHaveProperty(
      'minimum',
    );
    expect(tool.input_schema.properties.confidence).not.toHaveProperty(
      'maximum',
    );
    expect(result).toEqual(
      expect.objectContaining({
        content: {
          response: 'ok',
          nodeId: 'onboarding-clarify-concept',
        },
        requestId: 'msg_tool_test',
      }),
    );
  });

  it('throws a tracked structured validation error for invalid tool input', async () => {
    const provider = createProvider();
    mockToolUse(provider, { response: 42 });

    let thrown: unknown;
    try {
      await provider.callStructured('Generate a response', {
        model: ClaudeModel.CLAUDE_4_SONNET_6,
        responseSchema: z.object({ response: z.string() }),
        useToolCallSchema: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StructuredOutputValidationError);
    expect(thrown).toMatchObject({
      provider: LLMProviderName.CLAUDE,
      requestId: 'msg_tool_test',
      responseContent: JSON.stringify({ response: 42 }),
      validationErrors: expect.any(Array),
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    });
  });

  it('attaches the mock-session header only to the scoped provider call', async () => {
    const provider = createProvider();
    const create = mockMessagesCreate(provider, '{"response":"ok"}');

    await provider.callStructured(
      'Generate a response',
      {
        model: ClaudeModel.CLAUDE_4_SONNET_6,
        responseSchema: z.object({ response: z.string() }),
      },
      {
        nodeId: 'onboarding-analyze-project-concept',
        mockLlmSessionId:
          '9db93370-808f-4bba-a38c-84c72cd35937' as import('../../../../types').MockLlmSessionId,
      },
    );

    expect(create.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: {
          'X-Mock-Session': '9db93370-808f-4bba-a38c-84c72cd35937',
        },
      }),
    );
  });
});
