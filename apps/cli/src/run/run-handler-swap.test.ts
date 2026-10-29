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
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import type { AgentSessionRunner } from '../agents/providers/session-runner';
import { codingFreeformHandler, freeFormHandler } from '../agents/coding-conversation';
import { proposalRefinerHandler } from '../agents/proposal-refiner/proposal-refiner.handler';

// Two stub handlers — Run.resolveTurnInputs looks up the handler keyed off
// the request's promptType. The follow-up handler stays a `provider_session`
// runner so the swap routes back through the picker rather than into
// SubagentRunner.
const handlerA: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'A system prompt',
};

const handlerB: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'agent_search',
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'B system prompt',
};

const handlerC: PromptTypeHandler<unknown> = {
  id: 'quick',
  promptType: 'quick',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'C system prompt',
};

const missingIdHandler = {
  promptType: 'debug',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'invalid system prompt',
} as unknown as PromptTypeHandler<unknown>;

const subagentHandler = {
  id: 'commit',
  promptType: 'commit',
  runnerKind: 'subagent',
  providerSessionCountsForContext: false,
  reports: [],
  buildPrompt: () => 'subagent system prompt',
} as unknown as PromptTypeHandler<unknown>;

const getHandler = (promptType: string | undefined): PromptTypeHandler<unknown> | undefined => {
  if (promptType === 'agent_search') return handlerB;
  if (promptType === 'quick') return handlerC;
  if (promptType === 'proposal_refiner') return proposalRefinerHandler;
  if (promptType === 'debug') return missingIdHandler;
  if (promptType === 'commit') return subagentHandler;
  if (promptType === 'coding_freeform') return handlerA;
  if (promptType === 'implement') return { ...handlerA, id: 'implement', promptType: 'implement' };
  if (promptType === 'project_mode') {
    return { ...handlerA, id: 'project_mode', promptType: 'project_mode' };
  }
  return undefined;
};

