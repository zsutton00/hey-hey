import { z } from 'zod';
import { SyntheticLLMProvider } from '../synthetic-llm.provider';

describe('SyntheticLLMProvider', () => {
  const logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  const createProvider = () =>
    new SyntheticLLMProvider(
      logger,
      'synthetic-key',
      'https://api.synthetic.test',
      30000,
      4096,
      'hf:test/model',
    );

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('uses structured prompt messages for streamStructured', async () => {
    const reader = {
      read: jest.fn().mockResolvedValueOnce({
        done: true,
        value: undefined as unknown as Uint8Array,
      }),
      releaseLock: jest.fn(),
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => reader,
      },
    });

    const provider = createProvider();
    await provider.streamStructured(
      {
        prompt: 'Generate JSON',
      } as any,
      {
        responseSchema: z.object({
          response: z.string(),
          stages: z.array(z.object({})).optional(),
        }),
      } as any,
      () => true,
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages).toEqual([
      {
        role: 'developer',
        content: 'Return only valid JSON object output.',
      },
      {
        role: 'user',
        content: 'Generate JSON',
      },
    ]);
  });

  it('emits and returns parsed structured snapshots during streamStructured', async () => {
    const payload =
      'data: {"id":"req-1","choices":[{"delta":{"content":"{\\"response\\":\\"ok\\",\\"stages\\":[]}"}}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n';
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(payload),
        })
        .mockResolvedValueOnce({
          done: true,
          value: undefined as unknown as Uint8Array,
        }),
      releaseLock: jest.fn(),
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => reader,
      },
    });

    const onChunk = jest.fn().mockReturnValue(true);
    const provider = createProvider();

    const result = await provider.streamStructured(
      {
        prompt: 'Generate JSON',
      } as any,
      {
        responseSchema: z.object({
          response: z.string(),
          stages: z.array(z.object({})),
        }),
      } as any,
      onChunk,
    );

    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        response: 'ok',
        stages: [],
      }),
    );
    expect(result.content).toEqual(
      expect.objectContaining({
        response: 'ok',
        stages: [],
      }),
    );
  });
});
