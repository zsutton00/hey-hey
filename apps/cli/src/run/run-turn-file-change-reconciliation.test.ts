import { NOOP_LOGGER } from '../server/logger';
import { ResumeRunner } from './runners/resume-runner';
import type { RunnerContext } from './runners/types';
import { completionResponseHooks } from '../agents/completion-reconciliation/message-mapper';
import { reportChangedFilesTool } from '../agents/submission-tools/report-changed-files-tool';
import { resolveReportedFileChanges } from './file-change-facts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { PassThroughSubmissionToolDeclaration } from '../agents/submission-tools/types';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from './run.test-support';
import type { Runner } from '../turn/turn';

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: async () => ({
    resolvedPrompt: 'resolved',
    startingMessage: undefined,
    sessionContext: undefined,
    preparedPayload: undefined,
    isSubagentOwned: false,
    consumedPreviousProviderSession: false,
    promptTypeChanged: false,
  }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const tempDirs: string[] = [];

const quickHandler: PromptTypeHandler<unknown> = {
  id: LocalPromptType.Quick,
  promptType: LocalPromptType.Quick,
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'task-only prompt',
};

const makeSession = (
  repositoryRoot: string,
  provider: 'claude' | 'codex' = 'claude',
): AgenticSession =>
  ({
    entity: { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
    agentic_session_id: 'run-1',
    provider,
    provider_session_id: 'provider-1',
    provider_session_agent_id: LocalPromptType.Quick,
    provider_conversation_id: null,
    status: 'idle',
    services: [{ id: 'service-1', path: repositoryRoot }],
    launchServiceId: 'service-1',
    conversationId: 'conversation-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'project-1' },
    scope: {
      mode: 'default',
      workspaceRoot: repositoryRoot,
      allowedRepositoryRoots: [repositoryRoot],
    },
    events: [],
    promptType: null,
  }) as unknown as AgenticSession;

const makeRunArgs = (repositoryRoot: string, provider: 'claude' | 'codex' = 'claude'): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  provider,
  session: makeSession(repositoryRoot, provider),
  hasProviderSession: true,
});

const makeInput = (): InternalRunPromptRequest =>
  ({
    promptType: LocalPromptType.Quick,
    payload: { promptType: LocalPromptType.Quick, userMessage: 'inspect the workspace' },
    references: { resolved: [], unresolved: [] },
    triggerMessageId: null,
  }) as unknown as InternalRunPromptRequest;

