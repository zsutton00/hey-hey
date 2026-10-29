import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { Turn } from '../turn/turn';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import type {
  MessagePosterCreateOutOfBandArgs,
  MessagePosterExternalAgentCompletionArgs,
  PendingTurnCompletion,
} from './types';
import type { MessagePoster } from './message-poster';
import { createPromptTypeHandlerTestDeps } from '../agents/prompt-type-handler.test-support';
import { WorkflowDispatchVerdictReader } from '../server/services/workflow-dispatch-verdict';

// Bypass the heavy resolver / registry / reference validator so the test can
// drive Run.handleMessage end-to-end with a synthetic subagent handler.
const handlerStub: PromptTypeHandler<unknown> = {
  id: 'commit',
  promptType: 'commit',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'subagent',
  providerSessionCountsForContext: false,
  reports: [],
  buildPrompt: () => 'unused',
};

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: async () => ({
    resolvedPrompt: 'resolved',
    startingMessage: undefined,
    sessionContext: undefined,
    preparedPayload: undefined,
    isSubagentOwned: true,
    consumedPreviousProviderSession: false,
  }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
    },
    events: [],
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  hasProviderSession: true,
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = (createOutOfBand?: MessagePoster['createOutOfBand']) =>
  createTestMessagePoster({
    createOutOfBand:
      createOutOfBand ?? vi.fn(async (_args: MessagePosterCreateOutOfBandArgs) => 'msg-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunTriggerContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getTouchedFiles').mockResolvedValue([]);
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeCollaborators = (
  poster: RunCollaborators['poster'],
  pickRunner: (ctx: RunnerContext) => Runner,
  handlerDeps: PromptTypeHandlerDeps = {} as unknown as PromptTypeHandlerDeps,
  handler: PromptTypeHandler<unknown> = handlerStub,
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster,
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(() => handler),
  handlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: {
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeInput = (): InternalRunPromptRequest =>
  ({
    promptType: 'commit',
    payload: { promptType: 'commit', userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerContext: { externalAgentNodeId: 'node-1', triggerMessageId: 'trigger-1' },
  }) as unknown as InternalRunPromptRequest;

const PENDING: PendingTurnCompletion = {
  action: { action: 'NO_DISCREPANCY' },
  externalAgentNodeId: 'node-1',
  triggerMessageId: 'trigger-1',
  stamp: null,
};

/** A raw assistant_complete event in the shape `onAgentOutput` consumes. */
const assistantCompleteMessage = (summary: string) => ({
  event: {
    source: 'provider' as const,
    eventType: 'agent_output',
    timestamp: '2026-01-01T00:00:00.000Z',
    sessionId: 'prov-1',
    agentId: 'claude',
    payload: { messageType: 'assistant', taskComplete: true, summary },
  },
});

const completionCall = (
  poster: MessagePoster,
): MessagePosterExternalAgentCompletionArgs | undefined =>
  (poster.submitExternalAgentCompletion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | MessagePosterExternalAgentCompletionArgs
    | undefined;

describe('Run.flushPendingCompletion', () => {
  it.each([
    ['success', { action: 'success', payload: { outcome: 'success' } }],
    [
      'retryable failure',
      { action: 'retryable_failure', payload: { outcome: 'retryable_failure' } },
    ],
    ['terminal failure', { action: 'terminal_failure', payload: { outcome: 'terminal_failure' } }],
  ])(
    'retries the same %s outcome and identities after delivery failure',
    async (_label, action) => {
      const poster = makePoster();
      vi.mocked(poster.submitExternalAgentCompletion)
        .mockRejectedValueOnce(new Error('connection lost before acknowledgement'))
        .mockResolvedValueOnce('completion-message-1');
      const run = new Run(
        makeRunArgs(),
        makeCollaborators(poster, () => ({ run: async () => {} })),
      );

      run.recordPendingCompletion({ ...PENDING, action });
      await run.flushPendingCompletion();
      await run.flushPendingCompletion();

      expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(2);
      const [first, second] = vi
        .mocked(poster.submitExternalAgentCompletion)
        .mock.calls.map(([args]) => args);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) throw new Error('Expected two completion delivery attempts');
      expect(second.effectId).toBe(first.effectId);
      expect(second.request.pendingTriggerMessageId).toBe(first.request.pendingTriggerMessageId);
      expect(second.request.action).toBe(action.action);
    },
  );

  it.each(['claude', 'codex', 'opencode'] as const)(
    'retains real %s Run completion for result reads',
    async (provider) => {
      const poster = makePoster();
      let run: Run;
      const collaborators = makeCollaborators(poster, () => ({
        run: async () => {
          run.onAgentOutput(assistantCompleteMessage('Retained answer'));
        },
      }));
      const store = collaborators.runStore;
      vi.mocked(store.updateRunLatestTurn).mockRestore();
      await store.initialize();
      const session = await store.createRun({
        agentic_session_id: 'run-1',
        provider_session_id: 'prov-1',
        provider,
        entity: null,
        conversationId: 'conv-1',
        services: [{ id: 'svc-1', path: '/tmp/repo' }],
        launchServiceId: 'svc-1',
        contextMetadata: {
          capturedAt: new Date().toISOString(),
          organizationId: 'org-1',
          projectId: 'proj-1',
          agentSessionId: 'agent-session-1',
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      });
      run = new Run(makeRunArgs({ provider, session }), collaborators);
      await run.handleMessage(makeInput());
      await run.awaitIdle();
      expect(await store.getRunResult('run-1')).toMatchObject({
        assistantCompleted: true,
        outputText: 'Retained answer',
      });
    },
  );

  it('keeps execution and cleanup working when latest-result writes fail', async () => {
    const runner = vi.fn(async () => {});
    const collaborators = makeCollaborators(makePoster(), () => ({ run: runner }));
    vi.mocked(collaborators.runStore.updateRunLatestTurn).mockRejectedValue(
      new Error('disk unavailable'),
    );
    const run = new Run(makeRunArgs(), collaborators);
    await run.handleMessage(makeInput());
    await run.awaitIdle();
    expect(runner).toHaveBeenCalledOnce();
    expect(run.activeTurn).toBeNull();
  });

  it('preserves begin-failure cleanup when latest-result writes fail', async () => {
    const collaborators = makeCollaborators(makePoster(), () => ({ run: async () => {} }));
    vi.mocked(collaborators.runStore.updateRunLatestTurn).mockRejectedValue(
      new Error('disk unavailable'),
    );
    const begin = vi
      .spyOn(Turn.prototype, 'begin')
      .mockRejectedValueOnce(new Error('begin failed'));
    const run = new Run(makeRunArgs(), collaborators);
    try {
      await expect(run.handleMessage(makeInput())).rejects.toThrow('begin failed');
      expect(collaborators.logger.error).toHaveBeenCalledWith(
        'local.run.start_turn.begin_failed',
        expect.anything(),
      );
    } finally {
      begin.mockRestore();
    }
  });

  it('serializes concurrent flushes into one acknowledged delivery', async () => {
    let acknowledge!: (messageId: string) => void;
    const poster = makePoster();
    vi.mocked(poster.submitExternalAgentCompletion).mockImplementationOnce(
      () => new Promise<string>((resolve) => (acknowledge = resolve)),
    );
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => {} })),
    );
    run.recordPendingCompletion(PENDING);

    const first = run.flushPendingCompletion();
    const duplicate = run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    acknowledge('completion-message-1');
    await Promise.all([first, duplicate]);
    await run.flushPendingCompletion();

    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
  });

  it('retries a retained completion from reconnect without executing another turn', async () => {
    const poster = makePoster();
    vi.mocked(poster.submitExternalAgentCompletion)
      .mockRejectedValueOnce(new Error('acknowledgement lost'))
      .mockResolvedValueOnce('completion-message-1');
    const pickRunner = vi.fn(() => ({ run: async () => {} }));
    const run = new Run(makeRunArgs(), makeCollaborators(poster, pickRunner));
    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();

    run.emitCurrentStateIfActive();
    await vi.waitFor(() => expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(2));

    expect(pickRunner).not.toHaveBeenCalled();
    expect(vi.mocked(poster.submitExternalAgentCompletion).mock.calls[1]![0].effectId).toBe(
      vi.mocked(poster.submitExternalAgentCompletion).mock.calls[0]![0].effectId,
    );
  });

  it('does not become reapable while an unacknowledged completion is retained', async () => {
    const poster = makePoster();
    vi.mocked(poster.submitExternalAgentCompletion)
      .mockRejectedValueOnce(new Error('connection lost before acknowledgement'))
      .mockResolvedValueOnce('completion-message-1');
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => {} })),
    );
    const isGenuinelyIdle = () =>
      (run as unknown as { isGenuinelyIdle(): boolean }).isGenuinelyIdle();
    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();

    expect(isGenuinelyIdle()).toBe(false);

    await run.flushPendingCompletion();

    expect(isGenuinelyIdle()).toBe(true);
  });

  it('logs the completion identity and session context when the flush fails', async () => {
    const poster = makePoster();
    const failure = new Error('completion rejected');
    vi.mocked(poster.submitExternalAgentCompletion).mockRejectedValue(failure);
    const collaborators = makeCollaborators(poster, () => ({ run: async () => {} }));
    const run = new Run(makeRunArgs(), collaborators);

    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();

    expect(collaborators.logger.error).toHaveBeenCalledWith(
      'local.run.pending_completion.flush_failed',
      expect.objectContaining({
        runId: 'run-1',
        agentSessionId: 'agent-session-1',
        conversationId: 'conv-1',
        workflowNodeId: 'node-1',
        pendingTriggerMessageId: 'trigger-1',
        action: 'NO_DISCREPANCY',
        error: failure,
      }),
    );
  });

  it('flushes a recorded completion exactly once and is a no-op on re-flush', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => {} })),
    );

    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();
    await run.flushPendingCompletion();

    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(completionCall(poster)?.request).toMatchObject({
      workflowNodeId: 'node-1',
      action: 'NO_DISCREPANCY',
      pendingTriggerMessageId: 'trigger-1',
    });
  });

  it('retains the first terminal outcome and refuses repeats before and after flush', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => {} })),
    );
    run.recordPendingCompletion({ ...PENDING, action: { action: 'ERROR' } });
    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();
    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(completionCall(poster)?.request.action).toBe('ERROR');
  });

  it('flushes a handler-owned runner failure as the typed external-agent completion', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => undefined })),
    );
    const handler: PromptTypeHandler<unknown> = {
      id: 'repository-analysis',
      promptType: 'repository_grounding',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => 'unused',
      getRunnerFailureAction: () => ({
        action: {
          action: 'retryable_failure',
          payload: {
            outcome: 'retryable_failure',
            code: 'provider_unavailable',
            message: 'Retry the repository analysis.',
          },
        },
        hidden: true,
        userFacingResponse: '',
      }),
    };
    const turn = new Turn({
      effectiveRole: 'implementation',
      turnId: 'turn-runner-failure',
      runId: 'run-1',
      resolvedPrompt: 'resolved',
      handler,
      payload: { accepted: true },
      externalAgentNodeId: 'node-runner-failure',
      triggerMessageId: 'trigger-runner-failure',
      runner: { run: async () => undefined },
      platformMcpProxy: null,
      abortController: new AbortController(),
      logger: makeCollaborators(poster, () => ({ run: async () => undefined })).logger,
      owner: run,
      effectiveModel: null,
      effectiveReasoningEffort: null,
    });

    await run.onTurnRunnerFailed(turn, new Error('provider unavailable'));
    await run.flushPendingCompletion();

    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(completionCall(poster)?.request).toMatchObject({
      workflowNodeId: 'node-runner-failure',
      action: 'retryable_failure',
      pendingTriggerMessageId: 'trigger-runner-failure',
      payload: {
        outcome: 'retryable_failure',
        code: 'provider_unavailable',
      },
    });
  });

  it('is a no-op when no completion was recorded', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => {} })),
    );

    await run.flushPendingCompletion();

    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it('can flush one accepted retry after an earlier correctable rejection recorded nothing', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({ run: async () => {} })),
    );

    // A correctable rejection leaves no pending completion. An attempted flush
    // is therefore a no-op and does not consume the original trigger identity.
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();

    run.recordPendingCompletion(PENDING);
    await run.flushPendingCompletion();
    await run.flushPendingCompletion();

    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(completionCall(poster)?.request).toMatchObject({
      workflowNodeId: 'node-1',
      pendingTriggerMessageId: 'trigger-1',
      action: 'NO_DISCREPANCY',
    });
  });
});

