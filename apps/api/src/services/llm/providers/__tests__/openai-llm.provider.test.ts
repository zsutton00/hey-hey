import { z } from 'zod';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { MockLlmSessionId } from 'src/types';
import { OpenAILLMProvider } from '../openai-llm.provider';

describe('OpenAILLMProvider mock-session routing', () => {
  it('attaches the mock-session header only to the scoped Responses API call', async () => {
    const parse = jest.fn().mockResolvedValue({
      id: 'response-id',
      status: 'completed',
      output_parsed: { response: 'ok' },
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const client = { responses: { parse } };
    const logger = {
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as ContextAwareLogger;
    const provider = new OpenAILLMProvider(
      logger,
      client as never,
      'http://127.0.0.1:3001/v1',
      'test-key',
      undefined,
      1_000,
      1_000,
      {},
    );

    await provider.callStructured(
      'Generate a response',
      {
        responseSchema: z.object({ response: z.string() }),
        toolName: 'onboarding_response',
      },
      {
        nodeId: 'onboarding-analyze-project-concept',
        mockLlmSessionId:
          '82f71916-a6a4-4b65-a1c2-cd3d4179af5f' as MockLlmSessionId,
      },
    );

    expect(parse).toHaveBeenCalledWith(expect.any(Object), {
      headers: {
        'X-Mock-Session': '82f71916-a6a4-4b65-a1c2-cd3d4179af5f',
      },
    });
  });
});
