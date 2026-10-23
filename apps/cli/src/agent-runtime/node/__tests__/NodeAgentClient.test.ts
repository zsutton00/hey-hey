import { describe, expect, it, vi } from 'vitest';
import { AgentAdapterRegistry, toAgentSessionId, type AgentMessage } from '../../core/index';
import type { MessageStream } from '../../core/index';
import { NodeAgentClient } from '../NodeAgentClient';

const toMessageStream = (messages: AgentMessage[]): MessageStream =>
  (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();

const collectMessages = async (stream: MessageStream): Promise<AgentMessage[]> => {
  const messages: AgentMessage[] = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

describe('NodeAgentClient', () => {
  it('runs prompts through configured adapter and persists session metadata', async () => {
    const sessionId = toAgentSessionId('sess-client-run');
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi.fn().mockResolvedValue(
      toMessageStream([
        {
          type: 'system',
          subtype: 'init',
          sessionId,
          content: [{ kind: 'text', payload: 'init' }],
          timestamp: Date.now(),
        },
        {
          type: 'assistant',
          sessionId,
          content: [{ kind: 'text', payload: 'hello' }],
          timestamp: Date.now(),
        },
      ]),
    );
    const resume = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = { name: 'mock', init, submitPrompt, resume, close };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      promptOptions: { timeoutMs: 2_000 },
      registry,
    });

    const messages = await collectMessages(await client.run('hello world', { timeoutMs: 500 }));

    expect(messages).toHaveLength(2);
    expect(init).toHaveBeenCalledWith({ cwd: '/tmp' });
    expect(submitPrompt).toHaveBeenCalledWith('hello world', {
      timeoutMs: 500,
    });
    expect(resume).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(
      submitPrompt.mock.invocationCallOrder[0]!,
    );

    await expect(client.getSessionMetadata(sessionId)).resolves.toEqual(
      expect.objectContaining({
        adapter: 'mock',
      }),
    );
  });

  it('resumes prompts through configured adapter', async () => {
    const sessionId = toAgentSessionId('sess-client-resume');
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi.fn();
    const resume = vi.fn().mockResolvedValue(
      toMessageStream([
        {
          type: 'result',
          sessionId,
          content: [{ kind: 'result', payload: { done: true } }],
          timestamp: Date.now(),
        },
      ]),
    );
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = { name: 'mock', init, submitPrompt, resume, close };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      promptOptions: { timeoutMs: 2_000 },
      registry,
    });

    const messages = await collectMessages(
      await client.resume(sessionId, 'continue', { timeoutMs: 250 }),
    );

    expect(messages).toHaveLength(1);
    expect(resume).toHaveBeenCalledWith(sessionId, 'continue', {
      timeoutMs: 250,
    });
    expect(submitPrompt).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates stream errors and still closes adapter', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const submitPrompt = vi.fn().mockResolvedValue(
      (async function* () {
        throw new Error('stream failure');
      })(),
    );
    const close = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      name: 'mock',
      init,
      submitPrompt,
      resume: vi.fn(),
      close,
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      registry,
    });

    const stream = await client.run('boom');
    await expect(collectMessages(stream)).rejects.toThrow('stream failure');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('runWithSession returns stream plus captured session id', async () => {
    const sessionId = toAgentSessionId('sess-run-with-session');
    const adapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(
        toMessageStream([
          {
            type: 'assistant',
            sessionId,
            content: [{ kind: 'text', payload: 'hello' }],
            timestamp: Date.now(),
          },
          {
            type: 'system',
            subtype: 'init',
            sessionId,
            content: [{ kind: 'text', payload: 'init' }],
            timestamp: Date.now(),
          },
        ]),
      ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      registry,
    });

    const { stream, sessionIdPromise } = await client.runWithSession('hello');
    const messages = await collectMessages(stream);
    const capturedSessionId = await sessionIdPromise;

    expect(messages).toHaveLength(2);
    expect(capturedSessionId).toBe(sessionId);
  });

  it('runWithSession resolves null when no session id appears', async () => {
    const adapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(
        toMessageStream([
          {
            type: 'assistant',
            sessionId: null,
            content: [{ kind: 'text', payload: 'hello' }],
            timestamp: Date.now(),
          },
        ]),
      ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      registry,
    });

    const { stream, sessionIdPromise } = await client.runWithSession('hello');
    await collectMessages(stream);
    await expect(sessionIdPromise).resolves.toBeNull();
  });

  it('resumeWithSession falls back to provided session id when stream omits it', async () => {
    const providedSessionId = toAgentSessionId('sess-resume-fallback');
    const adapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn(),
      resume: vi.fn().mockResolvedValue(
        toMessageStream([
          {
            type: 'assistant',
            sessionId: null,
            content: [{ kind: 'text', payload: 'continued' }],
            timestamp: Date.now(),
          },
        ]),
      ),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      registry,
    });

    const { stream, sessionIdPromise } = await client.resumeWithSession(
      providedSessionId,
      'continue',
    );
    await collectMessages(stream);
    await expect(sessionIdPromise).resolves.toBe(providedSessionId);
  });

  it('runWithSession timeout resolves quickly using observed fallback session id', async () => {
    const fallbackSessionId = toAgentSessionId('sess-fallback-timeout');
    const adapter = {
      name: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      submitPrompt: vi.fn().mockResolvedValue(
        (async function* () {
          yield {
            type: 'assistant' as const,
            sessionId: fallbackSessionId,
            content: [{ kind: 'text' as const, payload: 'working' }],
            timestamp: Date.now(),
          };
          await new Promise((resolve) => setTimeout(resolve, 25));
          yield {
            type: 'result' as const,
            sessionId: null,
            content: [{ kind: 'result' as const, payload: 'done' }],
            timestamp: Date.now(),
          };
        })(),
      ),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const registry = new AgentAdapterRegistry();
    registry.register('mock', () => adapter);

    const client = new NodeAgentClient({
      adapterId: 'mock',
      initOptions: { cwd: '/tmp' },
      registry,
    });

    const { stream, sessionIdPromise } = await client.runWithSession('hello', undefined, {
      sessionIdTimeoutMs: 5,
    });

    await expect(sessionIdPromise).resolves.toBe(fallbackSessionId);
    await collectMessages(stream);
  });
});
