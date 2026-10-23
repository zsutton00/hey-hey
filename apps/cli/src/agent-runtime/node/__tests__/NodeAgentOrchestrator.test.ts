import { describe, expect, it, vi } from 'vitest';
import {
  AgentAdapterRegistry,
  type AgentMessage,
  type AgentSessionStore,
  toAgentSessionId,
} from '../../core/index';
import { NodeAgentOrchestrator } from '../NodeAgentOrchestrator';

const collectMessages = async (stream: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> => {
  const messages: AgentMessage[] = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

const toMessageStream = (messages: AgentMessage[]): AsyncIterable<AgentMessage> =>
  (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();

const createMessage = (
  type: AgentMessage['type'],
  sessionId = null as ReturnType<typeof toAgentSessionId> | null,
): AgentMessage => ({
  type,
  sessionId,
  content: [{ kind: 'text', payload: 'msg' }],
  timestamp: Date.now(),
});

const createErrorMessage = (
  subtype: string,
  payload: unknown,
  sessionId = null as ReturnType<typeof toAgentSessionId> | null,
): AgentMessage => ({
  type: 'error',
  subtype,
  sessionId,
  content: [{ kind: 'error', payload }],
  timestamp: Date.now(),
});

describe('NodeAgentOrchestrator', () => {
  it('initializes adapter, submits prompt, and closes after stream completes', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi.fn().mockResolvedValue(toMessageStream([createMessage('assistant')]));
    const resume = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'mock',
      init,
      submitPrompt,
      resume,
      close,
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({ registry });
    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'hello',
      initOptions: {
        cwd: '/tmp',
      },
      promptOptions: {
        timeoutMs: 1_000,
      },
    });

    const messages = await collectMessages(stream);

    expect(messages).toHaveLength(1);
    expect(init).toHaveBeenCalledWith({ cwd: '/tmp' });
    expect(submitPrompt).toHaveBeenCalledWith('hello', { timeoutMs: 1_000 });
    expect(resume).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('resumes with the provided session id', async () => {
    const sessionId = toAgentSessionId('sess-42');
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi.fn();
    const resume = vi.fn().mockResolvedValue(toMessageStream([createMessage('result', sessionId)]));
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'mock',
      init,
      submitPrompt,
      resume,
      close,
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({ registry });
    const stream = await orchestrator.resume({
      adapterId: 'mock',
      sessionId,
      prompt: 'continue',
      initOptions: {
        cwd: '/tmp',
      },
    });

    const messages = await collectMessages(stream);

    expect(messages).toHaveLength(1);
    expect(init).toHaveBeenCalledWith({ cwd: '/tmp' });
    expect(resume).toHaveBeenCalledWith(sessionId, 'continue', undefined);
    expect(submitPrompt).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes adapter when submitPrompt throws before returning a stream', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi.fn().mockRejectedValue(new Error('submit failed early'));
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'codex',
      init,
      submitPrompt,
      resume: vi.fn(),
      close,
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({ registry });
    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'hello',
      initOptions: {
        cwd: '/tmp',
      },
    });

    await expect(collectMessages(stream)).rejects.toThrow('submit failed early');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes adapter when resume throws before returning a stream', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockRejectedValue(new Error('resume failed early'));
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'claude',
      init,
      submitPrompt: vi.fn(),
      resume,
      close,
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({ registry });
    const stream = await orchestrator.resume({
      adapterId: 'mock',
      sessionId: toAgentSessionId('sess-early-fail'),
      prompt: 'continue',
      initOptions: {
        cwd: '/tmp',
      },
    });

    await expect(collectMessages(stream)).rejects.toThrow('resume failed early');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('persists session ids when a session store is configured', async () => {
    const sessionId = toAgentSessionId('sess-99');
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi
      .fn()
      .mockResolvedValue(toMessageStream([createMessage('system', sessionId)]));
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'claude',
      init,
      submitPrompt,
      resume: vi.fn(),
      close,
    };

    const persist = vi.fn<AgentSessionStore['persist']>().mockResolvedValue();
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      sessionStore: store,
    });
    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'hello',
      initOptions: {
        cwd: '/tmp',
      },
    });

    await collectMessages(stream);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(sessionId, expect.objectContaining({ adapter: 'claude' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('emits session persistence failures as normalized error events', async () => {
    const sessionId = toAgentSessionId('sess-100');
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi
      .fn()
      .mockResolvedValue(toMessageStream([createMessage('assistant', sessionId)]));
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'codex',
      init,
      submitPrompt,
      resume: vi.fn(),
      close,
    };

    const persist = vi.fn<AgentSessionStore['persist']>().mockRejectedValue(new Error('db down'));
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      sessionStore: store,
    });
    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'hello',
      initOptions: {
        cwd: '/tmp',
      },
    });

    const messages = await collectMessages(stream);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.type).toBe('error');
    expect(messages[1]?.subtype).toBe('session_persist_error');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retries transient timeout failures with configured backoff policy', async () => {
    const firstAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi
        .fn()
        .mockResolvedValue(
          toMessageStream([createErrorMessage('timeout', { message: 'timed out' })]),
        ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(toMessageStream([createMessage('result')])),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const adapters = [firstAdapter, secondAdapter];

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => {
      const adapter = adapters.shift();
      if (!adapter) {
        throw new Error('Unexpected adapter request');
      }
      return adapter;
    });

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      retryPolicies: {
        mock: {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 1,
          multiplier: 1,
          jitterRatio: 0,
        },
      },
    });

    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'retry me',
      initOptions: { cwd: '/tmp' },
    });
    const messages = await collectMessages(stream);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.subtype).toBe('timeout');
    expect(messages[1]?.type).toBe('result');
    expect(firstAdapter.submitPrompt).toHaveBeenCalledTimes(1);
    expect(secondAdapter.submitPrompt).toHaveBeenCalledTimes(1);
    expect(firstAdapter.close).toHaveBeenCalledTimes(1);
    expect(secondAdapter.close).toHaveBeenCalledTimes(1);
  });

  it('retries when adapter init fails with a transient timeout error', async () => {
    const firstAdapter = {
      name: 'mock',
      init: vi.fn().mockRejectedValue(new Error('startup timed out')),
      submitPrompt: vi.fn(),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(toMessageStream([createMessage('result')])),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const adapters = [firstAdapter, secondAdapter];

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => {
      const adapter = adapters.shift();
      if (!adapter) {
        throw new Error('Unexpected adapter request');
      }
      return adapter;
    });

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      retryPolicies: {
        mock: {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 1,
          multiplier: 1,
          jitterRatio: 0,
        },
      },
    });

    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'recover init',
      initOptions: { cwd: '/tmp' },
    });
    const messages = await collectMessages(stream);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('result');
    expect(firstAdapter.submitPrompt).not.toHaveBeenCalled();
    expect(secondAdapter.submitPrompt).toHaveBeenCalledTimes(1);
    expect(firstAdapter.close).toHaveBeenCalledTimes(1);
    expect(secondAdapter.close).toHaveBeenCalledTimes(1);
  });

  it('deduplicates session persistence across retry attempts', async () => {
    const sessionId = toAgentSessionId('sess-retry-dedupe');
    const firstAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(
        toMessageStream([
          {
            ...createMessage('system', sessionId),
            subtype: 'init',
          },
          createErrorMessage('timeout', { message: 'timed out' }, sessionId),
        ]),
      ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(
        toMessageStream([
          {
            ...createMessage('system', sessionId),
            subtype: 'init',
          },
          createMessage('result', sessionId),
        ]),
      ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const adapters = [firstAdapter, secondAdapter];

    const persist = vi.fn<AgentSessionStore['persist']>().mockResolvedValue();
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => {
      const adapter = adapters.shift();
      if (!adapter) {
        throw new Error('Unexpected adapter request');
      }
      return adapter;
    });

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      sessionStore: store,
      retryPolicies: {
        mock: {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 1,
          multiplier: 1,
          jitterRatio: 0,
        },
      },
    });

    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'dedupe',
      initOptions: { cwd: '/tmp' },
    });
    await collectMessages(stream);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(sessionId, expect.objectContaining({ adapter: 'mock' }));
  });

  it('refreshes credentials on auth failures and retries immediately', async () => {
    const refreshCredential = vi.fn().mockResolvedValue(undefined);
    const firstAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi
        .fn()
        .mockResolvedValue(
          toMessageStream([createErrorMessage('stderr', { message: '401 unauthorized token' })]),
        ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      getCredentialLifecycleMetadata: vi.fn().mockReturnValue(null),
      refreshCredential,
    };
    const secondAdapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(toMessageStream([createMessage('result')])),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      getCredentialLifecycleMetadata: vi.fn().mockReturnValue(null),
      refreshCredential: vi.fn().mockResolvedValue(undefined),
    };
    const adapters = [firstAdapter, secondAdapter];

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => {
      const adapter = adapters.shift();
      if (!adapter) {
        throw new Error('Unexpected adapter request');
      }
      return adapter;
    });

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      retryPolicies: {
        mock: {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 1,
          multiplier: 1,
          jitterRatio: 0,
        },
      },
    });

    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'auth flow',
      initOptions: { cwd: '/tmp' },
    });
    const messages = await collectMessages(stream);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.subtype).toBe('stderr');
    expect(messages[1]?.type).toBe('result');
    expect(refreshCredential).toHaveBeenCalledTimes(1);
  });

  it('emits normalized error events through the configured sink', async () => {
    const onNormalizedError = vi.fn();
    const adapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi
        .fn()
        .mockResolvedValue(
          toMessageStream([
            createErrorMessage('parse_error', { message: 'bad JSON line' }),
            createMessage('assistant'),
          ]),
        ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      onNormalizedError,
      errorVerbosity: 'compact',
    });

    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'parse issue',
      initOptions: { cwd: '/tmp' },
    });
    await collectMessages(stream);

    expect(onNormalizedError).toHaveBeenCalledTimes(1);
    const [event, envelope] = onNormalizedError.mock.calls[0]!;
    expect(event.category).toBe('parse_malformed');
    expect(event.reason).toBe('parse_error');
    expect(envelope.error_type).toBe('parse_malformed');
    expect(envelope.error_reason).toBe('parse_error');
    expect(envelope.session_id).toBeNull();
  });

  it('emits explicit credential refresh failure errors', async () => {
    const onNormalizedError = vi.fn();
    const adapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi
        .fn()
        .mockResolvedValue(
          toMessageStream([createErrorMessage('stderr', { message: '401 unauthorized token' })]),
        ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      getCredentialLifecycleMetadata: vi.fn().mockReturnValue(null),
      refreshCredential: vi.fn().mockRejectedValue(new Error('refresh endpoint unavailable')),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const orchestrator = new NodeAgentOrchestrator({
      registry,
      onNormalizedError,
      retryPolicies: {
        mock: {
          maxAttempts: 1,
          initialDelayMs: 1,
          maxDelayMs: 1,
          multiplier: 1,
          jitterRatio: 0,
        },
      },
    });

    const stream = await orchestrator.run({
      adapterId: 'mock',
      prompt: 'refresh fails',
      initOptions: { cwd: '/tmp' },
    });
    await collectMessages(stream);

    expect(onNormalizedError).toHaveBeenCalledTimes(2);
    const [, secondEnvelope] = onNormalizedError.mock.calls[1]!;
    expect(secondEnvelope.error_type).toBe('auth_failure');
    expect(secondEnvelope.error_reason).toBe('credential_refresh_failed');
  });
});
