import { describe, expect, it, vi } from 'vitest';
import type { Run } from '../run';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';
import { ProceduralProvider } from './procedural-provider';

type RunPrompt = SessionRunnerFacade['runPrompt'];

const makeProvider = (runPrompt: RunPrompt) => {
  const phases: string[] = [];
  const run = {
    session: { model: 'model-1' },
    observeProviderPhase: (phase: string) => phases.push(phase),
    captureProviderOutput: async (execute: () => Promise<void>) => {
      await execute();
      return 'answer';
    },
  } as unknown as Run;
  const providers = { runPrompt } as unknown as SessionRunnerFacade;
  return { provider: new ProceduralProvider(run, providers), phases };
};

describe('ProceduralProvider activity', () => {
  it('reports thinking while the provider call is pending and idle once it succeeds', async () => {
    let finish!: () => void;
    const runPrompt = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ errorCount: 0 });
        }),
    ) as unknown as RunPrompt;
    const { provider, phases } = makeProvider(runPrompt);

    const pending = provider.generate('p', new AbortController().signal);
    expect(phases).toEqual(['thinking']);

    finish();
    await expect(pending).resolves.toBe('answer');
    expect(phases).toEqual(['thinking', 'idle']);
  });

  it('returns to idle when the provider call fails or is aborted', async () => {
    const failing = makeProvider(vi.fn(async () => ({ errorCount: 1 })) as unknown as RunPrompt);
    await expect(failing.provider.generate('p', new AbortController().signal)).rejects.toThrow();
    expect(failing.phases).toEqual(['thinking', 'idle']);

    const aborted = makeProvider(
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      }) as unknown as RunPrompt,
    );
    await expect(aborted.provider.generate('p', new AbortController().signal)).rejects.toThrow();
    expect(aborted.phases).toEqual(['thinking', 'idle']);
  });

  it('gives each call its own working interval', async () => {
    const { provider, phases } = makeProvider(
      vi.fn(async () => ({ errorCount: 0 })) as unknown as RunPrompt,
    );
    await provider.generate('a', new AbortController().signal);
    await provider.generate('b', new AbortController().signal);
    expect(phases).toEqual(['thinking', 'idle', 'thinking', 'idle']);
  });
});