describe('Run.drainInFlightDispatch', () => {
  it('reports a slow dispatch but keeps the drain pending for its authoritative write', async () => {
    let resolveNarrative!: (messageId: string) => void;
    let releaseRunner!: () => void;
    let markRunnerStarted!: () => void;
    const runnerStarted = new Promise<void>((resolve) => {
      markRunnerStarted = resolve;
    });
    const delayedPoster = makePoster(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveNarrative = resolve;
          }),
      ) as MessagePoster['createOutOfBand'],
    );
    const collaborators = makeCollaborators(delayedPoster, () => ({
      run: async () => {
        markRunnerStarted();
        await new Promise<void>((resolve) => {
          releaseRunner = resolve;
        });
      },
    }));
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput());
    await runnerStarted;
    run.onAgentOutput(assistantCompleteMessage('delayed narrative'));
    await vi.waitFor(() => expect(delayedPoster.createOutOfBand).toHaveBeenCalledTimes(1));

    let drained = false;
    const drain = run.drainInFlightDispatch(20).then(() => {
      drained = true;
    });
    await vi.waitFor(() =>
      expect(collaborators.logger.warn).toHaveBeenCalledWith(
        'local.run.in_flight_dispatch.slow',
        expect.objectContaining({ runId: 'run-1', timeoutMs: 20, pendingDispatchCount: 1 }),
      ),
    );
    expect(drained).toBe(false);

    resolveNarrative('message-1');
    await drain;
    expect(drained).toBe(true);
    releaseRunner();
    await run.awaitIdle();
  });

  it('does not make an async readiness-node lookup wait on its own dispatch', async () => {
    const poster = makePoster();
    const getConversationWorkflowNode = vi.fn().mockResolvedValue({
      data: {
        data: {
          currentNodeId: 'feature-sync-implementation-readiness-review',
          workflowName: 'feature-sync',
        },
      },
    });
    const workflowDispatchVerdictReader = new WorkflowDispatchVerdictReader({
      getConversationPromptType: vi.fn(),
      getConversationWorkflowNode,
    });
    const readinessHandler = {
      ...handlerStub,
      expectedResponseTypes: ['implementation_readiness_v1'],
    } as PromptTypeHandler<unknown>;
    const summary = JSON.stringify({
      responseType: 'implementation_readiness_v1',
      disposition: {
        state: 'REVIEW_REQUIRED',
        sourceSnapshot: {
          runId: 'run-1',
          focalEntityId: 'task-1',
          focalEntityType: 'TASK',
          sourceRevision: 'sha256:source-revision',
          capturedAt: '2026-09-20T00:00:00.000Z',
        },
        finding: {
          affectedSourceContext: 'The task and its project context',
          unresolvedDecision: 'Which service owns the persisted disposition?',
          consequentialInventionRisk: 'Coding would otherwise invent observable behavior.',
          boundedEvidence: [
            {
              category: 'ownership',
              statement: 'The source does not identify the owning service.',
            },
          ],
          answerKind: 'Name the authoritative owner.',
        },
        resolution: { kind: 'NONE' },
      },
    });
    let run!: Run;
    const collaborators = makeCollaborators(
      poster,
      () => ({
        run: async () => {
          run.onAgentOutput(assistantCompleteMessage(summary));
        },
      }),
      {} as PromptTypeHandlerDeps,
      readinessHandler,
    );
    collaborators.workflowDispatchVerdictReader = workflowDispatchVerdictReader;
    run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(getConversationWorkflowNode).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(vi.mocked(poster.createOutOfBand).mock.calls[0]?.[0].dto.data).toMatchObject({
      processResponseType: 'implementation_readiness_v1',
      nodeId: 'feature-sync-implementation-readiness-review',
    });
    expect(collaborators.logger.warn).not.toHaveBeenCalledWith(
      'local.run.in_flight_dispatch.slow',
      expect.anything(),
    );
  });
});

