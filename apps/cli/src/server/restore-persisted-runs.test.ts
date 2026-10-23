/** @vitest-environment node */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunArgsFromSession } from '../run/run-activation';
import { RunStore } from '../run-store/run-store';
import { RunFamilyCompatibilityError } from '../run-store/run-family';
import type { RunStorePaths } from '../run-store/types';
import type { AgenticSession, CreateAgenticSessionInput } from '../session/types';
import { createTestRunRegistryWiring } from './__tests__/helpers/test-run-registry';
import { NOOP_LOGGER } from './logger';
import { RunChangedFilesReader } from './run-changed-files';
import { RunReadPreparationError, RunReadRestoreCoordinator } from './restore-persisted-runs';
import { CreateReportTool } from '../agents/submission-tools/create-report-tool';
import { makeCreateReportProxy } from '../agents/submission-tools/create-report-proxy.test-support';
import {
  createTestRepoMappingStore,
  createTestRun,
  createTestRunRegistry,
  createTestRunStore,
} from '../run/run.test-support';
import {
  ProjectModeBundleMaterializer,
  ProjectModeBundleRestorer,
  validateProjectModeConfig,
} from '../agents/project-mode';
import { RunWorkspaceWriteBoundary } from '../agents/workspace-write-boundary';
import type { ResolvedRunWorkspace } from '../agents/run-scope';

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

const createRunStorePaths = (baseDir: string): RunStorePaths => ({
  baseDir,
  runsDir: path.join(baseDir, 'runs'),
  indexPath: path.join(baseDir, 'runs', 'run-index.json'),
  preferencesPath: path.join(baseDir, 'preferences.json'),
});

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