const makeHarness = (
  repositoryRoot: string,
  runner: Runner | ((ctx: RunnerContext) => Runner),
  provider: 'claude' | 'codex' = 'claude',
  handler: PromptTypeHandler<unknown> = quickHandler,
) => {
  const runStore = createTestRunStore();
  const appendFileChangeFacts = vi
    .spyOn(runStore, 'appendFileChangeFacts')
    .mockResolvedValue(undefined);
  vi.spyOn(runStore, 'updateRunPromptType').mockResolvedValue(
    makeSession(repositoryRoot, provider),
  );
  vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue(
    makeSession(repositoryRoot, provider),
  );
  vi.spyOn(runStore, 'updateRunWorktreeState').mockResolvedValue(
    makeSession(repositoryRoot, provider),
  );
  vi.spyOn(runStore, 'updateRunPreviousProviderSession').mockResolvedValue(
    makeSession(repositoryRoot, provider),
  );
  vi.spyOn(runStore, 'getRun').mockResolvedValue(null);

  const createReport = vi.fn().mockResolvedValue({ content: [] });
  const createReportTool: PassThroughSubmissionToolDeclaration = {
    kind: 'pass_through',
    name: 'create_report',
    description: 'Persist a report.',
    inputSchema: {},
    execute: createReport,
  };
  const loggerDebug = vi.fn<RunCollaborators['logger']['debug']>();
  const loggerInfo = vi.fn<RunCollaborators['logger']['info']>();
  const logger = {
    trace: vi.fn<RunCollaborators['logger']['trace']>(),
    debug: loggerDebug,
    info: loggerInfo,
    warn: vi.fn<RunCollaborators['logger']['warn']>(),
    error: vi.fn<RunCollaborators['logger']['error']>(),
    child: vi.fn<RunCollaborators['logger']['child']>(),
  } as RunCollaborators['logger'];
  const collaborators: RunCollaborators = {
    runStore: runStore as RunStore,
    repoStore: createTestRepoMappingStore(),
    poster: createTestMessagePoster(),
    broadcaster: createTestRunEventPublisher(),
    ...createTestRunOwnership((promptType) =>
      promptType === LocalPromptType.Quick ? handler : undefined,
    ),
    handlerDeps: {} as unknown as PromptTypeHandlerDeps,
    runnerPicker: createTestRunnerPicker(typeof runner === 'function' ? runner : () => runner),
    baseSubmissionTools: [createReportTool],
    logger,
  };
  return {
    run: new Run(makeRunArgs(repositoryRoot, provider), collaborators),
    runStore,
    poster: collaborators.poster,
    appendFileChangeFacts,
    createReport,
    logger,
    loggerDebug,
    loggerInfo,
  };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('same-Turn changed-file reporting recovery', () => {
  it.each([
    'repaired',
    'exhausted',
    'stale_after_edit',
    'late_edit',
    'mixed',
    'retry',
    'reporting_write_failure',
    'omitted',
    'omitted_confirmed_edit',
    'omitted_uncertain_edit',
    'explicit_empty',
    'in_flight_invalid',
  ] as const)('retains the answer and settles %s once', async (outcome) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'reporting-recovery-'));
    tempDirs.push(repositoryRoot);
    if (outcome === 'mixed') {
      execFileSync('git', ['init'], { cwd: repositoryRoot });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
      await writeFile(path.join(repositoryRoot, 'base.ts'), 'base');
      execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: repositoryRoot });
      await writeFile(path.join(repositoryRoot, 'feature.ts'), 'changed');
    }
    const handler: PromptTypeHandler<unknown> = {
      ...quickHandler,
      ...completionResponseHooks,
      requiresChangedFileReporting: true,
      submissionTools: [reportChangedFilesTool],
    };
    let run: Run;
    const turnIds: string[] = [];
    const emitCompletion = (summary: string) =>
      run.onAgentOutput({
        event: {
          source: 'provider',
          eventType: 'agent_output',
          sessionId: 'provider-1',
          agentId: 'claude',
          timestamp: '2026-10-08T18:00:00.000Z',
          payload: { messageType: 'assistant', taskComplete: true, summary },
        },
      });
    const submit = async (changedFiles: Array<object | null>, turnId = run.activeTurn!.turnId) =>
      reportChangedFilesTool.execute({
        runId: run.runId,
        run,
        args: { turnId, providerSessionId: 'provider-1', changedFiles },
      });
    const resumeSession = vi.fn(
      async (args: import('../agents/providers/session-runner').ResumeArgs) => {
        turnIds.push(run.activeTurn!.turnId);
        if (!args.reportingRepair) {
          for (const identity of [
            { turnId: 'inactive-turn', providerSessionId: 'provider-1' },
            { turnId: run.activeTurn!.turnId, providerSessionId: 'inactive-provider' },
          ]) {
            const rejected = await reportChangedFilesTool.execute({
              runId: run.runId,
              run,
              args: { ...identity, changedFiles: [] },
            });
            expect(JSON.stringify(rejected)).toContain('context_rejected');
          }
          expect(run.activeTurn!.changedFileReporting.snapshot().state).toBe('not_reported');

          if (['repaired', 'exhausted', 'retry'].includes(outcome)) {
            await submit([null]);
          }
          if (outcome === 'explicit_empty') await submit([]);
          if (outcome === 'in_flight_invalid') void submit([null]);
          if (outcome === 'omitted_uncertain_edit') {
            await writeFile(path.join(repositoryRoot, 'uncertain.ts'), 'unattributed');
          }
          if (outcome === 'mixed') {
            const result = await submit([
              { serviceId: 'service-1', path: 'feature.ts' },
              null,
              { path: 'missing-service.ts' },
            ]);
            expect(JSON.parse(result.content[0]!.text)).toMatchObject({
              state: 'needs_correction',
              findings: [{ status: 'accepted' }, { status: 'rejected' }, { status: 'rejected' }],
            });
            expect(run.getFileChangeProjection()).toEqual([
              { serviceId: 'service-1', repoRelativePath: 'feature.ts' },
            ]);
          }
          if (
            outcome === 'stale_after_edit' ||
            outcome === 'late_edit' ||
            outcome === 'reporting_write_failure'
          ) {
            await submit([]);
          }
          if (
            outcome === 'stale_after_edit' ||
            outcome === 'reporting_write_failure' ||
            outcome === 'omitted_confirmed_edit'
          ) {
            if (outcome === 'reporting_write_failure') {
              vi.spyOn(run, 'persistChangedFileReporting').mockRejectedValueOnce(
                new Error('Reporting evidence unavailable'),
              );
            }
            await writeFile(path.join(repositoryRoot, 'later.ts'), 'changed');
            await run.recordFileChanges({
              runId: run.runId,
              provider: 'claude',
              providerSessionId: 'provider-1',
              providerThreadId: null,
              providerTurnId: null,
              paths: [path.join(repositoryRoot, 'later.ts')],
              occurredAt: '2026-10-08T18:00:00.000Z',
              providerPatch: null,
            });
            expect(run.activeTurn!.changedFileReporting.ready).toBe(false);
            expect(run.getFileChangeProjection()).toContainEqual({
              serviceId: 'service-1',
              repoRelativePath: 'later.ts',
            });
            expect(run.getRunLifetimeTouchedFiles()).toContain(
              path.join(repositoryRoot, 'later.ts'),
            );
          }
          emitCompletion(
            JSON.stringify({
              response: 'Original drafted response',
            }),
          );
          expect(harness.poster.createOutOfBand).not.toHaveBeenCalled();
          if (outcome === 'late_edit') {
            await writeFile(
              path.join(repositoryRoot, 'late.ts'),
              'changed after completion was drafted',
            );
            await run.recordFileChanges({
              runId: run.runId,
              provider: 'claude',
              providerSessionId: 'provider-1',
              providerThreadId: null,
              providerTurnId: null,
              paths: [path.join(repositoryRoot, 'late.ts')],
              occurredAt: '2026-10-08T18:00:00.000Z',
              providerPatch: null,
            });
          }
        } else {
          expect(
            run.activeTurn!.changedFileReporting.snapshot().retainedResponse?.summary,
          ).toContain('Original drafted response');
          if (outcome === 'retry' && turnIds.length === 2)
            throw new Error('Transient provider failure');
          if (outcome !== 'exhausted') {
            await submit(
              outcome === 'mixed' ? [{ serviceId: 'service-1', path: 'feature.ts' }] : [],
            );
            await submit(
              outcome === 'mixed' ? [{ serviceId: 'service-1', path: 'feature.ts' }] : [],
            );
          }
          emitCompletion(
            JSON.stringify({
              response: 'Repair output must be discarded',
            }),
          );
        }
        return { providerSessionId: 'provider-1', providerConversationId: null, errorCount: 0 };
      },
    );
    const facade = createTestSessionRunnerFacade({
      runPrompt: async () => {
        throw new Error('Must resume existing provider');
      },
      resumeSession,
      promptOnce: vi.fn(),
      getContextUsage: async () => {
        throw new Error('Not used');
      },
    });
    const harness = makeHarness(
      repositoryRoot,
      (ctx) => new ResumeRunner(ctx, { sessionRunnerFacade: facade, logger: NOOP_LOGGER }),
      'claude',
      handler,
    );
    run = harness.run;
    await harness.runStore.initialize();
    await harness.runStore.createRun({
      ...makeSession(repositoryRoot),
      contextMetadata: {
        organizationId: 'org-1',
        projectId: 'project-1',
        agentSessionId: 'run-1',
        capturedAt: '2026-10-08T18:00:00.000Z',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
    });
    await run.handleMessage(makeInput());
    await run.awaitIdle();
    expect(new Set(turnIds).size).toBe(1);
    expect(resumeSession).toHaveBeenCalledTimes(
      outcome === 'exhausted' || outcome === 'retry'
        ? 3
        : outcome.startsWith('omitted') || outcome === 'explicit_empty'
          ? 1
          : 2,
    );
    if (outcome === 'mixed') expect(harness.appendFileChangeFacts).toHaveBeenCalledOnce();
    expect(harness.poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(harness.poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        dto: expect.objectContaining({
          data: expect.objectContaining({ response: 'Original drafted response' }),
        }),
      }),
    );
    const evidence = (await harness.runStore.readDurableRunEvents(run.runId)).filter(
      (event) => event.payload.kind === 'changed_file_reporting',
    );
    expect(evidence.at(-1)?.payload).toMatchObject({
      state:
        outcome === 'exhausted'
          ? 'needs_correction'
          : outcome.startsWith('omitted')
            ? 'not_reported'
            : 'validated',
      incomplete: outcome === 'exhausted',
    });
    if (outcome.startsWith('omitted')) {
      expect(evidence.at(-1)?.payload).toMatchObject({ attempts: 0 });
      if (outcome !== 'omitted_confirmed_edit') expect(harness.createReport).not.toHaveBeenCalled();
      expect(harness.loggerDebug).not.toHaveBeenCalledWith(
        'runtime.turn.changed_file_reporting.transition',
        expect.objectContaining({ action: 'recovery_exhausted' }),
      );
      expect(run.getFileChangeProjection()).toEqual(
        outcome === 'omitted_confirmed_edit'
          ? [{ serviceId: 'service-1', repoRelativePath: 'later.ts' }]
          : [],
      );
    }
    const stale = await submit([], turnIds[0]);
    expect(JSON.stringify(stale)).toContain('context_rejected');
    // Durable validation from an ended Turn is evidence, never a new Turn's readiness.
    const restored = makeHarness(repositoryRoot, { run: async () => {} }, 'claude', handler);
    expect(restored.run.activeTurn).toBeNull();
    expect(restored.poster.createOutOfBand).not.toHaveBeenCalled();
  });

  it('keeps healthy claims, diagnoses clean paths, and corrects only corroborated unique dirty paths', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'reporting-claims-'));
    tempDirs.push(repositoryRoot);
    execFileSync('git', ['init'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'feature.ts'), 'before');
    await writeFile(path.join(repositoryRoot, 'clean.ts'), 'clean');
    execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'feature.ts'), 'after');
    const session = makeSession(repositoryRoot);
    const report = [
      { serviceId: 'service-1', path: 'featur.ts' },
      { serviceId: 'service-1', path: 'clean.ts' },
      { serviceId: 'service-1', path: 'feature.ts' },
    ];
    const uncorroborated = await resolveReportedFileChanges(session, report);
    expect(uncorroborated.rejected.map((item) => item.reason)).toEqual([
      'uncorroborated_correction',
      'not_changed_in_git',
    ]);
    expect(uncorroborated.admitted.map((item) => item.repoRelativePath)).toEqual(['feature.ts']);
    const corroborated = await resolveReportedFileChanges(session, report, undefined, [
      { serviceId: 'service-1', repoRelativePath: 'feature.ts', executionRoot: repositoryRoot },
    ]);
    expect(corroborated.corrected).toEqual([{ claim: report[0], path: 'feature.ts' }]);
    await writeFile(path.join(repositoryRoot, 'featurx.ts'), 'another actor');
    const ambiguous = await resolveReportedFileChanges(session, [report[0]!], undefined, [
      { serviceId: 'service-1', repoRelativePath: 'feature.ts', executionRoot: repositoryRoot },
    ]);
    expect(ambiguous.rejected[0]?.reason).toBe('ambiguous_correction');
    await rm(path.join(repositoryRoot, 'feature.ts'));
    const deletion = await resolveReportedFileChanges(session, [
      { serviceId: 'service-1', path: 'feature.ts' },
    ]);
    expect(deletion.admitted.map((item) => item.repoRelativePath)).toEqual(['feature.ts']);
    const gitFailure = await resolveReportedFileChanges(session, report, async () => {
      throw new Error('Git unavailable');
    });
    expect(gitFailure.admitted).toEqual([]);
    expect(gitFailure.rejected.every((item) => item.reason === 'git_read_failed')).toBe(true);
  });

  it('validates claims in the selected sibling worktree without using dirty files from another checkout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reporting-worktrees-'));
    tempDirs.push(root);
    const repositoryRoot = path.join(root, 'repository');
    execFileSync('git', ['init', repositoryRoot]);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'feature.ts'), 'base');
    execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: repositoryRoot });
    const first = path.join(root, 'first'),
      second = path.join(root, 'second');
    execFileSync('git', ['worktree', 'add', '-b', 'first', first], { cwd: repositoryRoot });
    execFileSync('git', ['worktree', 'add', '-b', 'second', second], { cwd: repositoryRoot });
    await writeFile(path.join(first, 'feature.ts'), 'first-worktree-only');
    const session = makeSession(repositoryRoot);
    session.worktreeState = {
      'service-1': { repoPath: repositoryRoot, worktreePath: second, branch: 'second' },
    };
    const rejected = await resolveReportedFileChanges(session, [
      { serviceId: 'service-1', path: 'feature.ts' },
    ]);
    expect(rejected.rejected[0]?.reason).toBe('not_changed_in_git');
    await writeFile(path.join(second, 'feature.ts'), 'second-worktree');
    const admitted = await resolveReportedFileChanges(session, [
      { serviceId: 'service-1', path: 'feature.ts' },
    ]);
    expect(admitted.admitted[0]?.repositoryRoot).toBe(second);
    const wrongWorkspaceEvidence = await resolveReportedFileChanges(
      session,
      [{ serviceId: 'service-1', path: 'featur.ts' }],
      undefined,
      [{ serviceId: 'service-1', repoRelativePath: 'feature.ts', executionRoot: first }],
    );
    expect(wrongWorkspaceEvidence.rejected[0]?.reason).toBe('uncorroborated_correction');
  });
});