// Resolver mock — the test drives `promptTypeChanged` through the result
// shape since `Run.resolveTurnInputs` is what acts on it (the resolver itself
// is exercised by resolve-prompt.test.ts).
const resolveResult = {
  resolvedPrompt: 'resolved',
  startingMessage: undefined,
  sessionContext: undefined,
  preparedPayload: undefined,
  isSubagentOwned: false,
  consumedPreviousProviderSession: false,
  promptTypeChanged: false,
};

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: async () => ({ ...resolveResult }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-existing',
    provider_conversation_id: 'conv-existing',
    provider_session_agent_id: 'coding_freeform',
    provider_session_history: [
      {
        providerSessionId: 'prov-existing',
        providerConversationId: 'conv-existing',
        providerSessionAgentId: 'coding_freeform',
        observedAt: '2026-07-15T00:00:00.000Z',
      },
    ],
    status: 'idle',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    promptType: 'coding_freeform',
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

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunProviderIdentity').mockResolvedValue(makeSession());
  vi.spyOn(store, 'appendRunProviderSessionHistory').mockImplementation(async (_runId, entry) =>
    makeSession({ provider_session_history: [entry] }),
  );
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeCollaborators = (pickRunner: (ctx: RunnerContext) => Runner): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(getHandler),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeInput = (
  promptType: 'coding_freeform' | 'agent_search' | 'quick' | 'debug' | 'commit',
): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { promptType, userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

const drainMicrotasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('Run implement provider switch', () => {
  it('rotates the provider session inside the same Run when the approved runtime switches provider', async () => {
    resolveResult.promptTypeChanged = false;
    const captured: RunnerContext[] = [];
    const collaborators = makeCollaborators((ctx) => {
      captured.push(ctx);
      return { run: async () => {} };
    });
    vi.spyOn(collaborators.runStore, 'updateRunImplementRuntime').mockResolvedValue(
      makeSession({
        provider: 'codex',
        model: 'gpt-6.1-sol',
        provider_session_agent_id: 'implement',
      }),
    );
    const run = new Run(
      makeRunArgs({ session: makeSession({ provider_session_agent_id: 'implement' }) }),
      collaborators,
    );

    await run.handleMessage({
      promptType: 'implement',
      payload: {
        promptType: 'implement',
        runtime: { provider: 'codex', model: 'gpt-6.1-sol', reasoningEffort: 'low' },
      },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    } as unknown as InternalRunPromptRequest);
    await drainMicrotasks();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.run).toBe(run);
    expect(run.runId).toBe('run-1');
    expect(run.provider).toBe('codex');
    expect(captured[0]!.run.hasProviderSession).toBe(false);
    expect(captured[0]!.run.session.provider_session_id).toBeNull();
    expect(captured[0]!.providerSessionDecision).toBe('explicit-fresh-mint');
  });
});

describe('Run same-agent handler routing keeps the provider session', () => {
  it('keeps hasProviderSession=true and hands the picker the existing session on an inherit→inherit swap', async () => {
    // `'inherit'` handlers always resume when a session is present —
    // the span mismatch is diagnostic only, not a discard trigger. This
    // is the regression test for the bug where the else-if at the mint
    // picker discarded on span mismatch even for `'inherit'` handlers.
    resolveResult.promptTypeChanged = false;

    const captured: RunnerContext[] = [];
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => {
      captured.push(ctx);
      return { run: async () => {} };
    };

    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner));
    expect(run.hasProviderSession).toBe(true);
    expect(run.session.provider_session_id).toBe('prov-existing');

    // First turn establishes the in-memory handler span (handlerA / 'coding_freeform').
    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();

    // Second turn rotates to handlerB ('agent_search'). Both are `'inherit'`
    // handlers, so the session must survive the rotation.
    resolveResult.promptTypeChanged = true;
    await run.handleMessage(makeInput('agent_search'));
    await drainMicrotasks();

    expect(captured).toHaveLength(2);
    expect(captured[1]!.handler.promptType).toBe('agent_search');
    expect(captured[1]!.run.hasProviderSession).toBe(true);
    expect(captured[1]!.run.session.provider_session_id).toBe('prov-existing');
    expect(captured[1]!.run.session.provider_conversation_id).toBe('conv-existing');
    expect(captured[1]!.providerSessionMintReason).toBeUndefined();
  });

  it('does not emit a rotation discard when two prompt types resolve to the same handler id', async () => {
    resolveResult.promptTypeChanged = false;

    const collaborators = makeCollaborators(() => ({ run: async () => {} }));
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();

    resolveResult.promptTypeChanged = true;
    await run.handleMessage(makeInput('agent_search'));
    await drainMicrotasks();

    const info = collaborators.logger.info as ReturnType<typeof vi.fn>;
    const swapLog = info.mock.calls.find(
      (call) => call[0] === 'local.run.provider_session.discarded_on_rotation',
    );
    expect(swapLog).toBeUndefined();
  });

  it('records decision=resume in the provider_session.decision log even when span differs', async () => {
    resolveResult.promptTypeChanged = false;

    const collaborators = makeCollaborators(() => ({ run: async () => {} }));
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();

    resolveResult.promptTypeChanged = true;
    await run.handleMessage(makeInput('agent_search'));
    await drainMicrotasks();

    const info = collaborators.logger.info as ReturnType<typeof vi.fn>;
    const decisionLog = info.mock.calls.find(
      (call) =>
        call[0] === 'local.run.provider_session.decision' &&
        (call[1] as { inputPromptType?: string }).inputPromptType === 'agent_search',
    );
    expect(decisionLog).toBeDefined();
    expect((decisionLog![1] as { decision: string }).decision).toBe('resume');
    expect((decisionLog![1] as { outgoingAgentId: string }).outgoingAgentId).toBe(
      'coding_freeform',
    );
    expect((decisionLog![1] as { incomingAgentId: string }).incomingAgentId).toBe(
      'coding_freeform',
    );
  });

  it('does not discard on the first in-process Turn after rehydration even when persisted promptType differs', async () => {
    // Rehydrated Run: hasProviderSession=true, session.promptType='coding_freeform',
    // but no in-memory span has been established yet. Incoming Turn uses a
    // different promptType ('agent_search'). The old anchor (session.promptType)
    // would have discarded; the new anchor (in-memory span) preserves —
    // resume the SDK and let the resolver re-ground via the user message.
    resolveResult.promptTypeChanged = true;

    const captured: RunnerContext[] = [];
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => {
      captured.push(ctx);
      return { run: async () => {} };
    };

    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner));
    await run.handleMessage(makeInput('agent_search'));
    await drainMicrotasks();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.run.hasProviderSession).toBe(true);
    expect(captured[0]!.run.session.provider_session_id).toBe('prov-existing');
    expect(captured[0]!.providerSessionMintReason).toBeUndefined();
  });
});