const makeSession = (): AgenticSession => ({
  entity: null,
  agentic_session_id: 'run-1',
  services: [{ id: 'service-1', path: '/repo' }],
  launchServiceId: 'service-1',
  provider: 'codex',
  provider_session_id: 'provider-1',
  provider_conversation_id: 'thread-1',
  status: 'idle',
  conversationId: 'conversation-1',
  contextMetadata: {
    capturedAt: '2026-07-18T00:00:00.000Z',
    organizationId: 'organization-1',
    projectId: 'project-1',
    agentSessionId: 'run-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  events: [],
});

describe('RunReadRestoreCoordinator', () => {
  it('restores triage PROJECT identity from disk after a RunStore restart', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-triage-restore-'));
    tempDirectories.push(tempRoot);
    const paths = createRunStorePaths(tempRoot);
    const original = new RunStore({ paths });
    await original.initialize();
    const entity = {
      entityType: 'PROJECT' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
    };
    await original.createRun({
      entity,
      agentic_session_id: 'run-1',
      services: [],
      provider: 'codex',
      provider_session_id: 'pending_triage',
      provider_conversation_id: null,
      conversationId: 'conversation-1',
      contextMetadata: makeSession().contextMetadata,
    });
    const restarted = new RunStore({ paths });
    await restarted.initialize();
    const wiring = createTestRunRegistryWiring({ runStore: restarted });
    const coordinator = new RunReadRestoreCoordinator({
      runStore: restarted,
      runRegistry: wiring.runRegistry,
      logger: NOOP_LOGGER,
    });
    const restored = await coordinator.restoreIdentity('run-1');
    expect(restored.entity).toEqual(entity);
    expect(restored.session.contextMetadata?.projectId).toBe(
      makeSession().contextMetadata?.projectId,
    );
    restored.cleanup();
  });

  it('rehydrates captured project-mode files before activating the persisted Run', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-mode-run-restore-'));
    tempDirectories.push(tempRoot);
    const repoPath = path.join(tempRoot, 'repo');
    const runtimeRoot = path.join(tempRoot, 'mode-bundles');
    await fs.mkdir(repoPath);
    const config = {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'gpt-5',
      projectModeSelection: {
        schemaVersion: 'project-mode-selection.v1',
        modeId: '11111111-1111-4111-8111-111111111111',
      },
      projectModeSnapshot: {
        schemaVersion: 'project-mode-snapshot.v2',
        modeId: '11111111-1111-4111-8111-111111111111',
        catalogDescription: 'Captured mode',
        applicableWorkItemTypeKeys: ['STANDARD'],
        files: {
          schemaVersion: 'project-mode-files.v1',
          files: {
            'MODE.md': 'Original MODE instructions.',
            'references/checklist.md': 'Original captured checklist.',
          },
        },
        projectAssistant: { enabled: false },
        snapshotHash: 'b'.repeat(64),
      },
    };
    const validated = validateProjectModeConfig(config);
    if (!validated.ok) throw new Error(validated.issues.join('; '));
    const materializer = new ProjectModeBundleMaterializer({ runtimeRoot });
    const originalBundleDirectory = await materializer.materialize(
      'run-project-mode',
      validated.value.snapshot,
    );
    await fs.rm(originalBundleDirectory, { recursive: true });

    const runStore = new RunStore({
      paths: createRunStorePaths(path.join(tempRoot, 'store')),
    });
    await runStore.initialize();
    await runStore.createRun({
      entity: null,
      agentic_session_id: 'run-project-mode',
      services: [{ id: 'service-1', path: repoPath }],
      launchServiceId: 'service-1',
      provider: 'codex',
      provider_session_id: 'provider-session-original',
      provider_conversation_id: 'provider-thread-original',
      provider_session_agent_id: 'project-mode',
      conversationId: 'conversation-project-mode',
      contextMetadata: {
        ...makeSession().contextMetadata,
        agentSessionId: 'run-project-mode',
      },
      config: config as never,
    });
    const wiring = createTestRunRegistryWiring({ runStore });
    const create = vi.spyOn(wiring.runRegistry, 'create');
    const coordinator = new RunReadRestoreCoordinator({
      runStore,
      runRegistry: wiring.runRegistry,
      logger: NOOP_LOGGER,
      projectModeBundleRestorer: new ProjectModeBundleRestorer(materializer, NOOP_LOGGER),
    });

    const restoredRun = await coordinator.restore('run-project-mode');
    const restoredBundleDirectory = await materializer.materialize(
      'run-project-mode',
      validated.value.snapshot,
    );
    expect(restoredBundleDirectory).toBe(originalBundleDirectory);
    await expect(fs.readFile(path.join(restoredBundleDirectory, 'MODE.md'), 'utf8')).resolves.toBe(
      'Original MODE instructions.',
    );
    await expect(
      fs.readFile(path.join(restoredBundleDirectory, 'references/checklist.md'), 'utf8'),
    ).resolves.toBe('Original captured checklist.');
    expect(restoredRun.session).toMatchObject({
      provider_session_id: 'provider-session-original',
      provider_conversation_id: 'provider-thread-original',
      provider_session_agent_id: 'project-mode',
    });
    const restoredCapture = validateProjectModeConfig(restoredRun.session.config);
    expect(restoredCapture).toMatchObject({
      ok: true,
      value: { snapshot: { projectAssistantEnabled: false } },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ hasProviderSession: true, provider: 'codex' }),
    );

    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: repoPath,
      cwd: repoPath,
      allowedRepositoryRoots: [repoPath],
      bindingRepositoryPath: repoPath,
      workspaceRoot: null,
    };
    const boundary = await RunWorkspaceWriteBoundary.create(workspace, {
      runScopeId: 'run-project-mode',
      providerStateRoot: path.join(tempRoot, 'provider-state'),
      readOnlyDirectories: [restoredBundleDirectory],
    });
    expect(boundary.allowedRepositoryRoots).not.toContain(restoredBundleDirectory);
    await boundary.dispose();
    await materializer.dispose();
  });

  it('fails only the selected Run restoration with structured compatibility context', async () => {
    const runStore = createTestRunStore();
    const incompatibility = new RunFamilyCompatibilityError('run-1', {
      familyId: 'run:run-1',
      sourcePaths: ['/runs/run-1.family.json'],
      reason: 'unsupported_newer_schema',
      readerApplicationVersion: '3.2.1',
      writerApplicationVersion: '4.0.0',
      sourceSchemaVersion: 2,
      currentSchemaVersion: 1,
      errorMessage: null,
    });
    vi.spyOn(runStore, 'getRun').mockRejectedValue(incompatibility);
    const coordinator = new RunReadRestoreCoordinator({
      runStore,
      runRegistry: createTestRunRegistry(() => null),
      logger: NOOP_LOGGER,
    });

    await expect(coordinator.restore('run-1')).rejects.toMatchObject({
      code: 'READ_FAILED',
      cause: incompatibility,
    } satisfies Partial<RunReadPreparationError>);
  });

  it('restores a service-free Run by identity without preparing repository files', async () => {
    const persistedSession = { ...makeSession(), services: [] };
    delete persistedSession.launchServiceId;
    const runStore = createTestRunStore();
    const getRun = vi.spyOn(runStore, 'getRun').mockResolvedValue(persistedSession);
    const getFileChangeFacts = vi.spyOn(runStore, 'getFileChangeFacts');
    const getTouchedFiles = vi.spyOn(runStore, 'getTouchedFiles');
    const runRegistry = createTestRunRegistry(() => null);
    const restoredRun = createTestRun({ runId: 'run-1', session: persistedSession });
    const create = vi.spyOn(runRegistry, 'create').mockReturnValue(restoredRun);
    const coordinator = new RunReadRestoreCoordinator({
      runStore,
      runRegistry,
      logger: NOOP_LOGGER,
    });

    await expect(coordinator.restoreIdentity('run-1')).resolves.toBe(restoredRun);

    expect(getRun).toHaveBeenCalledWith('run-1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        session: persistedSession,
      }),
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('fileChangeSeed');
    expect(getFileChangeFacts).not.toHaveBeenCalled();
    expect(getTouchedFiles).not.toHaveBeenCalled();
  });

  it('seeds durable file membership on an identity-restored Run before any changed-file read', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-run-identity-'));
    tempDirectories.push(tempRoot);
    const runStore = new RunStore({ paths: createRunStorePaths(path.join(tempRoot, 'store')) });
    await runStore.initialize();
    await runStore.createRun({
      entity: null,
      agentic_session_id: 'run-identity',
      services: [{ id: 'service-1', path: path.join(tempRoot, 'repo') }],
      launchServiceId: 'service-1',
      provider: 'codex',
      provider_session_id: 'provider-1',
      provider_conversation_id: 'thread-1',
      conversationId: 'conversation-1',
      contextMetadata: { ...makeSession().contextMetadata, agentSessionId: 'run-identity' },
    });
    await runStore.appendFileChangeFacts('run-identity', [
      {
        factId: 'fact-owned',
        runId: 'run-identity',
        turnId: 'turn-1',
        provider: 'codex',
        providerSessionId: 'provider-1',
        providerThreadId: 'thread-1',
        providerTurnId: 'provider-turn-1',
        serviceId: 'service-1',
        repoRelativePath: 'owned.ts',
        occurredAt: '2026-07-18T00:00:00.000Z',
        evidence: { kind: 'baseline', diff: 'd', baselineContent: null, postContent: 'x\n' },
      },
    ]);
    const wiring = createTestRunRegistryWiring({ runStore });
    const coordinator = new RunReadRestoreCoordinator({
      runStore,
      runRegistry: wiring.runRegistry,
      logger: NOOP_LOGGER,
    });

    const run = await coordinator.restoreIdentity('run-identity');
    await run.ensureFileChangeFactsSeeded();

    expect(run.getFileChangeProjection()).toEqual([
      expect.objectContaining({ serviceId: 'service-1', repoRelativePath: 'owned.ts' }),
    ]);
  });

  it('coalesces concurrent reads and awaits file membership seeding', async () => {
    let releaseSeed: (() => void) | undefined;
    const ensureFileChangeFactsSeeded = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSeed = resolve;
        }),
    );
    const restoredRun = createTestRun({
      runId: 'run-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      provider: 'codex',
      session: makeSession(),
    });
    vi.spyOn(restoredRun, 'ensureFileChangeFactsSeeded').mockImplementation(
      ensureFileChangeFactsSeeded,
    );
    const runRegistry = createTestRunRegistry(() => null);
    const create = vi.spyOn(runRegistry, 'create').mockReturnValue(restoredRun);
    vi.spyOn(runRegistry, 'remove').mockImplementation(() => false);
    const runStore = createTestRunStore();
    const getRun = vi.fn().mockResolvedValue(makeSession());
    vi.spyOn(runStore, 'getRun').mockImplementation(getRun);
    vi.spyOn(runStore, 'getFileChangeFacts').mockResolvedValue([]);
    vi.spyOn(runStore, 'getTouchedFiles').mockResolvedValue([]);
    const coordinator = new RunReadRestoreCoordinator({
      runStore,
      runRegistry,
      logger: NOOP_LOGGER,
    });
    const first = coordinator.restore('run-1');
    const second = coordinator.restore('run-1');

    await vi.waitFor(() => expect(ensureFileChangeFactsSeeded).toHaveBeenCalledTimes(1));
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseSeed?.();
    await expect(Promise.all([first, second])).resolves.toEqual([restoredRun, restoredRun]);
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        conversationId: 'conversation-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      }),
    );
  });

  it('restores service-qualified membership before telemetry and keeps follow-up activation stable', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-run-restore-'));
    tempDirectories.push(tempRoot);
    const repoPath = path.join(tempRoot, 'repo');
    const secondRepoPath = path.join(tempRoot, 'second-repo');
    await fs.mkdir(repoPath);
    await fs.mkdir(secondRepoPath);
    await execFileAsync('git', ['init'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, 'owned.ts'), 'before owned\n');
    await fs.writeFile(path.join(repoPath, 'clean.ts'), 'clean\n');
    await execFileAsync('git', ['add', '.'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });
    await execFileAsync('git', ['init'], { cwd: secondRepoPath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: secondRepoPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: secondRepoPath });
    await fs.writeFile(path.join(secondRepoPath, 'owned.ts'), 'second service before\n');
    await execFileAsync('git', ['add', '.'], { cwd: secondRepoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: secondRepoPath });

    const runStore = new RunStore({
      paths: createRunStorePaths(path.join(tempRoot, 'store')),
    });
    await runStore.initialize();
    const runInput: CreateAgenticSessionInput = {
      entity: null,
      agentic_session_id: 'run-restarted',
      services: [
        { id: 'service-1', path: repoPath },
        { id: 'service-2', path: secondRepoPath },
      ],
      launchServiceId: 'service-1',
      provider: 'codex',
      provider_session_id: 'provider-1',
      provider_conversation_id: 'thread-1',
      conversationId: 'conversation-1',
      contextMetadata: {
        ...makeSession().contextMetadata,
        agentSessionId: 'run-restarted',
      },
    };
    const persistedSession = await runStore.createRun(runInput);
    await runStore.updateRunPermissionRequestPresentations('run-restarted', [
      { requestId: 'permission-after-restart', messageId: 'permission-message-1' },
    ]);
    await runStore.appendFileChangeFacts('run-restarted', [
      {
        factId: 'fact-owned',
        runId: 'run-restarted',
        turnId: 'turn-1',
        provider: 'codex',
        providerSessionId: 'provider-1',
        providerThreadId: 'thread-1',
        providerTurnId: 'provider-turn-1',
        serviceId: 'service-1',
        repoRelativePath: 'owned.ts',
        occurredAt: '2026-07-18T00:00:00.000Z',
        evidence: {
          kind: 'baseline',
          diff: 'owned diff',
          baselineContent: 'before owned\n',
          postContent: 'after owned\n',
        },
      },
      {
        factId: 'fact-clean',
        runId: 'run-restarted',
        turnId: 'turn-1',
        provider: 'codex',
        providerSessionId: 'provider-1',
        providerThreadId: 'thread-1',
        providerTurnId: 'provider-turn-1',
        serviceId: 'service-1',
        repoRelativePath: 'clean.ts',
        occurredAt: '2026-07-18T00:00:01.000Z',
        evidence: {
          kind: 'baseline',
          diff: 'clean diff',
          baselineContent: 'clean\n',
          postContent: 'changed then restored\n',
        },
      },
      {
        factId: 'fact-second-service',
        runId: 'run-restarted',
        turnId: 'turn-1',
        provider: 'codex',
        providerSessionId: 'provider-1',
        providerThreadId: 'thread-1',
        providerTurnId: 'provider-turn-1',
        serviceId: 'service-2',
        repoRelativePath: 'owned.ts',
        occurredAt: '2026-07-18T00:00:02.000Z',
        evidence: {
          kind: 'baseline',
          diff: 'second service diff',
          baselineContent: null,
          postContent: 'second service owned\n',
        },
      },
    ]);
    await fs.writeFile(path.join(repoPath, 'owned.ts'), 'after owned\n');
    await fs.writeFile(path.join(repoPath, 'unrelated.ts'), 'unrelated\n');

    const repoStore = createTestRepoMappingStore();
    const runChangedFilesReader = new RunChangedFilesReader(repoStore);
    const wiring = createTestRunRegistryWiring({ runStore, repoStore });
    const coordinator = new RunReadRestoreCoordinator({
      runStore,
      runRegistry: wiring.runRegistry,
      logger: NOOP_LOGGER,
    });
    await coordinator.restore('run-restarted');

    const restoredRun = wiring.runRegistry.get('run-restarted');
    expect(restoredRun?.session.services).toEqual([
      { id: 'service-1', path: repoPath },
      { id: 'service-2', path: secondRepoPath },
    ]);
    expect(restoredRun?.getFileChangeProjection()).toEqual([
      { serviceId: 'service-1', repoRelativePath: 'owned.ts' },
      { serviceId: 'service-1', repoRelativePath: 'clean.ts' },
      { serviceId: 'service-2', repoRelativePath: 'owned.ts' },
    ]);
    if (!restoredRun) throw new Error('Expected the scoped read to restore the persisted Run.');
    expect(restoredRun.getPermissionRequestMessage('permission-after-restart')).toEqual({
      messageId: 'permission-message-1',
      data: null,
    });

    await expect(
      runChangedFilesReader.getLiveRunChangedFiles(
        restoredRun.session,
        restoredRun.getFileChangeProjection(),
      ),
    ).resolves.toHaveLength(1);

    const followUpRun = wiring.runRegistry.create(createRunArgsFromSession(persistedSession));
    expect(followUpRun).toBe(restoredRun);
    await expect(
      runChangedFilesReader.getLiveRunChangedFiles(
        followUpRun.session,
        followUpRun.getFileChangeProjection(),
      ),
    ).resolves.toHaveLength(1);

    restoredRun.session.promptType = 'coding_freeform';
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create)
      .mockResolvedValueOnce({ content: [], reportId: 'report-service-1' })
      .mockResolvedValueOnce({ content: [], reportId: 'report-service-2' });
    const appendReportChainEntry = vi.spyOn(restoredRun, 'appendReportChainEntry');
    await new CreateReportTool(proxy).execute({
      runId: 'run-restarted',
      run: restoredRun,
      args: {
        reportType: 'IMPLEMENT',
        audience: 'PROJECT_VISIBLE',
        payload: {
          reportType: 'IMPLEMENT',
          summary: 'restored multi-service changes',
          filesChanged: ['owned.ts'],
        },
        entities: [
          { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
          { entityType: 'AGENT_SESSION', entityId: 'run-restarted', relation: 'CONTEXT' },
        ],
      },
    });
    expect(proxy.create).toHaveBeenCalledTimes(2);
    expect(appendReportChainEntry.mock.calls.map(([entry]) => entry.serviceId)).toEqual([
      'service-1',
      'service-2',
    ]);
  });
});
