import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from '../run.test-support';

import { NewSessionRunner, type NewSessionRunnerDeps } from './new-session-runner';
import { Run, type RunArgs, type RunCollaborators } from '../run';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../../agents/prompt-type-handler';
import type { RunnerContext } from './types';

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
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

const makeLogger = (): RunCollaborators['logger'] =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as RunCollaborators['logger'];

const makeCollaborators = (): RunCollaborators => ({
  runStore: createTestRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(),
  logger: makeLogger(),
});

const makeInput = (): InternalRunPromptRequest => ({
  promptType: 'coding_freeform',
  payload: { promptType: 'coding_freeform', userMessage: 'user text' },
  references: { resolved: ['task-1'], unresolved: [] },
  triggerContext: null,
});

const makeHandler = (): PromptTypeHandler<unknown> =>
  ({
    id: 'coding_freeform',
    promptType: 'coding_freeform',
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'gated_and_clarifiable',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],
    buildPrompt: () => '',
  }) as PromptTypeHandler<unknown>;

const makeCtx = (run: Run, resolvedPrompt: string): RunnerContext => ({
  run,
  handler: makeHandler(),
  resolvedPrompt,
  input: makeInput(),
  cwd: '/tmp/test-cwd',
  effectiveModel: null,
  effectiveReasoningEffort: null,
  priorReports: [],
  providerSessionDecision: 'first-turn-mint',
});

type RunPromptMethod = NewSessionRunnerDeps['sessionRunnerFacade']['runPrompt'];
const sessionRunnerFacadeFor = (
  runPrompt: (args: Parameters<RunPromptMethod>[1]) => ReturnType<RunPromptMethod>,
): NewSessionRunnerDeps['sessionRunnerFacade'] => {
  const facade = createTestSessionRunnerFacade();
  vi.mocked(facade.runPrompt).mockImplementation((_run, args) => runPrompt(args));
  return facade;
};

