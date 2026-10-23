import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunOwnership,
  createTestRunStore,
  createRunTestOAuthClient,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from '../run.test-support';

import { SubagentRunner } from './subagent-runner';
import { ChildAgentLauncher } from '../child-agent-launcher';
import { Run, type RunArgs, type RunCollaborators } from '../run';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../../session/types';
import type {
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  SubagentConfig,
} from '../../agents/prompt-type-handler';
import type { RunnerContext } from './types';
import { LocalAgentEndpoint } from '../../server/local-base-url';

const subAgentHarness = vi.hoisted(() => ({
  constructedWith: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../subagent', () => ({
  SubAgent: class {
    public constructor(args: unknown) {
      subAgentHarness.constructedWith(args);
    }

    public execute() {
      return subAgentHarness.execute();
    }
  },
}));

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    services: [{ id: 'svc-1', path: '/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
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

const makeInput = (payload: unknown = { foo: 'bar' }): InternalRunPromptRequest =>
  ({
    promptType: 'commit',
    payload,
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

const makeSubagentHandler = (): PromptTypeHandler<unknown> => ({
  id: 'implement',
  promptType: 'implement',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated',
  runnerKind: 'subagent',
  providerSessionCountsForContext: false,
  reports: [],
  subagentConfig: makeConfig(),
  buildPrompt: () => 'unused',
});

const makeCtx = (run: Run, input: InternalRunPromptRequest): RunnerContext => ({
  run,
  turnId: 'turn-1',
  handler: makeSubagentHandler(),
  resolvedPrompt: '',
  input,
  cwd: '/tmp/test-cwd',
  effectiveModel: null,
  effectiveReasoningEffort: null,
  priorReports: [],
});

const makeConfig = (): SubagentConfig => ({
  mcpAllowedTools: [],
  builtinAllowedTools: [],
  adapterId: 'test-subagent',
});

const makeRunnerDeps = (liveFiles: readonly string[] = []) => {
  const ownership = createTestRunOwnership();
  const oauthClient = createRunTestOAuthClient({ success: true, data: 'token' });
  const logger = makeLogger();
  const localAgentEndpoint = new LocalAgentEndpoint();
  return {
    oauthClient,
    logger,
    childAgentLauncher: new ChildAgentLauncher({
      promptTypeRegistry: ownership.promptTypeRegistry,
      repoStore: createTestRepoMappingStore(),
      oauthClient,
      submissionToolRegistry: ownership.submissionToolRegistry,
      localAgentEndpoint,
      logger,
    }),
    runChangedFilesReader: createTestRunChangedFilesReader(
      vi.fn().mockResolvedValue(
        liveFiles.map((file) => ({
          serviceId: 'svc-1',
          repoPath: path.dirname(file),
          filePath: path.basename(file),
          diff: '',
          preContent: null,
          postContent: null,
        })),
      ),
    ),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint,
  };
};

beforeEach(() => {
  subAgentHarness.constructedWith.mockReset();
  subAgentHarness.execute.mockReset().mockResolvedValue({ assistantCompleted: true });
});

describe('SubagentRunner', () => {
  it('constructs and executes the concrete SubAgent owner', async () => {
    const session = makeSession();
    const run = new Run(makeRunArgs({ session }), makeCollaborators());
    run.touchedFiles.add('src/a.ts');
    run.touchedFiles.add('src/b.ts');

    const input = makeInput({ changedFiles: ['src/a.ts'] });
    const deps = makeRunnerDeps(['/repo/src/a.ts']);

    const runner = new SubagentRunner(
      {
        ...makeCtx(run, input),
        handler: { ...makeSubagentHandler(), promptType: 'commit' },
      },
      makeConfig(),
      deps,
    );

    const controller = new AbortController();
    await runner.run(controller.signal);

    expect(subAgentHarness.execute).toHaveBeenCalledTimes(1);

    const forwarded = subAgentHarness.constructedWith.mock.calls[0]![0] as Record<string, unknown>;
    expect(forwarded['session']).toBe(session);
    expect(forwarded['payload']).toEqual({ changedFiles: ['/repo/src/a.ts'] });
    expect(forwarded['touchedFiles']).toEqual(['/repo/src/a.ts']);
    expect(forwarded['onAgentOutput']).not.toBe(run.onAgentOutput);
    const ingress = vi.spyOn(run, 'onActiveTurnAgentOutput').mockImplementation(() => undefined);
    (forwarded['onAgentOutput'] as (message: Parameters<Run['onAgentOutput']>[0]) => void)({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'ephemeral-session',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });
    expect(ingress).toHaveBeenCalledWith('turn-1', expect.any(Object));
    expect(forwarded['oauthClient']).toBe(deps.oauthClient);
    expect(forwarded['logger']).toBe(deps.logger);
    expect(forwarded['signal']).toBe(controller.signal);
  });

  it('forwards ctx.preparedPayload so handler.prepare enrichment reaches SubAgent', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const input = makeInput({ userMessage: 'raw' });

    const preparedPayload = {
      userMessage: 'raw',
      _approvedPlan: '{"sessionTitle":"Approved"}',
      _serviceId: 'svc-1',
    };

    const runner = new SubagentRunner(
      {
        run,
        turnId: 'turn-1',
        handler: makeSubagentHandler(),
        resolvedPrompt: '',
        input,
        preparedPayload,
        cwd: '/tmp/test-cwd',
        effectiveModel: null,
        effectiveReasoningEffort: null,
        priorReports: [],
      },
      makeConfig(),
      makeRunnerDeps(),
    );

    await runner.run(new AbortController().signal);

    const forwarded = subAgentHarness.constructedWith.mock.calls[0]![0] as Record<string, unknown>;
    expect(forwarded['payload']).toBe(preparedPayload);
    expect(forwarded['payload']).not.toBe(input.payload);
  });

  it('forwards ctx.priorReports so the chain reaches subagent prompt assembly', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const input = makeInput();

    const priorReports = [
      Object.freeze({
        createdAt: '2026-04-26T01:00:00.000Z',
        phase: 'startup_session' as const,
        reportId: 'rep-startup',
        reportType: 'SESSION_SUMMARY' as const,
        summary: 'startup body',
        audience: 'EXTERNAL' as const,
      }),
    ];

    const runner = new SubagentRunner(
      { ...makeCtx(run, input), priorReports },
      makeConfig(),
      makeRunnerDeps(),
    );

    await runner.run(new AbortController().signal);

    const forwarded = subAgentHarness.constructedWith.mock.calls[0]![0] as Record<string, unknown>;
    expect(forwarded['priorReports']).toBe(priorReports);
  });

  it("forwards Review and optional prior Reports through the same runner with the Run's canonical file scope", async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.touchedFiles.add('/repo/src/review.ts');
    const payload = {};
    const priorReports = [
      Object.freeze({
        createdAt: '2026-04-26T01:00:00.000Z',
        phase: 'implement' as const,
        reportId: 'report-implement',
        reportType: 'IMPLEMENT' as const,
        summary: 'optional implementation context',
        audience: 'EXTERNAL' as const,
      }),
    ];
    const handler = {
      ...makeSubagentHandler(),
      promptType: 'code_review' as const,
    };
    const runner = new SubagentRunner(
      { ...makeCtx(run, makeInput(payload)), handler, priorReports },
      makeConfig(),
      makeRunnerDeps(),
    );

    await runner.run(new AbortController().signal);

    expect(subAgentHarness.execute).toHaveBeenCalledTimes(1);
    expect(subAgentHarness.constructedWith.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        payload,
        priorReports,
        touchedFiles: ['/repo/src/review.ts'],
      }),
    );
  });

  it('forwards effectiveModel/effectiveReasoningEffort into SubAgent', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const input = makeInput();

    const runner = new SubagentRunner(
      {
        ...makeCtx(run, input),
        effectiveModel: 'claude-opus-4-8',
        effectiveReasoningEffort: 'high',
      },
      makeConfig(),
      makeRunnerDeps(),
    );

    await runner.run(new AbortController().signal);

    const forwarded = subAgentHarness.constructedWith.mock.calls[0]![0] as Record<string, unknown>;
    expect(forwarded['model']).toBe('claude-opus-4-8');
    expect(forwarded['reasoningEffort']).toBe('high');
  });

  it('omits model/reasoningEffort when ctx resolves them to null', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const input = makeInput();
    const runner = new SubagentRunner(makeCtx(run, input), makeConfig(), makeRunnerDeps());

    await runner.run(new AbortController().signal);

    const forwarded = subAgentHarness.constructedWith.mock.calls[0]![0] as Record<string, unknown>;
    expect('model' in forwarded).toBe(false);
    expect('reasoningEffort' in forwarded).toBe(false);
  });

  it('propagates SubAgent errors', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const failure = new Error('spawn boom');
    subAgentHarness.execute.mockRejectedValue(failure);
    const runner = new SubagentRunner(makeCtx(run, makeInput()), makeConfig(), makeRunnerDeps());

    await expect(runner.run(new AbortController().signal)).rejects.toBe(failure);
  });

  it('invokes feature-owned post-processing after the subagent result', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const result = { assistantCompleted: true };
    subAgentHarness.execute.mockResolvedValue(result);
    const onSubagentComplete = vi.fn().mockResolvedValue(undefined);
    const handler = {
      ...makeSubagentHandler(),
      promptType: 'commit' as const,
      onSubagentComplete,
    };

    const runner = new SubagentRunner(
      { ...makeCtx(run, makeInput()), handler },
      makeConfig(),
      makeRunnerDeps(['/repo/a.ts']),
    );
    await runner.run(new AbortController().signal);

    expect(onSubagentComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        touchedFiles: ['/repo/a.ts'],
        result,
      }),
    );
  });
});