describe('Run file-change attribution without repository reconciliation', () => {
  it('observes normalized Codex shell commands without admitting snapshot paths to canonical membership', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'heyhey-run-codex-observer-'));
    tempDirs.push(repositoryRoot);
    execFileSync('git', ['init'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'base.ts'), 'base\n');
    execFileSync('git', ['add', 'base.ts'], { cwd: repositoryRoot });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: repositoryRoot });

    let run: Run | undefined;
    const emit = (eventType: string, payload: Record<string, unknown>) => {
      if (!run) throw new Error('Run must be constructed before the test runner emits events.');
      run.onAgentOutput({
        event: {
          source: 'provider',
          eventType,
          timestamp: '2026-08-29T00:00:00.000Z',
          sessionId: 'provider-1',
          agentId: 'codex',
          payload: { messageType: 'provider_event', ...payload },
        },
      });
    };
    const harness = makeHarness(
      repositoryRoot,
      {
        run: async () => {
          emit('thread/started', { routing: { thread_id: 'thread-1' } });
          emit('turn/started', {
            routing: { thread_id: 'thread-1', turn_id: 'provider-turn-1' },
          });
          emit('tool_use', {
            eventType: 'item/started',
            routing: {
              thread_id: 'thread-1',
              turn_id: 'provider-turn-1',
              item_id: 'command-1',
            },
            raw_event: {
              item: { type: 'commandExecution', id: 'command-1', status: 'inProgress' },
            },
          });
          await vi.waitFor(() =>
            expect(harness.loggerDebug).toHaveBeenCalledWith(
              'local.run.codex_shell_observer.start_captured',
              expect.objectContaining({ commandItemId: 'command-1' }),
            ),
          );
          await writeFile(path.join(repositoryRoot, 'shell-created.ts'), 'created by shell\n');
          emit('tool_use', {
            eventType: 'item/completed',
            routing: {
              thread_id: 'thread-1',
              turn_id: 'provider-turn-1',
              item_id: 'command-1',
            },
            raw_event: {
              item: {
                type: 'commandExecution',
                id: 'command-1',
                status: 'completed',
                exitCode: 0,
              },
            },
          });
        },
      },
      'codex',
    );
    run = harness.run;

    await harness.run.handleMessage(makeInput());
    await harness.run.awaitIdle();

    expect(harness.loggerInfo).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({
        result: 'gap',
        missingCanonical: [{ serviceId: 'service-1', repoRelativePath: 'shell-created.ts' }],
      }),
    );
    expect(harness.loggerInfo).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.turn_cleared',
      expect.objectContaining({ unfinishedCount: 0 }),
    );
    expect(harness.appendFileChangeFacts).not.toHaveBeenCalled();
    expect(harness.run.getFileChangeProjection()).toEqual([]);
  });

  it('does not attribute a concurrent ambient edit to an inspection-only Task Only request', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'heyhey-run-attribution-'));
    tempDirs.push(repositoryRoot);
    const ambientPath = path.join(repositoryRoot, 'changed-by-another-session.ts');
    const harness = makeHarness(repositoryRoot, {
      run: async () => {
        await writeFile(ambientPath, 'concurrent edit\n');
      },
    });

    await harness.run.handleMessage(makeInput());
    await harness.run.awaitIdle();

    expect(harness.appendFileChangeFacts).not.toHaveBeenCalled();
    expect(harness.run.getFileChangeProjection()).toEqual([]);
    expect(harness.createReport).not.toHaveBeenCalled();
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'local.run.open_implement_report.skipped',
      expect.objectContaining({ reason: 'no-files-changed' }),
    );
  });

  it.each(['missing', 'non-git'] as const)(
    'keeps canonical membership empty when the legacy snapshot setup would be %s',
    async (repositoryState) => {
      const parent = await mkdtemp(path.join(os.tmpdir(), 'heyhey-run-attribution-'));
      tempDirs.push(parent);
      const repositoryRoot = repositoryState === 'missing' ? path.join(parent, 'absent') : parent;
      const harness = makeHarness(repositoryRoot, { run: async () => {} });

      await harness.run.handleMessage(makeInput());
      await harness.run.awaitIdle();

      expect(harness.appendFileChangeFacts).not.toHaveBeenCalled();
      expect(harness.run.getFileChangeProjection()).toEqual([]);
      expect(harness.createReport).not.toHaveBeenCalled();
      expect(harness.logger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('reconcile'),
        expect.anything(),
      );
    },
  );
});