describe('NewSessionRunner', () => {
  it('forwards the handler repository-research declaration to the provider adapter', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const facade = createTestSessionRunnerFacade();
    vi.mocked(facade.runPrompt).mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });
    const handler = {
      ...makeHandler(),
      readOnlyFilesystem: true,
      replaceProviderSystemPrompt: true,
      repositoryResearch: { delegation: 'disabled' as const },
    };

    await new NewSessionRunner(
      { ...makeCtx(run, 'repository prompt'), handler },
      { sessionRunnerFacade: facade, logger: makeLogger() },
    ).run(new AbortController().signal);

    expect(facade.runPrompt).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        readOnlyFilesystem: true,
        replaceProviderSystemPrompt: true,
        repositoryResearch: { delegation: 'disabled' },
      }),
      undefined,
    );
  });

  it('forwards the handler epistemic-calibration declaration to the provider adapter', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const facade = createTestSessionRunnerFacade();
    vi.mocked(facade.runPrompt).mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });
    const handler = { ...makeHandler(), epistemicCalibration: true as const };

    await new NewSessionRunner(
      { ...makeCtx(run, 'conversation prompt'), handler },
      { sessionRunnerFacade: facade, logger: makeLogger() },
    ).run(new AbortController().signal);

    expect(facade.runPrompt).toHaveBeenCalledWith(
      run,
      expect.objectContaining({ epistemicCalibration: true }),
      undefined,
    );
  });

  it('forwards the authoritative execution provider and effective model', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const facade = createTestSessionRunnerFacade();
    vi.mocked(facade.runPrompt).mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });
    const runner = new NewSessionRunner(
      {
        ...makeCtx(run, 'repository prompt'),
        executionProvider: 'openai',
        effectiveModel: 'gpt-5.1',
      },
      { sessionRunnerFacade: facade, logger: makeLogger() },
    );

    await runner.run(new AbortController().signal);

    expect(facade.runPrompt).toHaveBeenCalledWith(
      run,
      expect.objectContaining({ model: 'gpt-5.1' }),
      'openai',
    );
  });

  it('logs safe authoritative startup provenance when creating a provider session', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const logger = makeLogger();
    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });
    const ctx: RunnerContext = {
      ...makeCtx(run, 'TURN INPUT'),
      startupPromptInput: {
        startupInput: {
          task: { taskType: 'STANDARD', description: 'CURRENT ENTITY CONTEXT' },
          adjacentScopeTasks: [],
          evidenceItems: [],
        },
        renderedInput: 'CURRENT ENTITY CONTEXT',
        loadedEntityContext: {
          kind: 'entity',
          focalEntity: { entityType: 'TASK', entityId: 'task-1' },
          entity: {} as never,
          context: {} as never,
        },
        provenance: {
          templateKey: 'task',
          ownershipSource: { scope: 'CANONICAL' },
          revisionId: 'revision-1',
          revisionNumber: 1,
        },
      },
      providerSessionStartupSegments: {
        stableInstructions: 'STABLE INSTRUCTIONS',
        dynamicContext: 'HANDLER ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    };

    await new NewSessionRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger,
    }).run(new AbortController().signal);

    expect(logger.info).toHaveBeenCalledWith('local.run.provider_session.startup_context', {
      runId: 'run-1',
      providerSessionAction: 'mint',
      startupInputDelivered: true,
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'revision-1',
      revisionNumber: 1,
    });
    expect(runPrompt.mock.calls[0]?.[0]).toMatchObject({
      prompt:
        'STABLE INSTRUCTIONS\n\nCURRENT ENTITY CONTEXT\n\n---\n\nHANDLER ENTITY CONTEXT\n\nCURRENT USER INPUT',
      startupSegments: {
        stableInstructions: 'STABLE INSTRUCTIONS',
        dynamicContext: 'CURRENT ENTITY CONTEXT\n\n---\n\nHANDLER ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    });
  });

  it('forwards the Run-held session, prompt, references, and signal to runPrompt', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ session }), makeCollaborators());
    expect(run.hasProviderSession).toBe(false);

    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: 'new-conv',
      errorCount: 0,
    });

    const runner = new NewSessionRunner(makeCtx(run, 'first-turn prompt'), {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger: makeLogger(),
    });

    const controller = new AbortController();
    await runner.run(controller.signal);

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(runPrompt).toHaveBeenCalledWith({
      session,
      attachments: [],
      attachmentRunId: run.runId,
      prompt: 'first-turn prompt',
      references: { resolved: ['task-1'], unresolved: [] },
      signal: controller.signal,
    });
  });

  it('flips run.hasProviderSession and patches run.session with the captured provider ids', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const runner = new NewSessionRunner(makeCtx(run, 'first prompt'), {
      sessionRunnerFacade: sessionRunnerFacadeFor(
        vi.fn().mockResolvedValue({
          providerSessionId: 'new-session',
          providerConversationId: 'new-conv',
          errorCount: 0,
        }),
      ),
      logger: makeLogger(),
    });

    expect(run.hasProviderSession).toBe(false);
    await runner.run(new AbortController().signal);
    expect(run.hasProviderSession).toBe(true);
    expect(run.session.provider_session_id).toBe('new-session');
    expect(run.session.provider_conversation_id).toBe('new-conv');
  });

  it('throws synchronously when resolvedPrompt is empty', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const runPrompt = vi.fn();
    const runner = new NewSessionRunner(makeCtx(run, ''), {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger: makeLogger(),
    });

    await expect(runner.run(new AbortController().signal)).rejects.toThrow(
      /resolvedPrompt is empty/,
    );
    expect(runPrompt).not.toHaveBeenCalled();
    expect(run.hasProviderSession).toBe(false);
  });

  it('does not flip hasProviderSession when runPrompt throws', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const failure = new Error('run boom');
    const runner = new NewSessionRunner(makeCtx(run, 'first prompt'), {
      sessionRunnerFacade: sessionRunnerFacadeFor(vi.fn().mockRejectedValue(failure)),
      logger: makeLogger(),
    });

    await expect(runner.run(new AbortController().signal)).rejects.toBe(failure);
    expect(run.hasProviderSession).toBe(false);
  });

  it("forwards the handler's additionalAllowedTools into runPrompt", async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });

    const handlerWithExtras: PromptTypeHandler<unknown> = {
      id: 'coding_freeform',
      promptType: 'coding_freeform',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'gated_and_clarifiable',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
      additionalAllowedTools: ['create_stage', 'move_step'],
    } as PromptTypeHandler<unknown>;

    const ctx: RunnerContext = {
      run,
      handler: handlerWithExtras,
      resolvedPrompt: 'prompt',
      input: makeInput(),
      cwd: '/tmp/test-cwd',
      effectiveModel: null,
      effectiveReasoningEffort: null,
      priorReports: [],
      providerSessionDecision: 'first-turn-mint',
      platformMcpAdditionalAllowedTools: ['create_stage', 'move_step'],
    };

    const runner = new NewSessionRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    const call = runPrompt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['additionalAllowedTools']).toEqual(['create_stage', 'move_step']);
  });

  it('forwards Run-resolved dynamic additionalAllowedTools into runPrompt', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });

    const handlerWithDynamicExtras: PromptTypeHandler<unknown> = {
      id: 'coding_freeform',
      promptType: 'coding_freeform',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'gated_and_clarifiable',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
      additionalAllowedTools: ['create_stage', 'create_step'],
      resolveAdditionalAllowedTools: ({ payload }) =>
        payload && typeof payload === 'object' && 'kind' in payload && payload.kind === 'plan'
          ? ['create_step', 'move_step']
          : [],
    } as PromptTypeHandler<unknown>;

    const ctx: RunnerContext = {
      run,
      handler: handlerWithDynamicExtras,
      resolvedPrompt: 'prompt',
      input: {
        ...makeInput(),
        payload: { promptType: 'coding_freeform', kind: 'coding_freeform' } as never,
      },
      preparedPayload: { promptType: 'coding_freeform', kind: 'plan' },
      cwd: '/tmp/test-cwd',
      effectiveModel: null,
      effectiveReasoningEffort: null,
      priorReports: [],
      providerSessionDecision: 'first-turn-mint',
      platformMcpAdditionalAllowedTools: ['create_stage', 'create_step', 'move_step'],
    };

    const runner = new NewSessionRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    const call = runPrompt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['additionalAllowedTools']).toEqual(['create_stage', 'create_step', 'move_step']);
  });

  it('forwards the scoped platform MCP proxy mount', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });
    const ctx: RunnerContext = {
      ...makeCtx(run, 'prompt'),
      platformMcpProxyMount: {
        runId: 'run-1',
        turnId: 'turn-1',
        token: 'proxy-token-1',
        allowedTools: ['mcp__heyhey-platform__get_context'],
      },
    };

    const runner = new NewSessionRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    const call = runPrompt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['platformMcpProxyMount']).toEqual({
      runId: 'run-1',
      turnId: 'turn-1',
      token: 'proxy-token-1',
      allowedTools: ['mcp__heyhey-platform__get_context'],
    });
  });

  it('omits additionalAllowedTools from runPrompt when the handler does not declare any', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: null,
      errorCount: 0,
    });

    const runner = new NewSessionRunner(makeCtx(run, 'prompt'), {
      sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt),
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    const call = runPrompt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('additionalAllowedTools');
  });

  it.each([false, true])(
    'delivers an interrupted-work checkpoint on replacement mint with segmentation (%s)',
    async (segmented) => {
      const run = new Run(makeRunArgs(), makeCollaborators());
      const completeRecovery = vi
        .spyOn(run.serviceScope, 'completeServiceScopeRecoveryDelivery')
        .mockResolvedValue(undefined);
      const setHasProviderSession = vi.spyOn(run, 'setHasProviderSession');
      const runPrompt = vi.fn().mockResolvedValue({
        providerSessionId: 'replacement-session',
        providerConversationId: 'replacement-conversation',
        errorCount: 0,
      });
      const recovery = {
        input: makeInput(),
        checkpoint: {
          completedActions: ['Inspected the approval boundary.'],
          discoveries: ['The existing provider session cannot be reused.'],
          toolResults: ['Service union validated.'],
          changedFiles: [],
          nextAction: 'Continue the implementation.',
        },
        delivery: 'pending' as const,
        interruptedTurnId: 'interrupted-turn-1',
        capturedAt: '2026-08-31T00:00:00.000Z',
      };
      const runner = new NewSessionRunner(
        {
          ...makeCtx(run, 'canonical startup and prior-conversation prompt'),
          serviceScopeRecovery: recovery,
          ...(segmented
            ? {
                startupPromptInput: {
                  renderedInput: 'canonical startup and prior-conversation prompt',
                  startupInput: {
                    task: { taskType: 'STANDARD', description: 'Current task' },
                    adjacentScopeTasks: [],
                    evidenceItems: [],
                  },
                  loadedEntityContext: {
                    kind: 'entity' as const,
                    focalEntity: { entityType: 'TASK' as const, entityId: 'task-1' },
                    entity: {} as never,
                    context: {} as never,
                  },
                  provenance: {
                    templateKey: 'task',
                    ownershipSource: { scope: 'CANONICAL' as const },
                    revisionId: 'revision-1',
                    revisionNumber: 1,
                  },
                },
                providerSessionStartupSegments: {
                  stableInstructions: 'STABLE',
                  dynamicContext: '',
                  userInput: 'CONTINUE',
                },
              }
            : {}),
        },
        { sessionRunnerFacade: sessionRunnerFacadeFor(runPrompt), logger: makeLogger() },
      );

      await runner.run(new AbortController().signal);

      const prompt = runPrompt.mock.calls[0]?.[0].prompt;
      expect(prompt).toContain('## Interrupted work checkpoint');
      expect(prompt).toContain('canonical startup and prior-conversation prompt');
      if (segmented) {
        const segments = runPrompt.mock.calls[0]?.[0].startupSegments;
        expect(segments.stableInstructions).toBe('STABLE');
        expect(segments.dynamicContext).toContain('## Interrupted work checkpoint');
        expect(segments.dynamicContext).toContain(
          'canonical startup and prior-conversation prompt',
        );
      }
      expect(completeRecovery).toHaveBeenCalledOnce();
      expect(completeRecovery).toHaveBeenCalledWith(recovery);
      expect(run.hasProviderSession).toBe(true);
      expect(run.session.provider_session_id).toBe('replacement-session');
      expect(completeRecovery.mock.invocationCallOrder[0]).toBeGreaterThan(
        setHasProviderSession.mock.invocationCallOrder[0]!,
      );
    },
  );
});

