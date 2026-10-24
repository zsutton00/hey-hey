import { reportChangedFilesTool } from '../agents/submission-tools/report-changed-files-tool';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandlerDeps,
} from '../agents/prompt-type-handler';
import {
  createOnCompleteTestDeps,
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../agents/prompt-type-handler.test-support';
import { ProjectModeBundleMaterializer } from '../agents/project-mode';
import type { AgentRunResult, RunPromptArgs } from '../agents/providers/session-runner';
import type { RunWorkspaceWriteBoundary } from '../agents/workspace-write-boundary';
import { RunStore } from '../run-store/run-store';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { LocalPromptType, SessionRole } from '../shared/agent-bridge-contract/generated/api';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { Run, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';
import {
  createRunTestOAuthClient,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestSessionRunnerFacade,
} from './run.test-support';

/**
 * A mode-backed Run alternates Project Assistant research turns, project_mode
 * turns and ordinary turns. Every turn must pass the Run's write-boundary
 * check, and the provider must receive the same boundary with the captured
 * mode files as a read-only directory.
 *
 * Real: RunStore on disk, git repository, prompt-type registry and handlers,
 * Project Assistant bootstrap, mode bundle materializer under os.tmpdir()
 * (a symlinked path on macOS), RunnerPicker and RunWorkspaceWriteBoundary.
 * Faked boundaries only: the provider (a scripted model), the platform
 * (message poster, platform HTTP) and the entity-context fetch.
 */

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: vi.fn().mockResolvedValue(undefined),
}));

const RUN_ID = 'run-mode-boundary';
const TASK_ID = '6b0f7a51-2c4e-4d3b-9a8e-1f2d3c4b5a61';
const MODE_ID = '11111111-1111-4111-8111-111111111111';
const MODE_ENTRY = 'Follow the captured mode instructions.';
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const startupPromptInput: AgentStartupPromptInputResult = {
  startupInput: {
    task: {
      id: TASK_ID,
      title: 'Mode-backed task',
      taskType: 'STANDARD',
      description: 'Follow the captured mode.',
    },
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: 'CURRENT ENTITY CONTEXT',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    entity: {
      id: TASK_ID,
      title: 'Mode-backed task',
      type: 'STANDARD',
      summary: 'Follow the captured mode.',
      sections: [],
    } as never,
    context: {
      entityId: TASK_ID,
      entityType: 'TASK',
      displayName: 'Mode-backed task',
      taskType: 'STANDARD',
      content: {
        sections: { description: 'Follow the captured mode.' },
        status: 'ACTIVE',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
      },
      featureHierarchy: [],
      relatedEntities: [],
      planContext: null,
    } as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'template-revision-1',
    revisionNumber: 1,
  },
  template: {
    templateKey: 'task',
    selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
    syntaxVersion: 'V1',
    content: 'CURRENT ENTITY CONTEXT',
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'template-revision-1',
      revisionNumber: 1,
    },
  },
};

const modeConfig = {
  type: 'CODING_SESSION',
  version: 'v2',
  model: 'claude-opus',
  projectModeSelection: { schemaVersion: 'project-mode-selection.v1', modeId: MODE_ID },
  projectModeSnapshot: {
    schemaVersion: 'project-mode-snapshot.v1',
    modeId: MODE_ID,
    catalogDescription: 'Captured mode',
    applicableWorkItemTypeKeys: ['STANDARD'],
    files: { schemaVersion: 'project-mode-files.v1', files: { 'MODE.md': MODE_ENTRY } },
    snapshotHash: 'a'.repeat(64),
  },
};

const completionJson = (response: string): string => JSON.stringify({ response, changedFiles: [] });

interface ProviderTurn {
  prompt: string;
  effectiveRole: SessionRole;
  handlerId: string;
  boundary: RunWorkspaceWriteBoundary | undefined;
}

