import { APIError, APIConnectionError, APITimeoutError, TypeSafeClient } from '@typesafe-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructuredServerLogger } from '../server/logger';
import {
  createJevClient,
  DEFAULT_JEV_MODEL,
  JEV_TIMEOUT_MS,
  JevClient,
  readJevApiKey,
  type JevInput,
} from './client';

const input = {
  model: DEFAULT_JEV_MODEL,
  state: { document: 'private-state-content' },
  questions: {
    relationship: {
      type: 'choice',
      instructions: 'Classify the relationship',
      criteria: { informs: null, other: null },
    },
    relevance: {
      type: 'score',
      instructions: 'Rate relevance',
      criteria: ['unrelated', 'partial', 'relevant'],
    },
    conflict: { type: 'noul', instructions: 'Does this conflict?', criteria: { true: null } },
  },
} satisfies JevInput;

const success = {
  model: 'jev-test',
  answers: {
    relationship: {
      type: 'choice',
      choice: 'informs',
      confidence: 0.9,
      probabilities: { informs: 0.9, other: 0.1 },
    },
    relevance: {
      type: 'score',
      score: 1.7,
      confidence: 0.8,
      probabilities: { '0': 0.1, '1': 0.1, '2': 0.8 },
      legend: { '0': 'unrelated', '1': 'partial', '2': 'relevant' },
    },
    conflict: { type: 'noul', noul: 0.2 },
  },
  usage: { input_tokens: 123, output_tokens: 7 },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('readJevApiKey', () => {
  it.each([undefined, '', '   '])('finds no key for %s', (key) => {
    expect(readJevApiKey({ TYPESAFE_API_KEY: key })).toBeUndefined();
  });

  it('returns the trimmed key when one is defined', () => {
    expect(readJevApiKey({ TYPESAFE_API_KEY: ' local-key ' })).toBe('local-key');
  });
});

describe('Jev client', () => {
  it.each([undefined, '', '   '])('creates no client or request for absent key %s', (key) => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    // The supplied environment is authoritative, even if the process has a key.
    vi.stubEnv('TYPESAFE_API_KEY', 'ambient-key');
    expect(createJevClient({ TYPESAFE_API_KEY: key })).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('sends a mixed request using the captured key and retains all answers, usage and timing', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(Response.json(success));
    vi.stubGlobal('fetch', fetchStub);
    vi.stubEnv('TYPESAFE_LOG_LEVEL', 'debug');
    vi.stubEnv('TYPESAFE_BASE_URL', 'https://unrelated.test');
    const consoleSpies = ['debug', 'info', 'warn', 'error'].map((method) =>
      vi
        .spyOn(console, method as 'debug' | 'info' | 'warn' | 'error')
        .mockImplementation(() => undefined),
    );
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'debug',
      writeLine: (line) => lines.push(line),
    });
    const env = { TYPESAFE_API_KEY: 'local-test-key' };
    const client = createJevClient(env, logger);
    expect(client).toBeInstanceOf(JevClient);
    expect(fetchStub).not.toHaveBeenCalled();
    env.TYPESAFE_API_KEY = 'changed-key';
    if (!client) throw new Error('Expected opt-in client');
    const result = await client.evaluate(input);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const call = fetchStub.mock.calls[0];
    if (!call) throw new Error('Expected SDK request');
    const [url, options] = call;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer local-test-key');
    expect(options?.body).toBe(JSON.stringify(input));
    expect(result).toMatchObject({
      ok: true,
      model: 'jev-test',
      answers: {
        relationship: success.answers.relationship,
        relevance: {
          type: 'score',
          score: 1.7,
          confidence: 0.8,
          probabilities: success.answers.relevance.probabilities,
        },
        conflict: success.answers.conflict,
      },
      usage: { inputTokens: 123, outputTokens: 7 },
    });
    if (result.ok) expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const logged = lines.join('\n');
    expect(logged).toContain('jev.evaluate.completed');
    expect(logged).not.toContain('local-test-key');
    expect(logged).not.toContain('private-state-content');
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    {
      error: new APIError(400, { error: 'criteria must not be empty' }, new Headers()),
      code: 'PROVIDER_ERROR',
      providerStatus: 400,
      providerDetail: true,
    },
    { error: new APITimeoutError(JEV_TIMEOUT_MS), code: 'TIMEOUT' },
    {
      error: new APIConnectionError('local-test-key private-state-content'),
      code: 'PROVIDER_ERROR',
    },
    { error: new Error('local-test-key private-state-content'), code: 'PROVIDER_ERROR' },
  ])(
    'bounds $code failures and logs the error class but only the provider response of HTTP errors',
    async ({ error, code, providerStatus, providerDetail }) => {
      const sdk = new TypeSafeClient({ apiKey: 'local-test-key', logLevel: 'off' });
      vi.spyOn(sdk, 'systemOne').mockRejectedValue(error);
      const lines: string[] = [];
      const logger = new StructuredServerLogger({
        minLevel: 'debug',
        writeLine: (line) => lines.push(line),
      });
      const result = await new JevClient(sdk, logger).evaluate(input);
      expect(result).toEqual({
        ok: false,
        failure: {
          code,
          message: code === 'TIMEOUT' ? 'Jev evaluation timed out.' : 'Jev evaluation failed.',
          ...(providerStatus !== undefined ? { providerStatus } : {}),
          ...(providerDetail ? { providerDetail: error.message } : {}),
          errorDetail: expect.stringContaining(error.constructor.name) as string,
        },
      });
      expect(lines.join('\n')).toContain(error.constructor.name);
      if (providerDetail) expect(lines.join('\n')).toContain('criteria must not be empty');
      expect(JSON.stringify([result, lines])).not.toMatch(/local-test-key|private-state-content/);
    },
  );

  it('uses the SDK timeout and makes no retry', async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const client = createJevClient({ TYPESAFE_API_KEY: 'local-test-key' });
    if (!client) throw new Error('Expected opt-in client');
    const result = client.evaluate(input);
    await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS);
    await expect(result).resolves.toEqual({
      ok: false,
      failure: {
        code: 'TIMEOUT',
        message: 'Jev evaluation timed out.',
        errorDetail: expect.stringContaining('APITimeoutError <- caused by AbortError') as string,
      },
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]).toBeDefined();
  });

  it.each([
    { ...success, usage: { input_tokens: -1, output_tokens: 7 } },
    { ...success, answers: { ...success.answers, conflict: { type: 'noul', noul: 1.1 } } },
    {
      ...success,
      answers: {
        ...success.answers,
        conflict: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } },
      },
    },
    { ...success, answers: { relationship: success.answers.relationship } },
    {
      ...success,
      answers: {
        ...success.answers,
        relationship: { ...success.answers.relationship, probabilities: { informs: 0.9 } },
      },
    },
    {
      ...success,
      answers: {
        ...success.answers,
        relevance: { ...success.answers.relevance, probabilities: { '0': 0.2, '1': 0.8 } },
      },
    },
    {
      ...success,
      answers: {
        ...success.answers,
        relationship: { ...success.answers.relationship, choice: 'invented' },
      },
    },
  ])('rejects malformed or incomplete external results', async (response) => {
    const sdk = new TypeSafeClient({
      apiKey: 'local-test-key',
      logLevel: 'off',
      fetch: vi.fn().mockResolvedValue(Response.json(response)),
    });
    await expect(new JevClient(sdk).evaluate(input)).resolves.toEqual({
      ok: false,
      failure: { code: 'INVALID_RESPONSE', message: 'Jev returned an invalid evaluation result.' },
    });
  });

  describe('listModels', () => {
    const clientWith = (fetchStub: typeof fetch, logger?: StructuredServerLogger): JevClient =>
      new JevClient(
        new TypeSafeClient({ apiKey: 'local-test-key', logLevel: 'off', fetch: fetchStub }),
        logger,
      );

    it('returns the model ids available to the account with the captured key', async () => {
      const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          models: [
            { name: 'jev-a', description: 'A', release_date: '2026-01-01' },
            { name: 'jev-b', description: 'B', release_date: '2026-02-01' },
          ],
        }),
      );
      await expect(clientWith(fetchStub).listModels()).resolves.toEqual({
        ok: true,
        models: ['jev-a', 'jev-b'],
      });
      const call = fetchStub.mock.calls[0];
      if (!call) throw new Error('Expected SDK request');
      expect(call[0]).toBe('https://api.typesafe.ai/v1/models');
      expect(new Headers(call[1]?.headers).get('authorization')).toBe('Bearer local-test-key');
    });

    it.each([{ models: [{ id: 'jev-a' }] }, { models: [{ name: '' }] }, { models: [{ name: 5 }] }])(
      'rejects a malformed model list',
      async (response) => {
        const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
        await expect(clientWith(fetchStub).listModels()).resolves.toEqual({
          ok: false,
          failure: { code: 'INVALID_RESPONSE', message: 'Jev returned an invalid model list.' },
        });
      },
    );

    it('bounds a provider failure without logging the SDK error', async () => {
      const sdk = new TypeSafeClient({ apiKey: 'local-test-key', logLevel: 'off' });
      vi.spyOn(sdk.models, 'list').mockRejectedValue(
        new APIError(401, 'local-test-key leaked', new Headers()),
      );
      const lines: string[] = [];
      const logger = new StructuredServerLogger({
        minLevel: 'debug',
        writeLine: (line) => lines.push(line),
      });
      const result = await new JevClient(sdk, logger).listModels();
      expect(result).toEqual({
        ok: false,
        failure: {
          code: 'PROVIDER_ERROR',
          message: 'Jev model lookup failed.',
          providerStatus: 401,
          errorDetail: expect.stringContaining('APIError') as string,
        },
      });
      expect(JSON.stringify([result, lines])).not.toMatch(/local-test-key|leaked/);
    });
  });
});