describe('Run agent-reported file changes', () => {
  it('admits only reported paths git shows as changed in the reported service', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'heyhey-run-reported-'));
    tempDirs.push(repositoryRoot);
    execFileSync('git', ['init'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'clean.ts'), 'clean\n');
    await writeFile(path.join(repositoryRoot, 'edited.ts'), 'before\n');
    execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: repositoryRoot });

    let run: Run | undefined;
    const harness = makeHarness(repositoryRoot, {
      run: async () => {
        if (!run?.activeTurn) throw new Error('Run must have an active Turn.');
        await writeFile(path.join(repositoryRoot, 'edited.ts'), 'after\n');
        await writeFile(path.join(repositoryRoot, 'created.ts'), 'new\n');
        await run.recordReportedFileChanges({
          turn: run.activeTurn,
          providerSessionId: 'provider-1',
          occurredAt: '2026-10-03T00:00:00.000Z',
          files: [
            { serviceId: 'service-1', path: 'edited.ts' },
            { serviceId: 'service-1', path: 'created.ts' },
            { serviceId: 'service-1', path: 'edited.ts' },
            { serviceId: 'service-1', path: 'clean.ts' },
            { serviceId: 'service-1', path: '../outside.ts' },
            { serviceId: 'service-1', path: path.join(repositoryRoot, 'edited.ts') },
            { serviceId: 'service-unknown', path: 'edited.ts' },
          ],
        });
      },
    });
    run = harness.run;

    await harness.run.handleMessage(makeInput());
    await harness.run.awaitIdle();

    expect(harness.appendFileChangeFacts).toHaveBeenCalledOnce();
    const facts = harness.appendFileChangeFacts.mock.calls[0]![1];
    expect(facts.map((fact) => [fact.repoRelativePath, fact.evidence.kind])).toEqual([
      ['edited.ts', 'patch'],
      ['created.ts', 'patch'],
    ]);
    expect(harness.run.getFileChangeProjection()).toEqual([
      { serviceId: 'service-1', repoRelativePath: 'edited.ts' },
      { serviceId: 'service-1', repoRelativePath: 'created.ts' },
    ]);
    expect(harness.loggerInfo).toHaveBeenCalledWith(
      'local.run.file_change.agent_report.resolved',
      expect.objectContaining({
        rejected: [
          { serviceId: 'service-1', path: 'clean.ts', reason: 'not_changed_in_git' },
          { serviceId: 'service-1', path: '../outside.ts', reason: 'invalid_path' },
          {
            serviceId: 'service-1',
            path: path.join(repositoryRoot, 'edited.ts'),
            reason: 'invalid_path',
          },
          { serviceId: 'service-unknown', path: 'edited.ts', reason: 'unknown_service' },
        ],
      }),
    );
  });

  it('records nothing when git cannot be read for the reported service', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'heyhey-run-reported-nogit-'));
    tempDirs.push(repositoryRoot);
    let run: Run | undefined;
    const harness = makeHarness(repositoryRoot, {
      run: async () => {
        if (!run?.activeTurn) throw new Error('Run must have an active Turn.');
        await writeFile(path.join(repositoryRoot, 'edited.ts'), 'after\n');
        await run.recordReportedFileChanges({
          turn: run.activeTurn,
          providerSessionId: 'provider-1',
          occurredAt: '2026-10-03T00:00:00.000Z',
          files: [{ serviceId: 'service-1', path: 'edited.ts' }],
        });
      },
    });
    run = harness.run;

    await harness.run.handleMessage(makeInput());
    await harness.run.awaitIdle();

    expect(harness.appendFileChangeFacts).not.toHaveBeenCalled();
    expect(harness.loggerInfo).toHaveBeenCalledWith(
      'local.run.file_change.agent_report.resolved',
      expect.objectContaining({
        rejected: [{ serviceId: 'service-1', path: 'edited.ts', reason: 'git_read_failed' }],
      }),
    );
  });
});
