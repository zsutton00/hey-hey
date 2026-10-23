import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    serviceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeRunStoreSpy = () => {
  const store = createTestRunStore();
  const updateRunTriggerContext = vi
    .spyOn(store, 'updateRunTriggerContext')
    .mockImplementation(
      async (
        _runId: string,
        context: { externalAgentNodeId: string | null; triggerMessageId: string | null },
      ) =>
        makeSession({
          triggerExternalAgentNodeId: context.externalAgentNodeId,
          triggerMessageId: context.triggerMessageId,
        }),
    );
  return { updateRunTriggerContext, store };
};

const makeCollaborators = (runStore: RunStore): RunCollaborators => ({
  runStore,
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const flushMicrotasks = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

describe('Run trigger context persistence', () => {
  it('persists the complete pair in one write when stamped atomically', async () => {
    const spy = makeRunStoreSpy();
    const run = new Run(makeRunArgs(), makeCollaborators(spy.store));

    run.setTriggerContext({ externalAgentNodeId: 'node-A', triggerMessageId: 'msg-A' });

    await flushMicrotasks();

    // Exactly one write — the pair lands atomically, no intermediate state.
    expect(spy.updateRunTriggerContext).toHaveBeenCalledTimes(1);
    expect(spy.updateRunTriggerContext).toHaveBeenCalledWith('run-1', {
      externalAgentNodeId: 'node-A',
      triggerMessageId: 'msg-A',
    });
  });

  it('skips persistence when the pair is unchanged', async () => {
    const spy = makeRunStoreSpy();
    const run = new Run(makeRunArgs(), makeCollaborators(spy.store));

    run.setTriggerContext({ externalAgentNodeId: 'node-A', triggerMessageId: 'msg-A' });
    await flushMicrotasks();
    spy.updateRunTriggerContext.mockClear();

    run.setTriggerContext({ externalAgentNodeId: 'node-A', triggerMessageId: 'msg-A' });
    await flushMicrotasks();

    expect(spy.updateRunTriggerContext).not.toHaveBeenCalled();
  });

  it('rehydrates trigger context from the persisted session without re-persisting', async () => {
    const spy = makeRunStoreSpy();
    const session = makeSession({
      triggerExternalAgentNodeId: 'node-prior',
      triggerMessageId: 'msg-prior',
    });
    const run = new Run(makeRunArgs({ session }), makeCollaborators(spy.store));

    expect(run.getTriggerContext()).toEqual({
      externalAgentNodeId: 'node-prior',
      triggerMessageId: 'msg-prior',
    });

    await flushMicrotasks();
    expect(spy.updateRunTriggerContext).not.toHaveBeenCalled();
  });

  it('does not rehydrate when only one id is present in the session', async () => {
    const spy = makeRunStoreSpy();
    const session = makeSession({ triggerExternalAgentNodeId: 'node-prior' });
    const run = new Run(makeRunArgs({ session }), makeCollaborators(spy.store));

    expect(run.getTriggerContext()).toBeNull();
    await flushMicrotasks();
    expect(spy.updateRunTriggerContext).not.toHaveBeenCalled();
  });

  it('clears persisted trigger context on stop()', async () => {
    const spy = makeRunStoreSpy();
    const session = makeSession({
      triggerExternalAgentNodeId: 'node-prior',
      triggerMessageId: 'msg-prior',
    });
    const run = new Run(makeRunArgs({ session }), makeCollaborators(spy.store));

    await run.stop();
    await flushMicrotasks();

    expect(run.getTriggerContext()).toBeNull();
    expect(spy.updateRunTriggerContext).toHaveBeenCalledWith('run-1', {
      externalAgentNodeId: null,
      triggerMessageId: null,
    });
  });

  it('does not persist on cleanup() — context must survive into the next process', () => {
    const spy = makeRunStoreSpy();
    const session = makeSession({
      triggerExternalAgentNodeId: 'node-prior',
      triggerMessageId: 'msg-prior',
    });
    const run = new Run(makeRunArgs({ session }), makeCollaborators(spy.store));

    run.cleanup();

    expect(spy.updateRunTriggerContext).not.toHaveBeenCalled();
  });

  it('incident replay: setTriggerContext(null) clears both fields atomically — no half-null pair', async () => {
    // Regression for the production incident. Pre-fix code stored
    // externalAgentNodeId and triggerMessageId as separate mutable fields. A
    // user-message dispatch that only updated triggerMessageId left
    // externalAgentNodeId stale, producing a mixed-provenance pair that the
    // pending-completion path then stamped onto an outgoing envelope.
    //
    // The fix: the pair is always written and cleared as a single atomic unit
    // via setTriggerContext. This test verifies the atomic-clear invariant:
    // after setTriggerContext(null), getTriggerContext() must return null —
    // never a partial { externalAgentNodeId: 'node-A', triggerMessageId: null }
    // or any other half-populated state that the pre-fix per-field code could
    // produce.
    const spy = makeRunStoreSpy();
    const run = new Run(makeRunArgs(), makeCollaborators(spy.store));

    // Step 1: node-paired dispatch stamps the complete pair atomically.
    run.setTriggerContext({ externalAgentNodeId: 'node-A', triggerMessageId: 'msg-A' });
    await flushMicrotasks();
    expect(run.getTriggerContext()).toEqual({
      externalAgentNodeId: 'node-A',
      triggerMessageId: 'msg-A',
    });

    // Step 2: user-message dispatch — the wire resolver finds no pending agent
    // node and calls setTriggerContext(null). Both fields must clear together.
    // Pre-fix code would only update triggerMessageId here (to the user message's
    // id), leaving externalAgentNodeId as 'node-A' — a mixed pair.
    spy.updateRunTriggerContext.mockClear();
    run.setTriggerContext(null);
    await flushMicrotasks();

    // The pair must be null (fully cleared), not a mixed partial object.
    expect(run.getTriggerContext()).toBeNull();
    // Persisted with both fields null — no remnant of node-A.
    expect(spy.updateRunTriggerContext).toHaveBeenCalledWith('run-1', {
      externalAgentNodeId: null,
      triggerMessageId: null,
    });
  });
});