describe('role advice at fresh provider handoff', () => {
  it.each([false, true])(
    'delivers advice before user input with structured startup=%s',
    async (structured) => {
      const run = new Run(makeRunArgs(), makeCollaborators());
      const acknowledge = vi
        .spyOn(run.sessionRoleGuidance, 'acknowledge')
        .mockResolvedValue(undefined);
      const facade = createTestSessionRunnerFacade();
      vi.mocked(facade.runPrompt).mockResolvedValue({
        providerSessionId: 'new-session',
        providerConversationId: null,
        errorCount: 0,
      });
      const ctx = makeCtx(run, 'AFFECTED INPUT');
      ctx.roleGuidance = {
        text: 'REVIEWED MOCKUP ADVICE',
        deliveryKeys: ['implementation:mockup'],
        resolutions: [],
        failedTypeKeys: [],
      };
      if (structured) {
        ctx.startupPromptInput = {
          renderedInput: 'ENTITY',
          provenance: {},
          loadedEntityContext: {},
        } as never;
        ctx.providerSessionStartupSegments = {
          stableInstructions: 'STABLE',
          dynamicContext: 'DYNAMIC',
          userInput: 'AFFECTED INPUT',
        };
      }
      await new NewSessionRunner(ctx, { sessionRunnerFacade: facade, logger: makeLogger() }).run(
        new AbortController().signal,
      );
      const request = vi.mocked(facade.runPrompt).mock.calls[0]![1];
      expect(request.prompt.indexOf('REVIEWED MOCKUP ADVICE')).toBeLessThan(
        request.prompt.indexOf('AFFECTED INPUT'),
      );
      if (structured) {
        expect(request.startupSegments?.dynamicContext).toContain('REVIEWED MOCKUP ADVICE');
        expect(request.startupSegments?.stableInstructions).toBe('STABLE');
        expect(request.startupSegments?.userInput).toBe('AFFECTED INPUT');
      }
      expect(acknowledge).toHaveBeenCalledWith(run.session, 'new-session', ctx.roleGuidance);
    },
  );
  it('does not consume advice when provider handoff fails', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const acknowledge = vi.spyOn(run.sessionRoleGuidance, 'acknowledge');
    const facade = createTestSessionRunnerFacade();
    vi.mocked(facade.runPrompt).mockRejectedValue(Error('handoff failed'));
    const ctx = {
      ...makeCtx(run, 'AFFECTED INPUT'),
      roleGuidance: {
        text: 'ADVICE',
        deliveryKeys: ['implementation:mockup'],
        resolutions: [],
        failedTypeKeys: [],
      },
    };
    await expect(
      new NewSessionRunner(ctx, { sessionRunnerFacade: facade, logger: makeLogger() }).run(
        new AbortController().signal,
      ),
    ).rejects.toThrow('handoff failed');
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