describe('Run preserves provider session across same-handler turns', () => {
  it('keeps hasProviderSession=true and provider ids intact when promptType is unchanged', async () => {
    resolveResult.promptTypeChanged = false;

    const captured: RunnerContext[] = [];
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => {
      captured.push(ctx);
      return { run: async () => {} };
    };

    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner));

    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.run.hasProviderSession).toBe(true);
    expect(captured[0]!.run.session.provider_session_id).toBe('prov-existing');
    expect(captured[0]!.run.session.provider_conversation_id).toBe('conv-existing');
    // No swap reason set — picker would log 'provider-session-resume'.
    expect(captured[0]!.providerSessionMintReason).toBeUndefined();
  });

  it('does not discard on a same-handler user reply even when the resolver flags promptTypeChanged', async () => {
    // Defends the user's reported bug: a user reply must not mint a fresh
    // provider session when the handler hasn't actually changed. Even with
    // `promptTypeChanged=true` (e.g. a workflow that re-resolves the user
    // reply to a sibling promptType the resolver flags as a change), the
    // in-memory span anchors the swap decision and prevents a discard when
    // the same handler keeps running.
    resolveResult.promptTypeChanged = false;

    const captured: RunnerContext[] = [];
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => {
      captured.push(ctx);
      return { run: async () => {} };
    };

    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner));

    // First turn establishes the span (handlerA / 'coding_freeform').
    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();

    // User reply on the same handler — even with promptTypeChanged=true
    // the span agrees with the input, so no swap.
    resolveResult.promptTypeChanged = true;
    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();

    expect(captured).toHaveLength(2);
    expect(captured[1]!.run.hasProviderSession).toBe(true);
    expect(captured[1]!.run.session.provider_session_id).toBe('prov-existing');
    expect(captured[1]!.providerSessionMintReason).toBeUndefined();
  });
});

describe('Run keeps ordinary replies with the agent that owns the session', () => {
  async function replyAsCodingFreeform(
    ownerId: string,
    overrides: Partial<ReturnType<typeof makeInput>> = {},
  ) {
    resolveResult.promptTypeChanged = false;
    const discardSession = vi.fn().mockResolvedValue(undefined);
    const pickRunner = vi.fn((): Runner => ({ run: async () => {} }));
    const collaborators = makeCollaborators(pickRunner);
    const session = makeSession({ provider_session_agent_id: ownerId, promptType: ownerId });
    const run = new Run(makeRunArgs({ session }), collaborators);
    run.setRunner({ discardSession } as unknown as AgentSessionRunner);

    await run.handleMessage({ ...makeInput('coding_freeform'), ...overrides });
    await drainMicrotasks();

    return { run, discardSession };
  }

  it.each(['proposal_refiner', 'implement', 'project_mode'])(
    'resumes the %s session for an ordinary reply instead of rotating to coding_freeform',
    async (ownerId) => {
      const { run, discardSession } = await replyAsCodingFreeform(ownerId);

      expect(discardSession).not.toHaveBeenCalled();
      expect(run.hasProviderSession).toBe(true);
      expect(run.session.provider_session_id).toBe('prov-existing');
      expect(run.session.provider_session_agent_id).toBe(ownerId);
    },
  );

  it.each(['free_form', 'quick', 'project_assistant'])(
    'hands the %s reply to coding_freeform',
    async (ownerId) => {
      const { run } = await replyAsCodingFreeform(ownerId);

      expect(run.session.provider_session_agent_id).toBe('coding_freeform');
    },
  );

  it('hands a reply to coding_freeform while a workflow is parked on a user review', async () => {
    const { run } = await replyAsCodingFreeform('implement', { awaitingUserReview: true });

    expect(run.session.provider_session_agent_id).toBe('coding_freeform');
  });
});