describe('Run turn-end completion flush ordering', () => {
  it('flushes the completion after the trailing narrative settles (trailing-narrative turn)', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({
        run: async () => {
          // A submission tool records the completion mid-turn...
          run.recordPendingCompletion(PENDING);
          // ...then the agent emits a trailing narrative whose dispatch posts
          // to the conversation tail.
          run.onAgentOutput(assistantCompleteMessage('All done.'));
        },
      })),
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    const narrativeOrder = vi.mocked(poster.createOutOfBand).mock.invocationCallOrder[0];
    const completionOrder = vi.mocked(poster.submitExternalAgentCompletion).mock
      .invocationCallOrder[0];
    expect(narrativeOrder).toBeLessThan(completionOrder!);
    expect(completionCall(poster)?.request).toMatchObject({
      action: 'NO_DISCREPANCY',
    });
  });

  it('flushes exactly one completion on a turn that produces no narrative (no-narrative turn)', async () => {
    const poster = makePoster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({
        run: async () => {
          run.recordPendingCompletion(PENDING);
        },
      })),
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    const completion = completionCall(poster);
    expect(completion).toBeDefined();
    expect(completion!.request).toMatchObject({
      action: 'NO_DISCREPANCY',
      pendingTriggerMessageId: 'trigger-1',
    });
  });
});

