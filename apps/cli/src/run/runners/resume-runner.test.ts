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

import { ResumeRunner, type ResumeRunnerDeps } from './resume-runner';
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
    provider_session_id: 'session-abc',
    provider_conversation_id: 'conv-abc',
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
  references: { resolved: [], unresolved: [] },
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
  providerSessionDecision: 'resume',
});

type ResumeSessionMethod = ResumeRunnerDeps['sessionRunnerFacade']['resumeSession'];
const sessionRunnerFacadeFor = (
  resumeSession: (args: Parameters<ResumeSessionMethod>[1]) => ReturnType<ResumeSessionMethod>,
): ResumeRunnerDeps['sessionRunnerFacade'] => {
  const facade = createTestSessionRunnerFacade();
  vi.mocked(facade.resumeSession).mockImplementation((_run, args) => resumeSession(args));
  return facade;
};

describe('ResumeRunner', () => {
  it('logs retained startup provenance when resuming the provider session', async () => {
    const run = new Run(makeRunArgs({ hasProviderSession: true }), makeCollaborators());
    const logger = makeLogger();
    const resumeSession = vi.fn().mockResolvedValue({
      providerSessionId: 'session-abc',
      providerConversationId: 'conv-abc',
      errorCount: 0,
    });
    const ctx: RunnerContext = {
      ...makeCtx(run, 'follow-up text'),
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
          ownershipSource: { scope: 'PROJECT', projectId: 'proj-1' },
          revisionId: 'revision-2',
          revisionNumber: 2,
        },
      },
    };

    await new ResumeRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
      logger,
    }).run(new AbortController().signal);

    expect(logger.info).toHaveBeenCalledWith('local.run.provider_session.startup_context', {
      runId: 'run-1',
      providerSessionAction: 'resume',
      startupInputDelivered: false,
      templateKey: 'task',
      ownershipSource: { scope: 'PROJECT', projectId: 'proj-1' },
      revisionId: 'revision-2',
      revisionNumber: 2,
    });
    expect(resumeSession.mock.calls[0]?.[0]).toMatchObject({ prompt: 'follow-up text' });
  });

  it('forwards the Run-held session, resolvedPrompt, and signal to resumeSession', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ hasProviderSession: true, session }), makeCollaborators());

    const resumeSession = vi.fn().mockResolvedValue({
      providerSessionId: 'session-abc',
      providerConversationId: 'conv-abc',
      errorCount: 0,
    });

    const runner = new ResumeRunner(makeCtx(run, 'follow-up text'), {
      sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
      logger: makeLogger(),
    });

    const controller = new AbortController();
    await runner.run(controller.signal);

    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(resumeSession).toHaveBeenCalledWith({
      session,
      attachments: [],
      attachmentRunId: run.runId,
      prompt: 'follow-up text',
      signal: controller.signal,
    });
  });

  it('forwards the pathless Skill selection with a resumed follow-up', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ hasProviderSession: true, session }), makeCollaborators());
    const resumeSession = vi.fn().mockResolvedValue({
      providerSessionId: 'session-abc',
      providerConversationId: 'conv-abc',
      errorCount: 0,
    });
    const skillSelection = {
      provider: 'codex' as const,
      name: 'release-check',
      catalogScope: 'repo' as const,
    };

    const runner = new ResumeRunner(
      {
        ...makeCtx(run, 'follow-up text'),
        input: { ...makeInput(), skillSelection },
      },
      {
        sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
        logger: makeLogger(),
      },
    );

    await runner.run(new AbortController().signal);

    expect(resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        prompt: 'follow-up text',
        skillSelection,
      }),
    );
  });

  it('omits prompt when resolvedPrompt is empty (resume-only continuation)', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ hasProviderSession: true, session }), makeCollaborators());

    const resumeSession = vi.fn().mockResolvedValue({
      providerSessionId: 'session-abc',
      providerConversationId: 'conv-abc',
      errorCount: 0,
    });

    const runner = new ResumeRunner(makeCtx(run, ''), {
      sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
      logger: makeLogger(),
    });

    const signal = new AbortController().signal;
    await runner.run(signal);

    expect(resumeSession).toHaveBeenCalledWith({
      session,
      signal,
      attachments: [],
      attachmentRunId: run.runId,
    });
  });

  it('forwards Run-resolved dynamic additionalAllowedTools into resumeSession', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ hasProviderSession: true, session }), makeCollaborators());

    const resumeSession = vi.fn().mockResolvedValue({
      providerSessionId: 'session-abc',
      providerConversationId: 'conv-abc',
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
      resolvedPrompt: 'follow-up text',
      input: {
        ...makeInput(),
        payload: { promptType: 'coding_freeform', kind: 'coding_freeform' } as never,
      },
      preparedPayload: { promptType: 'coding_freeform', kind: 'plan' },
      cwd: '/tmp/test-cwd',
      effectiveModel: null,
      effectiveReasoningEffort: null,
      priorReports: [],
      providerSessionDecision: 'resume',
      platformMcpAdditionalAllowedTools: ['create_stage', 'create_step', 'move_step'],
    };

    const runner = new ResumeRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    const call = resumeSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['additionalAllowedTools']).toEqual(['create_stage', 'create_step', 'move_step']);
  });

  it('forwards the scoped platform MCP proxy mount', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ hasProviderSession: true, session }), makeCollaborators());
    const resumeSession = vi.fn().mockResolvedValue({
      providerSessionId: 'session-abc',
      providerConversationId: 'conv-abc',
      errorCount: 0,
    });
    const ctx: RunnerContext = {
      ...makeCtx(run, 'follow-up text'),
      platformMcpProxyMount: {
        runId: 'run-1',
        turnId: 'turn-1',
        token: 'proxy-token-1',
        allowedTools: ['mcp__heyhey-platform__get_context'],
      },
    };

    const runner = new ResumeRunner(ctx, {
      sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    const call = resumeSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['platformMcpProxyMount']).toEqual({
      runId: 'run-1',
      turnId: 'turn-1',
      token: 'proxy-token-1',
      allowedTools: ['mcp__heyhey-platform__get_context'],
    });
  });

  it('propagates resumeSession errors', async () => {
    const run = new Run(makeRunArgs({ hasProviderSession: true }), makeCollaborators());
    const failure = new Error('resume boom');
    const resumeSession = vi.fn().mockRejectedValue(failure);

    const runner = new ResumeRunner(makeCtx(run, 'anything'), {
      sessionRunnerFacade: sessionRunnerFacadeFor(resumeSession),
      logger: makeLogger(),
    });

    await expect(runner.run(new AbortController().signal)).rejects.toBe(failure);
  });
});