describe('Run rotates provider sessions on handler-id transitions', () => {
  it('discards the outgoing provider session exactly once before selecting the incoming agent', async () => {
    const discardSession = vi.fn().mockResolvedValue(undefined);
    const pickRunner = vi.fn((): Runner => ({ run: async () => {} }));
    const collaborators = makeCollaborators(pickRunner);
    const previousProviderSession = {
      promptType: 'coding_freeform',
      lastMessage: 'handoff summary',
      completedAt: '2026-07-15T00:00:00.000Z',
    };
    const memos = [
      {
        source: 'coding_freeform',
        content: 'explicit memo',
        writtenAt: '2026-07-15T00:00:00.000Z',
      },
    ];
    const run = new Run(
      makeRunArgs({ session: makeSession({ previousProviderSession, memos }) }),
      collaborators,
    );
    run.setRunner({ discardSession } as unknown as AgentSessionRunner);

    await run.handleMessage(makeInput('coding_freeform'));
    await drainMicrotasks();
    await run.handleMessage(makeInput('quick'));
    await drainMicrotasks();

    expect(discardSession).toHaveBeenCalledTimes(1);
    expect(collaborators.runStore.updateRunProviderIdentity).toHaveBeenCalledTimes(1);
    expect(collaborators.runStore.updateRunProviderIdentity).toHaveBeenCalledWith('run-1', {
      providerSessionId: null,
      providerConversationId: null,
    });
    expect(run.hasProviderSession).toBe(false);
    expect(run.session.provider_session_id).toBeNull();
    expect(run.session.provider_session_agent_id).toBe('quick');
    expect(run.session.provider_session_history).toEqual([
      {
        providerSessionId: 'prov-existing',
        providerConversationId: 'conv-existing',
        providerSessionAgentId: 'coding_freeform',
        observedAt: '2026-07-15T00:00:00.000Z',
      },
    ]);
    expect(run.session.previousProviderSession).toEqual(previousProviderSession);
    expect(run.session.memos).toEqual(memos);

    const transitionDecision = (
      collaborators.logger.info as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      (call) =>
        call[0] === 'local.run.provider_session.decision' &&
        (call[1] as { inputPromptType?: string }).inputPromptType === 'quick',
    );
    expect(transitionDecision?.[1]).toEqual(
      expect.objectContaining({
        decision: 'agent-transition-mint',
        outgoingAgentId: 'coding_freeform',
        incomingAgentId: 'quick',
      }),
    );
  });

  it('rejects a provider-session handler with a missing id before runner selection', async () => {
    const pickRunner = vi.fn((): Runner => ({ run: async () => {} }));
    const run = new Run(
      makeRunArgs({
        session: makeSession({ provider_session_id: null as unknown as string }),
        hasProviderSession: false,
      }),
      makeCollaborators(pickRunner),
    );

    await expect(run.handleMessage(makeInput('debug'))).rejects.toThrow(/non-empty id/);
    expect(pickRunner).not.toHaveBeenCalled();
  });

  it('restores the outgoing identity when its durable clear fails', async () => {
    const persistFailure = new Error('disk unavailable');
    const discardSession = vi.fn().mockResolvedValue(undefined);
    const pickRunner = vi.fn((): Runner => ({ run: async () => {} }));
    const collaborators = makeCollaborators(pickRunner);
    collaborators.runStore.updateRunProviderIdentity = vi.fn().mockRejectedValue(persistFailure);
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner({ discardSession } as unknown as AgentSessionRunner);

    await expect(run.handleMessage(makeInput('quick'))).rejects.toBe(persistFailure);

    expect(run.hasProviderSession).toBe(true);
    expect(run.session.provider_session_id).toBe('prov-existing');
    expect(run.session.provider_conversation_id).toBe('conv-existing');
    expect(run.session.provider_session_agent_id).toBe('coding_freeform');
    expect(discardSession).not.toHaveBeenCalled();
    expect(pickRunner).not.toHaveBeenCalled();
  });

  it('retries a failed provider-client discard before allowing a later mint', async () => {
    const discardFailure = new Error('provider disconnect failed');
    const discardSession = vi
      .fn<NonNullable<AgentSessionRunner['discardSession']>>()
      .mockRejectedValueOnce(discardFailure)
      .mockResolvedValueOnce(undefined);
    const pickRunner = vi.fn((): Runner => ({ run: async () => {} }));
    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner({ discardSession } as unknown as AgentSessionRunner);

    await expect(run.handleMessage(makeInput('quick'))).rejects.toBe(discardFailure);
    expect(pickRunner).not.toHaveBeenCalled();

    await run.handleMessage(makeInput('quick'));
    await drainMicrotasks();

    expect(discardSession).toHaveBeenCalledTimes(2);
    expect(pickRunner).toHaveBeenCalledTimes(1);
    expect(run.session.provider_session_agent_id).toBe('quick');
  });

  it('leaves Run-owned provider identity unchanged for a subagent turn', async () => {
    const pickRunner = vi.fn((): Runner => ({ run: async () => {} }));
    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('commit'));
    await drainMicrotasks();

    expect(run.hasProviderSession).toBe(true);
    expect(run.session.provider_session_id).toBe('prov-existing');
    expect(run.session.provider_session_agent_id).toBe('coding_freeform');
    expect(collaborators.runStore.updateRunProviderIdentity).not.toHaveBeenCalled();
  });
});

