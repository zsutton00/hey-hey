import { describe, expect, it, vi } from 'vitest';
import {
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { PromptOnceArgs } from '../agents/providers/session-runner';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunCollaborators } from './run';

const handler: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  defaultReasoningEffort: 'low',
  reports: [],
  buildPrompt: () => 'A system prompt',
};

// The deps the Run hands to prompt resolution are what handlers' `prepare` receives.
let onResolvePrompt: (deps: PromptTypeHandlerDeps) => Promise<void> = async () => {};
vi.mock('./resolve-prompt', () => ({
  resolvePrompt: async (args: { handlerDeps: PromptTypeHandlerDeps }) => {
    await onResolvePrompt(args.handlerDeps);
    return {
      resolvedPrompt: 'resolved',
      startingMessage: undefined,
      sessionContext: undefined,
      preparedPayload: undefined,
      isSubagentOwned: false,
      consumedPreviousProviderSession: false,
      promptTypeChanged: false,
    };
  },
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-existing',
    provider_conversation_id: 'conv-existing',
    provider_session_agent_id: 'coding_freeform',
    status: 'idle',
    model: 'session-model',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
    promptType: 'coding_freeform',
  }) as unknown as AgenticSession;

const makeRun = (promptOnce: (args: PromptOnceArgs) => Promise<string>) => {
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'getRun').mockResolvedValue(null);
  const runnerPicker = createTestRunnerPicker();
  vi.spyOn(runnerPicker, 'runnerFor').mockReturnValue({ promptOnce } as never);
  const collaborators: RunCollaborators = {
    runStore,
    repoStore: createTestRepoMappingStore(),
    poster: createTestMessagePoster(),
    broadcaster: createTestRunEventPublisher(),
    ...createTestRunOwnership(() => handler),
    handlerDeps: {} as never,
    runnerPicker,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'],
  };
  return new Run(
    {
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      provider: 'claude',
      session: makeSession(),
      hasProviderSession: true,
    },
    collaborators,
  );
};

const input = {
  promptType: 'coding_freeform',
  payload: { promptType: 'coding_freeform', userMessage: 'go' },
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
} as unknown as InternalRunPromptRequest;

const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('Run-bound promptOnce for handler prepare', () => {
  it("answers on the Run's runner with the Turn's model, effort and abort signal", async () => {
    const promptOnce = vi.fn(async () => 'search for jev');
    let answer: string | null = null;
    onResolvePrompt = async (deps) => {
      answer = await deps.promptOnce({ prompt: 'plan searches' });
    };

    await makeRun(promptOnce).handleMessage(input);
    await settle();

    expect(answer).toBe('search for jev');
    expect(promptOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'plan searches',
        model: 'session-model',
        reasoningEffort: 'low',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('cancels an in-flight call when the Turn is aborted', async () => {
    let seenSignal: AbortSignal | null = null;
    const promptOnce = vi.fn(
      (args: PromptOnceArgs) =>
        new Promise<string>((_resolve, reject) => {
          seenSignal = args.signal;
          args.signal.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
    let outcome: unknown = null;
    onResolvePrompt = async (deps) => {
      outcome = await deps.promptOnce({ prompt: 'plan' }).catch((error: unknown) => error);
    };
    const run = makeRun(promptOnce);

    const started = run.handleMessage(input);
    await vi.waitFor(() => expect(seenSignal).not.toBeNull());
    run.abort();
    await started;
    await settle();

    expect((seenSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(outcome).toEqual(new Error('Aborted'));
  });

  it('lets a runner failure reach the handler', async () => {
    const promptOnce = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    let outcome: unknown = null;
    onResolvePrompt = async (deps) => {
      outcome = await deps.promptOnce({ prompt: 'plan' }).catch((error: unknown) => error);
    };

    await makeRun(promptOnce).handleMessage(input);
    await settle();

    expect(outcome).toEqual(new Error('model unavailable'));
  });

  const observedPhases = (run: Run): (() => string[]) => {
    const spy = vi.spyOn(run, 'observeProviderPhase');
    return () => spy.mock.calls.map(([phase]) => phase);
  };

  it('sets the start phase when the call begins and holds it when no end phase is named', async () => {
    let phasesDuringCall: string[] = [];
    let phasesAfterCall: string[] = [];
    const run = makeRun(
      vi.fn(async () => {
        phasesDuringCall = phases();
        return 'ok';
      }),
    );
    const phases = observedPhases(run);
    onResolvePrompt = async (deps) => {
      await deps.promptOnce({ prompt: 'plan', startPhase: 'gathering_context' });
      phasesAfterCall = phases();
    };

    let stateAfterCall: string | undefined;
    const originalResolve = onResolvePrompt;
    onResolvePrompt = async (deps) => {
      await originalResolve(deps);
      stateAfterCall = run.effectiveState?.currentState;
    };

    await run.handleMessage(input);
    await settle();

    expect(phasesDuringCall.at(-1)).toBe('gathering_context');
    expect(stateAfterCall).toBe('GATHERING_CONTEXT');
    expect(phasesAfterCall.at(-1)).toBe('gathering_context');
  });

  it('sets the end phase when the call settles, even on failure', async () => {
    const run = makeRun(
      vi.fn(async () => {
        throw new Error('model unavailable');
      }),
    );
    const phases = observedPhases(run);
    let phasesAfterCall: string[] = [];
    onResolvePrompt = async (deps) => {
      await deps
        .promptOnce({ prompt: 'plan', startPhase: 'gathering_context', endPhase: 'thinking' })
        .catch(() => undefined);
      phasesAfterCall = phases();
    };

    await run.handleMessage(input);
    await settle();

    expect(phasesAfterCall.slice(-2)).toEqual(['gathering_context', 'thinking']);
  });

  it('leaves the state unchanged when no phases are named', async () => {
    const run = makeRun(vi.fn(async () => 'ok'));
    const phases = observedPhases(run);
    let before: string[] = [];
    let after: string[] = [];
    onResolvePrompt = async (deps) => {
      before = phases();
      await deps.promptOnce({ prompt: 'plan' });
      after = phases();
    };

    await run.handleMessage(input);
    await settle();

    expect(after).toEqual(before);
  });

  it('returns to idle when preparation fails after gathering context began', async () => {
    const run = makeRun(vi.fn(async () => 'ok'));
    const phases = observedPhases(run);
    onResolvePrompt = async (deps) => {
      await deps.promptOnce({ prompt: 'plan', startPhase: 'gathering_context' });
      throw new Error('gather failed');
    };

    await run.handleMessage(input).catch(() => undefined);
    await settle();

    expect(phases()).toContain('gathering_context');
    expect(run.effectiveState?.currentState).toBe('IDLE');
  });

  it("keeps gathering context through the provider session's launch until its first activity", () => {
    const run = makeRun(vi.fn(async () => 'ok'));

    run.observeProviderPhase('gathering_context');
    run.observeProviderSessionPhase('starting');
    expect(run.effectiveState?.currentState).toBe('GATHERING_CONTEXT');

    run.observeProviderSessionPhase('thinking');
    expect(run.effectiveState?.currentState).toBe('THINKING');
  });

  it('still shows starting when the provider session launches without gathering context', () => {
    const run = makeRun(vi.fn(async () => 'ok'));

    run.observeProviderSessionPhase('starting');

    expect(run.effectiveState?.currentState).toBe('STARTING');
  });
});