describe('later role advice at provider handoff', () => {
  it('precedes the affected input and acknowledges only a successful handoff', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const acknowledge = vi
      .spyOn(run.sessionRoleGuidance, 'acknowledge')
      .mockResolvedValue(undefined);
    const facade = createTestSessionRunnerFacade();
    vi.mocked(facade.resumeSession).mockResolvedValue({
      providerSessionId: null,
      providerConversationId: null,
      errorCount: 0,
    });
    const ctx = {
      ...makeCtx(run, 'NEW USER INPUT'),
      roleGuidance: {
        text: 'LATER DIAGRAM ADVICE',
        deliveryKeys: ['implementation:DIAGRAM'],
        resolutions: [],
        failedTypeKeys: [],
      },
    };
    await new ResumeRunner(ctx, { sessionRunnerFacade: facade, logger: makeLogger() }).run(
      new AbortController().signal,
    );
    expect(vi.mocked(facade.resumeSession).mock.calls[0]![1].prompt).toBe(
      'LATER DIAGRAM ADVICE\n\nNEW USER INPUT',
    );
    expect(acknowledge).toHaveBeenCalledOnce();
    acknowledge.mockClear();
    vi.mocked(facade.resumeSession).mockRejectedValue(Error('handoff failed'));
    await expect(
      new ResumeRunner(ctx, { sessionRunnerFacade: facade, logger: makeLogger() }).run(
        new AbortController().signal,
      ),
    ).rejects.toThrow('handoff failed');
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