describe('Run resumes persisted coding-conversation sessions through either alias', () => {
  const aliasHandlers: Record<string, PromptTypeHandler<unknown>> = {
    free_form: freeFormHandler as unknown as PromptTypeHandler<unknown>,
    coding_freeform: codingFreeformHandler as unknown as PromptTypeHandler<unknown>,
  };

  const makeAliasCollaborators = (
    pickRunner: (ctx: RunnerContext) => Runner,
  ): RunCollaborators => ({
    ...makeCollaborators(pickRunner),
    ...createTestRunOwnership((promptType) => (promptType ? aliasHandlers[promptType] : undefined)),
  });

  const makeAliasInput = (promptType: 'free_form' | 'coding_freeform'): InternalRunPromptRequest =>
    ({
      promptType,
      payload: { promptType, userMessage: 'go' },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    }) as InternalRunPromptRequest;

  it.each(['free_form', 'coding_freeform'] as const)(
    'resumes a rehydrated %s-owned provider session with its Services intact',
    async (alias) => {
      resolveResult.promptTypeChanged = false;
      const services = [
        { id: 'svc-1', path: '/tmp/repo' },
        { id: 'svc-2', path: '/tmp/other' },
      ];
      const captured: RunnerContext[] = [];
      const run = new Run(
        makeRunArgs({
          skipProjectAssistant: true,
          session: makeSession({
            entity: { entityType: 'TASK', entityId: 'task-1' },
            promptType: alias,
            provider_session_agent_id: alias,
            provider_session_history: [
              {
                providerSessionId: 'prov-existing',
                providerConversationId: 'conv-existing',
                providerSessionAgentId: alias,
                observedAt: '2026-07-15T00:00:00.000Z',
              },
            ],
            services,
            launchServiceId: 'svc-1',
          }),
        }),
        makeAliasCollaborators((ctx) => {
          captured.push(ctx);
          return { run: async () => {} };
        }),
      );

      await run.handleMessage(makeAliasInput(alias));
      await drainMicrotasks();

      expect(captured).toHaveLength(1);
      expect(captured[0]!.handler).toBe(aliasHandlers[alias]);
      expect(captured[0]!.run.hasProviderSession).toBe(true);
      expect(captured[0]!.run.session.provider_session_id).toBe('prov-existing');
      expect(captured[0]!.run.session.provider_session_agent_id).toBe(alias);
      expect(captured[0]!.providerSessionMintReason).toBeUndefined();
      expect(captured[0]!.run.session.services).toEqual(services);
      expect(captured[0]!.run.session.launchServiceId).toBe('svc-1');
    },
  );

  it('keeps launch and follow-up as distinct provider-session owners', async () => {
    resolveResult.promptTypeChanged = true;
    const collaborators = makeAliasCollaborators(() => ({ run: async () => {} }));
    const run = new Run(
      makeRunArgs({
        skipProjectAssistant: true,
        session: makeSession({
          entity: { entityType: 'TASK', entityId: 'task-1' },
          promptType: 'free_form',
          provider_session_agent_id: 'free_form',
        }),
      }),
      collaborators,
    );
    run.setRunner({
      discardSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentSessionRunner);

    await run.handleMessage(makeAliasInput('coding_freeform'));
    await drainMicrotasks();

    const decision = (collaborators.logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'local.run.provider_session.decision',
    );
    expect(decision?.[1]).toEqual(
      expect.objectContaining({
        decision: 'agent-transition-mint',
        outgoingAgentId: 'free_form',
        incomingAgentId: 'coding_freeform',
      }),
    );
    expect(run.session.provider_session_agent_id).toBe('coding_freeform');
  });
});