const makeHarness = async (options: {
  skipProjectAssistant: boolean;
  sessionRole?: SessionRole;
  restoreBeforeFirst?: boolean;
}) => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-mode-boundary-'));
  tempDirs.push(baseDir);
  vi.spyOn(os, 'homedir').mockReturnValue(baseDir);
  const runsDir = path.join(baseDir, 'runs');
  const runStore = new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  await runStore.initialize();
  const repoDir = path.join(baseDir, 'repo');
  await mkdir(repoDir);
  execFileSync('git', ['init', '--quiet'], { cwd: repoDir });
  await runStore.createRun({
    entity: { entityType: 'TASK', entityId: TASK_ID },
    agentic_session_id: RUN_ID,
    services: [{ id: 'service-1', path: repoDir }],
    launchServiceId: 'service-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    conversationId: 'conversation-1',
    config: {
      ...modeConfig,
      projectModeSnapshot: {
        ...modeConfig.projectModeSnapshot,
        schemaVersion: 'project-mode-snapshot.v3',
        projectAssistant: { enabled: true },
        sessionRole: options.sessionRole ?? SessionRole.Implementation,
      },
    },
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: RUN_ID,
    },
  } as never);
  const session = await runStore.getRun(RUN_ID);
  if (!session) throw new Error('Expected the persisted Run.');

  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];

  const promptTypes = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const ownership = createTestRunOwnership((promptType) => promptTypes.get(promptType));
  const poster = createTestMessagePoster();
  const live: { run: Run | null } = { run: null };

  const turns: ProviderTurn[] = [];
  const runTurn = async (args: RunPromptArgs): Promise<AgentRunResult> => {
    if (!live.run?.activeTurn) throw new Error('Expected an executing handler.');
    turns.push({
      prompt: args.prompt,
      boundary: args.workspaceWriteBoundary,
      effectiveRole: live.run.activeTurn.effectiveRole,
      handlerId: live.run.activeTurn.handler.id,
    });
    if (!live.run) throw new Error('The Run is not constructed.');
    live.run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: new Date().toISOString(),
        sessionId: 'provider-session-1',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });
    if (live.run.activeTurn?.handler.requiresChangedFileReporting) {
      await reportChangedFilesTool.execute({
        runId: live.run.runId,
        run: live.run,
        args: {
          turnId: live.run.activeTurn.turnId,
          providerSessionId: live.run.providerSessionId,
          changedFiles: [],
        },
      });
    }
    live.run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'agent_output',
        timestamp: new Date().toISOString(),
        sessionId: 'provider-session-1',
        agentId: 'claude',
        payload: {
          messageType: 'assistant',
          taskComplete: true,
          summary: completionJson(`Turn ${String(turns.length)} done.`),
        },
      },
    });
    return { providerSessionId: 'provider-session-1', providerConversationId: null, errorCount: 0 };
  };
  const sessionRunnerFacade = createTestSessionRunnerFacade({
    runPrompt: vi.fn(runTurn),
    resumeSession: vi.fn(runTurn),
    discardSession: vi.fn().mockResolvedValue(undefined),
    promptOnce: vi.fn(),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0 }),
  });

  const platformFetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch;
  const handlerDeps = createPromptTypeHandlerTestDeps({
    startupPromptInput: {
      resolve: vi.fn().mockResolvedValue(startupPromptInput),
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'],
    auth: createPromptTypeHandlerTestAuth('mode-boundary-token'),
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: platformFetch,
    logger,
  });
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    oauthClient: createRunTestOAuthClient(),
    logger,
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: new LocalAgentEndpoint(),
  });

  const createRun = (currentSession = session) =>
    new Run(
      {
        runId: RUN_ID,
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        provider: 'claude',
        session: currentSession,
        skipProjectAssistant:
          options.skipProjectAssistant || currentSession.projectAssistantDone === true,
      },
      {
        runStore,
        repoStore: createTestRepoMappingStore(),
        poster,
        broadcaster: createTestRunEventPublisher(),
        ...ownership,
        handlerDeps,
        onCompleteDeps: createOnCompleteTestDeps({
          fetchImpl: platformFetch,
          logger,
          poster,
          runStore,
        }),
        runnerPicker,
        // Default runtime root: under os.tmpdir(), which is a symlink on macOS.
        projectModeBundleMaterializer: new ProjectModeBundleMaterializer(),
        logger,
      },
    );
  let run = createRun();
  live.run = run;
  const restore = async () => {
    run.cleanup();
    const persisted = await runStore.getRun(RUN_ID);
    if (!persisted) throw new Error('Expected persisted session');
    run = createRun(persisted);
    live.run = run;
  };
  if (options.restoreBeforeFirst) await restore();

  const send = async (input: InternalRunPromptRequest): Promise<void> => {
    await run.handleMessage(input);
    await run.awaitIdle();
  };
  const projectModeMessage = (userMessage: string): InternalRunPromptRequest =>
    ({
      promptType: LocalPromptType.ProjectMode,
      payload: { promptType: LocalPromptType.ProjectMode, userMessage },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    }) as InternalRunPromptRequest;
  const freeformMessage = (userMessage: string): InternalRunPromptRequest =>
    ({
      promptType: LocalPromptType.CodingFreeform,
      payload: { promptType: LocalPromptType.CodingFreeform, userMessage },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    }) as InternalRunPromptRequest;

  const errorEvents = () =>
    (logger.error as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);

  return {
    get run() {
      return run;
    },
    restore,
    turns,
    send,
    projectModeMessage,
    freeformMessage,
    errorEvents,
    poster,
    repoDir,
  };
};

