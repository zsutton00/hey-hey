import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { ResolvedRunWorkspace } from '../agents/run-scope';
import {
  resolveRunWorkspace,
  resolveServiceBindingsForIds,
  RunWorktreeCollisionError,
} from '../agents/run-scope';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { AgenticSession } from '../session/types';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { resolvePrompt } from './resolve-prompt';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';

const handlerStub: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'unused',
};

const declaredHandlers = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

// The stub, carrying the declarations the real handler for this prompt type makes.
const declaredHandler = (promptType: string): PromptTypeHandler<unknown> => {
  const declared = declaredHandlers.get(promptType);
  if (!declared) throw new Error(`No handler registered for ${promptType}.`);
  return {
    ...handlerStub,
    id: declared.id,
    promptType: declared.promptType,
    service: declared.service,
    launchEntity: declared.launchEntity,
    implementationReadiness: declared.implementationReadiness,
  };
};

const implementHandlerStub: PromptTypeHandler<unknown> = {
  ...handlerStub,
  id: 'implement',
  promptType: 'implement',
};

vi.mock('../agents/run-scope', async () => {
  const actual = await vi.importActual<typeof import('../agents/run-scope')>('../agents/run-scope');
  return {
    ...actual,
    resolveRunWorkspace: vi.fn(),
    resolveServiceBindingsForIds: vi.fn(),
  };
});

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: vi.fn(
    async (args: {
      handler: PromptTypeHandler<unknown>;
      run: AgenticSession;
      input: InternalRunPromptRequest;
      onPreparedPayload?: (input: {
        handler: PromptTypeHandler<unknown>;
        payload: unknown;
        requestStartupPromptInputRefresh: () => void;
      }) => Promise<unknown>;
    }) => {
      let preparedPayload: unknown;
      const inputPayload = args.input.payload as { userMessage?: string } | undefined;
      if (args.input.promptType === 'implement') {
        preparedPayload =
          inputPayload?.userMessage === 'missing-plan'
            ? {}
            : {
                _approvedPlanPayload: {
                  responseType: 'startup_plan_v1',
                  sessionTitle: 'Approved cross-service plan',
                  requiredServiceIds: ['svc-2'],
                  primaryImplementations: [
                    {
                      title: 'Cross-service implementation',
                      content: 'Update both selected service workspaces.',
                      rationale: 'The approved plan names both Service workspaces.',
                    },
                  ],
                  executionPlan: [
                    {
                      stepId: 'step-1',
                      title: 'Implement the change',
                      description: 'Update the selected Service workspaces.',
                      phase: 1,
                      references: [],
                    },
                  ],
                  discrepancies: [],
                  clarificationQuestions: [],
                },
                _services: [{ id: 'svc-1', path: '/repos/service-a' }],
                _launchServiceId: 'svc-1',
              };
        if (args.onPreparedPayload) {
          preparedPayload = await args.onPreparedPayload({
            handler: args.handler,
            payload: preparedPayload,
            requestStartupPromptInputRefresh: vi.fn(),
          });
        }
      }
      return {
        resolvedPrompt: 'resolved provider prompt',
        startingMessage: undefined,
        sessionContext: undefined,
        preparedPayload,
        isSubagentOwned: false,
        consumedPreviousProviderSession: false,
      };
    },
  ),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'codex',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'idle',
    serviceId: 'svc-1',
    services: [{ id: 'svc-1', path: '/repos/service-a' }],
    launchServiceId: 'svc-1',
    worktree: { enabled: true, branch: 'feature-branch' },
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'codex',
  session: makeSession(),
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'getTouchedFiles').mockResolvedValue([]);
  vi.spyOn(store, 'getFileChangeFacts').mockResolvedValue([]);
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunServices').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunProjectAssistantDone').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeCollaborators = (
  runStore: RunStore,
  pickRunner: (ctx: RunnerContext) => Runner,
  handler: PromptTypeHandler<unknown> | PromptTypeRegistry['get'] = handlerStub,
): RunCollaborators => ({
  runStore,
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(typeof handler === 'function' ? handler : () => handler),
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

const makeInput = (promptType = 'coding_freeform'): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { promptType, userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

const makePlanExecutionInput = (): InternalRunPromptRequest =>
  ({
    promptType: 'plan_execution',
    payload: {
      promptType: 'plan_execution',
      plan: {
        responseType: 'startup_plan_v1',
        sessionTitle: 'Approved cross-service plan',
        requiredServiceIds: new Set(['svc-2']),
        primaryImplementations: [
          {
            title: 'Cross-service implementation',
            content: 'Update both selected service workspaces.',
            rationale: 'The approved plan names both Service workspaces.',
          },
        ],
        executionPlan: [
          {
            stepId: 'step-1',
            title: 'Implement the change',
            description: 'Update the selected Service workspaces.',
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
      review: {
        responseType: 'startup_plan_review_v1',
        questionAnswers: [],
        discrepancyDispositions: [],
      },
      entity: { entityType: 'TASK', entityId: 'task-1' },
    },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

describe('Run worktree workspace state', () => {
  it('waits for the active Turn before applying an admitted Service grant', async () => {
    const services = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({ ok: true, services });
    vi.mocked(resolveRunWorkspace).mockResolvedValue({
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a', '/repos/service-b'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    });
    const runStore = makeRunStore();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(runStore, () => ({ run: async () => {} })),
    );
    run.isProcessing = true;

    await run.handleMessage(makeInput(), {
      sourceUserMessageId: 'message-2',
      admittedServiceScope: { serviceIds: ['svc-1', 'svc-2'], launchServiceId: 'svc-1' },
    });

    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/repos/service-a' }]);
    expect(run.queueLength).toBe(1);

    await run['drainQueue']();
    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services,
      launchServiceId: 'svc-1',
    });
    run.cleanup();
  });

  it('promotes an admitted Service into the next provider workspace', async () => {
    const services = [{ id: 'svc-1', path: '/repos/service-a' }];
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({ ok: true, services });
    vi.mocked(resolveRunWorkspace).mockResolvedValue({
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    });
    const runStore = makeRunStore();
    const captured: RunnerContext[] = [];
    const { launchServiceId: _launchServiceId, ...graphSession } = makeSession();
    const run = new Run(
      makeRunArgs({
        session: { ...graphSession, services: [] },
      }),
      makeCollaborators(
        runStore,
        (context) => {
          captured.push(context);
          return { run: async () => {} };
        },
        declaredHandler('entity_conversation'),
      ),
    );

    await run.handleMessage(makeInput('entity_conversation'), {
      sourceUserMessageId: 'message-1',
      admittedServiceScope: { serviceIds: ['svc-1'], launchServiceId: 'svc-1' },
    });

    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services,
      launchServiceId: 'svc-1',
    });
    expect(run.session.launchServiceId).toBe('svc-1');
    expect(captured[0]?.workspace?.cwd).toBe('/repos/service-a');
    expect(captured[0]?.workspace?.allowedRepositoryRoots).toEqual(['/repos/service-a']);
    run.cleanup();
  });

  it('preserves an existing launch Service while admitting another workspace', async () => {
    const services = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({ ok: true, services });
    vi.mocked(resolveRunWorkspace).mockResolvedValue({
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a', '/repos/service-b'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    });
    const runStore = makeRunStore();
    const captured: RunnerContext[] = [];
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(runStore, (context) => {
        captured.push(context);
        return { run: async () => {} };
      }),
    );

    await run.handleMessage(makeInput(), {
      sourceUserMessageId: 'message-1',
      admittedServiceScope: { serviceIds: ['svc-1', 'svc-2'], launchServiceId: 'svc-1' },
    });

    expect(run.session.launchServiceId).toBe('svc-1');
    expect(run.session.services).toEqual(services);
    expect(captured[0]?.workspace?.allowedRepositoryRoots).toEqual([
      '/repos/service-a',
      '/repos/service-b',
    ]);
    run.cleanup();
  });

  const serviceFreePromptTypes = [
    'work_tracker_connect',
    'work_tracker_import',
    'entity_conversation',
    'goal_pm',
    'feature_tree_conversation',
    'task_monitor',
    'agent_search',
    'daily_session',
    'session_message',
    'plan_shaping_feature_sync_analyze',
    'plan_shaping_feature_sync_iterate',
    'plan_shaping_feature_sync_discuss',
    'plan_shaping_proposed_stages',
    'plan_shaping_refine_stage',
    'plan_shaping_phase_breakdown',
    'plan_shaping_step_review',
    'plan_shaping_visual_preview',
    'plan_shaping_finalize',
    'project_report',
    'open_items_triage',
  ] as const;

  it.each(serviceFreePromptTypes)(
    'uses the CLI current directory without repository resolution for graph-only %s turns',
    async (promptType) => {
      vi.mocked(resolveRunWorkspace).mockClear();
      const runStore = makeRunStore();
      const captured: RunnerContext[] = [];
      const pickRunner = (ctx: RunnerContext): Runner => {
        captured.push(ctx);
        return { run: async () => {} };
      };
      const collaborators = makeCollaborators(runStore, pickRunner, declaredHandler(promptType));
      const session = makeSession({
        services: [],
        promptType,
      });
      delete session.launchServiceId;
      const run = new Run(
        makeRunArgs({
          session,
        }),
        collaborators,
      );

      await run.handleMessage(makeInput(promptType));

      expect(resolveRunWorkspace).not.toHaveBeenCalled();
      expect(captured).toHaveLength(1);
      expect(captured[0]!.cwd).toBe(process.cwd());
      expect(captured[0]!.workspace).toBeUndefined();
      expect(collaborators.logger.debug).toHaveBeenCalledWith(
        'local.run.turn_workspace.selected',
        expect.objectContaining({
          promptType,
          decision: 'graph_only_current_directory',
          cwd: process.cwd(),
          serviceCount: 0,
          launchServiceId: null,
        }),
      );
    },
  );

  it.each(serviceFreePromptTypes)(
    'keeps Service-free %s sessions graph-only for raw follow-up turns',
    async (sessionPromptType) => {
      vi.mocked(resolveRunWorkspace).mockClear();
      const runStore = makeRunStore();
      const captured: RunnerContext[] = [];
      const collaborators = makeCollaborators(
        runStore,
        (ctx) => {
          captured.push(ctx);
          return { run: async () => {} };
        },
        (promptType) =>
          promptType === sessionPromptType ? declaredHandler(promptType) : handlerStub,
      );
      const session = makeSession({
        services: [],
        promptType: sessionPromptType,
      });
      delete session.launchServiceId;
      const run = new Run(makeRunArgs({ session }), collaborators);

      await run.handleMessage(makeInput());

      expect(resolveRunWorkspace).not.toHaveBeenCalled();
      expect(captured).toHaveLength(1);
      expect(captured[0]!.cwd).toBe(process.cwd());
      expect(captured[0]!.workspace).toBeUndefined();
      expect(collaborators.logger.debug).toHaveBeenCalledWith(
        'local.run.turn_workspace.selected',
        expect.objectContaining({
          promptType: 'coding_freeform',
          sessionPromptType,
          decision: 'graph_only_current_directory',
        }),
      );
    },
  );

  it('keeps a selected-Service Search Agent session on repository workspace resolution', async () => {
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    };
    vi.mocked(resolveRunWorkspace).mockResolvedValueOnce(workspace);
    const runStore = makeRunStore();
    const captured: RunnerContext[] = [];
    const run = new Run(
      makeRunArgs({
        session: makeSession({ promptType: 'agent_search' }),
      }),
      makeCollaborators(runStore, (ctx) => {
        captured.push(ctx);
        return { run: async () => {} };
      }),
    );

    await run.handleMessage(makeInput('agent_search'));

    expect(resolveRunWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          services: [{ id: 'svc-1', path: '/repos/service-a' }],
          launchServiceId: 'svc-1',
          promptType: 'agent_search',
        }),
      }),
    );
    expect(captured[0]!.cwd).toBe('/repos/service-a');
    expect(captured[0]!.workspace).toBe(workspace);
  });

  it('publishes a typed Task Monitor collision before propagating the workspace error', async () => {
    const collision = new RunWorktreeCollisionError({
      serviceId: 'svc-1',
      repositoryPath: '/repos/service-a',
      branch: 'feature-branch',
      authority: 'TASK_MONITOR',
    });
    vi.mocked(resolveRunWorkspace).mockRejectedValueOnce(collision);
    const runStore = makeRunStore();
    const publishLaunchFailure = vi.fn().mockResolvedValue(undefined);
    const session = makeSession({
      entity: { entityType: 'TASK', entityId: 'task-1' },
      contextMetadata: {
        ...makeSession().contextMetadata,
        taskMonitorId: 'monitor-1',
      },
    });
    const run = new Run(makeRunArgs({ session }), {
      ...makeCollaborators(runStore, () => ({ run: async () => {} })),
      taskMonitorLaunchFailureRuntime: {
        publishLaunchFailure,
        clearLaunchFailures: vi.fn(),
      } as never,
    });

    await expect(run.handleMessage(makeInput())).rejects.toBe(collision);
    expect(publishLaunchFailure).toHaveBeenCalledWith({
      taskMonitorId: 'monitor-1',
      taskId: 'task-1',
      runId: 'run-1',
      agentSessionId: session.contextMetadata.agentSessionId,
      conversationId: 'conv-1',
      failure: collision.failure,
    });
  });

  it('does not publish a launch recovery event for a follow-up provider turn', async () => {
    const collision = new RunWorktreeCollisionError({
      serviceId: 'svc-1',
      repositoryPath: '/repos/service-a',
      branch: 'feature-branch',
      authority: 'TASK_MONITOR',
    });
    vi.mocked(resolveRunWorkspace).mockRejectedValueOnce(collision);
    const runStore = makeRunStore();
    const publishLaunchFailure = vi.fn().mockResolvedValue(undefined);
    const session = makeSession({
      entity: { entityType: 'TASK', entityId: 'task-1' },
      provider_session_id: 'provider-session-1',
      contextMetadata: {
        ...makeSession().contextMetadata,
        taskMonitorId: 'monitor-1',
        agentSessionId: 'agent-session-1',
      },
    });
    const run = new Run(makeRunArgs({ session, hasProviderSession: true }), {
      ...makeCollaborators(runStore, () => ({ run: async () => {} })),
      taskMonitorLaunchFailureRuntime: {
        publishLaunchFailure,
        clearLaunchFailures: vi.fn(),
      } as never,
    });

    await expect(run.handleMessage(makeInput())).rejects.toBe(collision);
    expect(publishLaunchFailure).not.toHaveBeenCalled();
  });

  it('preserves repository-required resolution for non-graph runs without services', async () => {
    vi.mocked(resolveRunWorkspace).mockClear();
    vi.mocked(resolveRunWorkspace).mockResolvedValueOnce({
      ok: false,
      code: 'REPO_BINDING_MISSING',
      message: 'Session has no resolved launch service; cannot resolve repository mapping.',
    });
    const runStore = makeRunStore();
    const session = makeSession({
      services: [],
      promptType: 'coding_freeform',
    });
    delete session.launchServiceId;
    const run = new Run(
      makeRunArgs({
        session,
      }),
      makeCollaborators(runStore, () => ({ run: async () => {} })),
    );

    await expect(run.handleMessage(makeInput())).rejects.toMatchObject({
      code: 'REPO_BINDING_MISSING',
      statusCode: 409,
    });
    expect(resolveRunWorkspace).toHaveBeenCalledOnce();
  });

  it('resolves provider-session worktree state before first-turn prompt construction', async () => {
    const worktreeState = {
      'svc-1': {
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature-branch',
      },
    };
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a/.worktrees/feature-branch',
      allowedRepositoryRoots: ['/repos/service-a/.worktrees/feature-branch'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
      worktree: worktreeState,
    };
    vi.mocked(resolveRunWorkspace).mockResolvedValueOnce(workspace);

    const runStore = makeRunStore();
    const captured: RunnerContext[] = [];
    const pickRunner = (ctx: RunnerContext): Runner => {
      captured.push(ctx);
      return {
        run: async () => {
          expect(ctx.run.session.worktreeState).toEqual(worktreeState);
        },
      };
    };

    const run = new Run(makeRunArgs(), makeCollaborators(runStore, pickRunner));

    await run.handleMessage(makeInput());

    expect(resolveRunWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          entity: null,
          agentic_session_id: 'run-1',
          launchServiceId: 'svc-1',
        }),
      }),
    );
    expect(runStore.updateRunWorktreeState).toHaveBeenCalledWith('run-1', worktreeState);
    expect(run.session.worktreeState).toEqual(worktreeState);
    expect(vi.mocked(resolvePrompt).mock.calls.at(-1)?.[0].run.worktreeState).toEqual(
      worktreeState,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.cwd).toBe('/repos/service-a/.worktrees/feature-branch');
    expect(captured[0]!.workspace).toBe(workspace);
    expect(captured[0]!.workspaceWriteBoundary).toBeUndefined();
  });

  it('keeps resolved worktree state authoritative for prompt construction when persistence fails', async () => {
    const worktreeState = {
      'svc-1': {
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature-branch',
      },
    };
    vi.mocked(resolveRunWorkspace).mockResolvedValueOnce({
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a/.worktrees/feature-branch',
      allowedRepositoryRoots: ['/repos/service-a/.worktrees/feature-branch'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
      worktree: worktreeState,
    });
    const runStore = makeRunStore();
    vi.mocked(runStore.updateRunWorktreeState).mockRejectedValueOnce(
      new Error('temporary persistence failure'),
    );
    const runner = vi.fn(() => ({ run: async () => {} }));
    const collaborators = makeCollaborators(runStore, runner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput());

    expect(run.session.worktreeState).toEqual(worktreeState);
    expect(vi.mocked(resolvePrompt).mock.calls.at(-1)?.[0].run.worktreeState).toEqual(
      worktreeState,
    );
    expect(runner).toHaveBeenCalledOnce();
    expect(collaborators.logger.error).toHaveBeenCalledWith(
      'local.run.turn_worktree_state_persist_failed',
      expect.objectContaining({ runId: 'run-1', sessionId: 'run-1' }),
    );
  });

  it('reuses one canonical write boundary across fresh and resumed Claude turns', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'run-boundary-'));
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: workspaceRoot,
      cwd: workspaceRoot,
      allowedRepositoryRoots: [workspaceRoot],
      bindingRepositoryPath: workspaceRoot,
      workspaceRoot: null,
    };
    vi.mocked(resolveRunWorkspace).mockResolvedValue(workspace);
    const captured: RunnerContext[] = [];
    const run = new Run(
      makeRunArgs({ provider: 'claude' }),
      makeCollaborators(makeRunStore(), (ctx) => {
        captured.push(ctx);
        return {
          run: async () => {
            ctx.run.setHasProviderSession(true, 'test-session-mint');
          },
        };
      }),
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();
    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(captured).toHaveLength(2);
    expect(captured[0]!.workspaceWriteBoundary).toBeDefined();
    expect(captured[1]!.workspaceWriteBoundary).toBe(captured[0]!.workspaceWriteBoundary);
    expect(captured[0]!.workspaceWriteBoundary?.allowedRepositoryRoots).toEqual([
      realpathSync(workspaceRoot),
    ]);
    run.cleanup();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  describe('mode-backed Run write boundary', () => {
    const modeConfig = {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'claude-opus',
      projectModeSelection: {
        schemaVersion: 'project-mode-selection.v1',
        modeId: '11111111-1111-4111-8111-111111111111',
      },
      projectModeSnapshot: {
        schemaVersion: 'project-mode-snapshot.v1',
        modeId: '11111111-1111-4111-8111-111111111111',
        catalogDescription: 'Captured mode',
        applicableWorkItemTypeKeys: ['STANDARD'],
        files: {
          schemaVersion: 'project-mode-files.v1',
          files: { 'MODE.md': 'Use the captured mode.' },
        },
        snapshotHash: 'a'.repeat(64),
      },
    };

    const runTwoTurns = async (
      promptTypes: readonly [string, string],
      config: object | undefined,
    ) => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'run-mode-boundary-'));
      // The materializer returns canonical paths.
      const bundleDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'run-mode-bundle-')));
      vi.mocked(resolveRunWorkspace).mockResolvedValue({
        ok: true,
        runMode: 'default',
        repositoryPathForRunStarted: workspaceRoot,
        cwd: workspaceRoot,
        allowedRepositoryRoots: [workspaceRoot],
        bindingRepositoryPath: workspaceRoot,
        workspaceRoot: null,
      });
      const materializer = {
        materialize: vi.fn().mockResolvedValue(bundleDirectory),
        dispose: vi.fn().mockResolvedValue(undefined),
      };
      const captured: RunnerContext[] = [];
      const collaborators = makeCollaborators(makeRunStore(), (ctx) => {
        captured.push(ctx);
        return {
          run: async () => {
            ctx.run.setHasProviderSession(true, 'test-session-mint');
          },
        };
      });
      const run = new Run(
        makeRunArgs({
          provider: 'claude',
          session: makeSession({ provider: 'claude', config } as Partial<AgenticSession>),
        }),
        {
          ...collaborators,
          projectModeBundleMaterializer: materializer as unknown as NonNullable<
            RunCollaborators['projectModeBundleMaterializer']
          >,
        },
      );
      for (const promptType of promptTypes) {
        await run.handleMessage(makeInput(promptType));
        await run.awaitIdle();
      }
      run.cleanup();
      const cleanupDirs = () => {
        rmSync(workspaceRoot, { recursive: true, force: true });
        rmSync(bundleDirectory, { recursive: true, force: true });
      };
      return { captured, workspaceRoot, bundleDirectory, materializer, collaborators, cleanupDirs };
    };

    it.each([
      [['project_assistant', 'project_mode']],
      [['project_mode', 'project_assistant']],
    ] as const)(
      'starts both turns of %j with one boundary that includes the bundle',
      async (order) => {
        const { captured, workspaceRoot, bundleDirectory, collaborators, cleanupDirs } =
          await runTwoTurns(order, modeConfig);

        expect(captured).toHaveLength(2);
        expect(captured[1]!.workspaceWriteBoundary).toBe(captured[0]!.workspaceWriteBoundary);
        expect(captured[0]!.workspaceWriteBoundary?.readOnlyDirectories).toEqual([
          realpathSync(bundleDirectory),
        ]);
        expect(captured[0]!.workspaceWriteBoundary?.allowedRepositoryRoots).toEqual([
          realpathSync(workspaceRoot),
        ]);
        expect(collaborators.logger.error).not.toHaveBeenCalledWith(
          'local.run.workspace_write_boundary.identity_changed',
          expect.anything(),
        );
        cleanupDirs();
      },
    );

    it('passes no read-only directories for a Run without a captured mode', async () => {
      const { captured, materializer, cleanupDirs } = await runTwoTurns(
        ['coding_freeform', 'coding_freeform'],
        undefined,
      );

      expect(captured).toHaveLength(2);
      expect(captured[0]!.workspaceWriteBoundary?.readOnlyDirectories).toEqual([]);
      expect(materializer.materialize).not.toHaveBeenCalled();
      cleanupDirs();
    });
  });

  it('reconciles approved plan Services before preparing or running the provider turn', async () => {
    const resolvedServices = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    const worktreeState = {
      'svc-1': {
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature-branch',
      },
      'svc-2': {
        repoPath: '/repos/service-b',
        worktreePath: '/repos/service-b/.worktrees/feature-branch',
        branch: 'feature-branch',
      },
    };
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a/.worktrees/feature-branch',
      cwd: '/repos/service-a/.worktrees/feature-branch',
      allowedRepositoryRoots: [
        '/repos/service-a/.worktrees/feature-branch',
        '/repos/service-b/.worktrees/feature-branch',
      ],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
      worktree: worktreeState,
    };
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({
      ok: true,
      services: resolvedServices,
    });
    vi.mocked(resolveRunWorkspace).mockResolvedValue(workspace);

    const runStore = makeRunStore();
    const captured: RunnerContext[] = [];
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(runStore, (ctx) => {
        captured.push(ctx);
        return { run: async () => {} };
      }),
    );

    await run.handleMessage(makePlanExecutionInput());

    expect(resolveServiceBindingsForIds).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceIds: ['svc-1', 'svc-2'],
      }),
    );
    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services: resolvedServices,
      launchServiceId: 'svc-1',
    });
    expect(runStore.updateRunWorktreeState).toHaveBeenCalledWith('run-1', worktreeState);
    expect(resolveRunWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          services: resolvedServices,
          launchServiceId: 'svc-1',
        }),
      }),
    );
    expect(run.session.services).toEqual(resolvedServices);
    expect(run.session.launchServiceId).toBe('svc-1');
    expect(run.session.worktreeState).toEqual(worktreeState);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.workspace?.allowedRepositoryRoots).toContain(
      '/repos/service-b/.worktrees/feature-branch',
    );
  });

  it('reconciles Coding Plan Services on the workflow-defined Implement transition', async () => {
    const resolvedServices = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a', '/repos/service-b'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    };
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({
      ok: true,
      services: resolvedServices,
    });
    vi.mocked(resolveRunWorkspace).mockResolvedValue(workspace);

    const runStore = makeRunStore();
    const captured: RunnerContext[] = [];
    const runner = vi.fn((ctx: RunnerContext) => {
      captured.push(ctx);
      return { run: async () => {} };
    });
    const run = new Run(
      makeRunArgs({ session: makeSession({ promptType: 'startup_session' }) }),
      makeCollaborators(runStore, runner, implementHandlerStub),
    );

    await run.handleMessage(makeInput('implement'));

    expect(resolveServiceBindingsForIds).toHaveBeenCalledWith(
      expect.objectContaining({ serviceIds: ['svc-1', 'svc-2'] }),
    );
    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services: resolvedServices,
      launchServiceId: 'svc-1',
    });
    expect(run.session.services).toEqual(resolvedServices);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.workspace?.allowedRepositoryRoots).toEqual([
      '/repos/service-a',
      '/repos/service-b',
    ]);
    expect(captured[0]?.preparedPayload).toMatchObject({
      _services: resolvedServices,
      _launchServiceId: 'svc-1',
    });
    expect(vi.mocked(runStore.updateRunServices).mock.invocationCallOrder[0]).toBeLessThan(
      runner.mock.invocationCallOrder[0]!,
    );
  });

  it('remints the Claude write boundary on the Turn after approved Service scope expands', async () => {
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a', '/repos/service-b'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    };
    vi.mocked(resolveRunWorkspace).mockResolvedValue(workspace);
    const previousBoundary = {
      allowedRepositoryRoots: ['/repos/service-a'],
      matchesWorkspace: vi.fn(
        (candidate: ResolvedRunWorkspace) => candidate.allowedRepositoryRoots.length === 1,
      ),
      dispose: vi.fn(async () => {}),
    };
    const captured: RunnerContext[] = [];
    const run = new Run(
      makeRunArgs({ provider: 'claude' }),
      makeCollaborators(makeRunStore(), (ctx) => {
        captured.push(ctx);
        return { run: async () => {} };
      }),
    );
    (
      run as unknown as { workspaceWriteBoundary: typeof previousBoundary | null }
    ).workspaceWriteBoundary = previousBoundary;

    await run.applyApprovedServiceScope({
      services: [
        { id: 'svc-1', path: '/repos/service-a' },
        { id: 'svc-2', path: '/repos/service-b' },
      ],
      launchServiceId: 'svc-1',
      workspace,
    });
    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(previousBoundary.dispose).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.workspaceWriteBoundary?.allowedRepositoryRoots).toEqual([
      '/repos/service-a',
      '/repos/service-b',
    ]);
    run.cleanup();
  });

  it('remints a non-Codex write boundary when the Implement plan expands its workspace', async () => {
    const resolvedServices = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a',
      cwd: '/repos/service-a',
      allowedRepositoryRoots: ['/repos/service-a', '/repos/service-b'],
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
    };
    const initialWorkspace: ResolvedRunWorkspace = {
      ...workspace,
      allowedRepositoryRoots: ['/repos/service-a'],
    };
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({
      ok: true,
      services: resolvedServices,
    });
    vi.mocked(resolveRunWorkspace)
      .mockResolvedValueOnce(initialWorkspace)
      .mockResolvedValue(workspace);

    const previousBoundary = {
      allowedRepositoryRoots: ['/repos/service-a'],
      matchesWorkspace: vi.fn(
        (candidate: ResolvedRunWorkspace) => candidate.allowedRepositoryRoots.length === 1,
      ),
      dispose: vi.fn(async () => {}),
    };
    const captured: RunnerContext[] = [];
    const run = new Run(
      makeRunArgs({
        provider: 'claude',
        session: makeSession({ provider: 'claude', promptType: 'startup_session' }),
      }),
      makeCollaborators(
        makeRunStore(),
        (ctx) => {
          captured.push(ctx);
          return { run: async () => {} };
        },
        implementHandlerStub,
      ),
    );
    (
      run as unknown as {
        workspaceWriteBoundary: typeof previousBoundary | null;
      }
    ).workspaceWriteBoundary = previousBoundary;

    await run.handleMessage(makeInput('implement'));

    expect(previousBoundary.matchesWorkspace).toHaveBeenNthCalledWith(1, initialWorkspace, []);
    expect(previousBoundary.matchesWorkspace).toHaveBeenNthCalledWith(2, workspace);
    expect(previousBoundary.dispose).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.workspaceWriteBoundary?.allowedRepositoryRoots).toEqual([
      '/repos/service-a',
      '/repos/service-b',
    ]);
    run.cleanup();
  });

  it('blocks the Implement transition when the approved Coding Plan is unavailable', async () => {
    const runStore = makeRunStore();
    const runner = vi.fn(() => ({ run: async () => {} }));
    const run = new Run(
      makeRunArgs({ session: makeSession({ promptType: 'startup_session' }) }),
      makeCollaborators(runStore, runner, implementHandlerStub),
    );
    const input = {
      ...makeInput('implement'),
      payload: { promptType: 'implement', userMessage: 'missing-plan' },
    } as InternalRunPromptRequest;

    await expect(run.handleMessage(input)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      statusCode: 400,
    });

    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('does not persist approved Services when an added Service worktree cannot resolve', async () => {
    const resolvedServices = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({
      ok: true,
      services: resolvedServices,
    });
    vi.mocked(resolveRunWorkspace).mockResolvedValueOnce({
      ok: false,
      code: 'REPO_BINDING_MISSING',
      message: 'Unable to resolve the configured worktree for Service svc-2.',
    });
    const runStore = makeRunStore();
    const runner = vi.fn(() => ({ run: async () => {} }));
    const run = new Run(makeRunArgs(), makeCollaborators(runStore, runner));

    await expect(run.handleMessage(makePlanExecutionInput())).rejects.toMatchObject({
      code: 'REPO_BINDING_MISSING',
      statusCode: 409,
    });

    expect(resolveRunWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          services: resolvedServices,
          launchServiceId: 'svc-1',
          worktree: { enabled: true, branch: 'feature-branch' },
        }),
      }),
    );
    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(runStore.updateRunWorktreeState).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('keeps approved Service scope executable when worktree-state persistence fails', async () => {
    const resolvedServices = [
      { id: 'svc-1', path: '/repos/service-a' },
      { id: 'svc-2', path: '/repos/service-b' },
    ];
    const worktreeState = {
      'svc-1': {
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature-branch',
      },
      'svc-2': {
        repoPath: '/repos/service-b',
        worktreePath: '/repos/service-b/.worktrees/feature-branch',
        branch: 'feature-branch',
      },
    };
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({
      ok: true,
      services: resolvedServices,
    });
    vi.mocked(resolveRunWorkspace).mockResolvedValue({
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: '/repos/service-a/.worktrees/feature-branch',
      cwd: '/repos/service-a/.worktrees/feature-branch',
      allowedRepositoryRoots: Object.values(worktreeState).map(({ worktreePath }) => worktreePath),
      bindingRepositoryPath: '/repos/service-a',
      workspaceRoot: null,
      worktree: worktreeState,
    });
    const runStore = makeRunStore();
    vi.mocked(runStore.updateRunWorktreeState).mockRejectedValue(new Error('disk unavailable'));
    const runner = vi.fn(() => ({ run: async () => {} }));
    const collaborators = makeCollaborators(runStore, runner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makePlanExecutionInput());

    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services: resolvedServices,
      launchServiceId: 'svc-1',
    });
    expect(run.session.services).toEqual(resolvedServices);
    expect(run.session.worktreeState).toEqual(worktreeState);
    expect(runner).toHaveBeenCalledOnce();
    expect(collaborators.logger.error).toHaveBeenCalledWith(
      'local.run.plan_execution.worktree_state_persist_failed',
      expect.objectContaining({
        runId: 'run-1',
        serviceIds: ['svc-1', 'svc-2'],
      }),
    );
  });

  it('blocks plan execution before provider selection when an approved Service cannot resolve', async () => {
    vi.mocked(resolveServiceBindingsForIds).mockResolvedValueOnce({
      ok: false,
      code: 'REPO_BINDING_MISSING',
      serviceId: 'svc-2',
      message: 'Approved Coding Plan scope cannot access the workspace for Service svc-2.',
    });
    const runStore = makeRunStore();
    const runner = vi.fn(() => ({ run: async () => {} }));
    const run = new Run(makeRunArgs(), makeCollaborators(runStore, runner));

    await expect(run.handleMessage(makePlanExecutionInput())).rejects.toMatchObject({
      code: 'REPO_BINDING_MISSING',
      statusCode: 409,
    });

    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });
});