describe('Run terminal output attention', () => {
  it('sets MESSAGE_READY after a persisted terminal assistant message and dispatch drain', async () => {
    const order: string[] = [];
    const poster = makePoster(
      vi.fn(async (_args: MessagePosterCreateOutOfBandArgs) => {
        order.push('message');
        return `message-${order.length}`;
      }) as MessagePoster['createOutOfBand'],
    );
    const fetchImpl = vi.fn(async () => {
      order.push('ready');
      return new Response(null, { status: 200 });
    });
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(
        poster,
        () => ({
          run: async () => {
            run.onAgentOutput({
              event: {
                source: 'provider',
                eventType: 'agent_output',
                timestamp: '2026-01-01T00:00:00.000Z',
                sessionId: 'prov-1',
                agentId: 'claude',
                payload: {
                  messageType: 'assistant',
                  summary: 'Still working.',
                  taskComplete: false,
                },
              },
            });
            run.onAgentOutput(assistantCompleteMessage('All done.'));
          },
        }),
        createPromptTypeHandlerTestDeps({
          fetchImpl: fetchImpl as typeof fetch,
          apiBaseUrl: 'https://platform.test/api/v1',
        }),
      ),
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(poster.createOutOfBand).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(order).toEqual(['message', 'message', 'ready']);
  });

  it('does not set MESSAGE_READY when terminal assistant persistence fails', async () => {
    const poster = makePoster();
    vi.mocked(poster.createOutOfBand)
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockResolvedValueOnce('failure-message');
    const fetchImpl = vi.fn();
    const settledTurns: Array<{
      terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
      completedAssistantMessageId: string | null;
    }> = [];
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(
        poster,
        () => ({
          run: async () => {
            run.onAgentOutput(assistantCompleteMessage('All done.'));
          },
        }),
        createPromptTypeHandlerTestDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          apiBaseUrl: 'https://platform.test/api/v1',
        }),
      ),
    );

    await run.handleMessage(makeInput(), {
      sourceUserMessageId: 'source-user-message',
      onTurnSettled: ({ terminalOutcome, completedAssistantMessageId }) => {
        settledTurns.push({ terminalOutcome, completedAssistantMessageId });
      },
    });
    await run.awaitIdle();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(settledTurns).toEqual([
      { terminalOutcome: 'FAILED', completedAssistantMessageId: null },
    ]);
    expect(poster.createOutOfBand).toHaveBeenCalledTimes(2);
    const failureMessageDto = (
      vi.mocked(poster.createOutOfBand).mock.calls[1]?.[0] as MessagePosterCreateOutOfBandArgs
    ).dto;
    expect(failureMessageDto).toMatchObject({
      data: {
        response:
          'I generated a response, but could not publish it. This Turn was marked as failed; please try again.',
      },
    });
    expect(failureMessageDto).not.toHaveProperty('proposalIds');
    expect(failureMessageDto).not.toHaveProperty('reportIds');
  });

  it('does not advance a pending external completion after final Message publication fails', async () => {
    const poster = makePoster();
    vi.mocked(poster.createOutOfBand)
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce('failure-message');
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({
        run: async () => {
          run.recordPendingCompletion(PENDING);
          run.onAgentOutput(assistantCompleteMessage('All done.'));
        },
      })),
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it('keeps a committed final Message authoritative when a duplicate publication fails', async () => {
    const poster = makePoster();
    vi.mocked(poster.createOutOfBand)
      .mockResolvedValueOnce('completed-message')
      .mockRejectedValueOnce({ response: { status: 409 } });
    const settledTurns: Array<{
      terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
      completedAssistantMessageId: string | null;
    }> = [];
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(poster, () => ({
        run: async () => {
          run.recordPendingCompletion(PENDING);
          run.onAgentOutput(assistantCompleteMessage('All done.'));
          await vi.waitFor(() => expect(poster.createOutOfBand).toHaveBeenCalledOnce());
          run.onAgentOutput(assistantCompleteMessage('All done.'));
        },
      })),
    );

    await run.handleMessage(makeInput(), {
      sourceUserMessageId: 'source-user-message',
      onTurnSettled: ({ terminalOutcome, completedAssistantMessageId }) => {
        settledTurns.push({ terminalOutcome, completedAssistantMessageId });
      },
    });
    await run.awaitIdle();

    expect(settledTurns).toEqual([
      { terminalOutcome: 'COMPLETED', completedAssistantMessageId: 'completed-message' },
    ]);
    expect(poster.createOutOfBand).toHaveBeenCalledTimes(2);
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledOnce();
  });

  it('does not set MESSAGE_READY for a non-completed terminal outcome', async () => {
    const poster = makePoster();
    const fetchImpl = vi.fn();
    const collaborators = makeCollaborators(
      poster,
      () => ({ run: async () => undefined }),
      createPromptTypeHandlerTestDeps({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        apiBaseUrl: 'https://platform.test/api/v1',
      }),
    );
    const run = new Run(makeRunArgs(), collaborators);
    const turn = new Turn({
      effectiveRole: 'implementation',
      turnId: 'turn-aborted',
      runId: 'run-1',
      resolvedPrompt: 'resolved',
      handler: handlerStub,
      externalAgentNodeId: null,
      triggerMessageId: null,
      runner: { run: async () => undefined },
      platformMcpProxy: null,
      abortController: new AbortController(),
      logger: collaborators.logger,
      owner: run,
      effectiveModel: null,
      effectiveReasoningEffort: null,
    });
    turn.recordCompletedAssistantMessage('persisted-message');

    await run.onTurnRunnerCompleted(turn);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(collaborators.logger.debug).toHaveBeenCalledWith(
      'local.run.output_attention.not_ready',
      expect.objectContaining({ terminalOutcome: 'ABORTED' }),
    );
  });
});