/** Every provider turn ran inside one boundary that reads, but cannot write, the mode files. */
const expectOneModeBoundary = async (
  turns: readonly ProviderTurn[],
  repoDir: string,
): Promise<void> => {
  const [first, ...rest] = turns;
  const boundary = first?.boundary;
  expect(boundary).toBeDefined();
  for (const turn of rest) expect(turn.boundary).toBe(boundary);
  expect(boundary!.allowedRepositoryRoots).toEqual([await realpath(repoDir)]);
  expect(boundary!.readOnlyDirectories).toHaveLength(1);
  const bundleDirectory = boundary!.readOnlyDirectories[0]!;
  await expect(readFile(path.join(bundleDirectory, 'MODE.md'), 'utf8')).resolves.toBe(MODE_ENTRY);
  await expect(
    boundary!.resolveWriteTarget(path.join(bundleDirectory, 'MODE.md')),
  ).rejects.toThrow();
};

describe('write boundary across turn types in a mode-backed Run', () => {
  it.each(
    Object.values(SessionRole).flatMap((sessionRole) =>
      [false, true].map((restoreBeforeFirst) => ({ sessionRole, restoreBeforeFirst })),
    ),
  )(
    'keeps research separate from $sessionRole after restore=$restoreBeforeFirst',
    async (options) => {
      const h = await makeHarness({ ...options, skipProjectAssistant: false });
      try {
        await h.send(h.projectModeMessage('Start the captured work.'));
        await h.restore();
        await h.send(h.projectModeMessage('Follow up after resuming.'));
        expect(h.turns.map((t) => t.effectiveRole)).toEqual([
          'research',
          options.sessionRole,
          options.sessionRole,
        ]);
        expect(h.turns.map((t) => t.handlerId)).toEqual([
          'project_assistant',
          'project_mode',
          'project_mode',
        ]);
        await h.send(h.freeformMessage('Use a separate handler.'));
        expect(h.turns.at(-1)?.effectiveRole).toBe('implementation');
        expect(h.errorEvents()).not.toContain('local.run.drain.failed');
        await expectOneModeBoundary(h.turns.slice(0, 2), h.repoDir);
        await expectOneModeBoundary(h.turns.slice(2), h.repoDir);
      } finally {
        h.run.cleanup();
      }
    },
  );
  it('runs the Project Assistant research turn, then project_mode turns, in one boundary', async () => {
    const h = await makeHarness({ skipProjectAssistant: false });
    try {
      await h.send(h.projectModeMessage('Start the mode work.'));
      await h.send(h.projectModeMessage('Keep going.'));

      expect(h.turns).toHaveLength(3);
      expect(h.turns[1]!.prompt).toContain(MODE_ENTRY);
      expect(h.errorEvents()).not.toContain('local.run.workspace_write_boundary.identity_changed');
      expect(h.errorEvents()).not.toContain('local.run.drain.failed');
      await expectOneModeBoundary(h.turns, h.repoDir);
    } finally {
      h.run.cleanup();
    }
  });

  it('runs a project_mode turn followed by an ordinary turn in one boundary', async () => {
    const h = await makeHarness({ skipProjectAssistant: true });
    try {
      await h.send(h.projectModeMessage('Start the mode work.'));
      await h.send(h.freeformMessage('Now a follow-up question.'));
      await h.send(h.projectModeMessage('Back to the mode.'));

      expect(h.turns).toHaveLength(3);
      expect(h.errorEvents()).not.toContain('local.run.workspace_write_boundary.identity_changed');
      await expectOneModeBoundary(h.turns, h.repoDir);
    } finally {
      h.run.cleanup();
    }
  });
});
