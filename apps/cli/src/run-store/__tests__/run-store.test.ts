import { handleAssistantComplete } from '../../run/handlers/assistant-complete';
import { codingFreeformHandler } from '../../agents/coding-conversation';
import { mapCodexEvent } from '../../agents/providers/codex/codex-event-mapper';
import { normalizeProviderEventPayload } from '../../agents/providers/provider-event-normalization';
import { normalizeEvent } from '../../run/normalize';
import { handleToolUse } from '../../run/handlers/tool-use';
import { makeTestRun, makeDeps, makeTestTurn } from '../../run/handlers/__test-utils';
import type { GatherTrace } from '../../jev/trace';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppendAgenticEventInput, CreateAgenticSessionInput } from '../../session/types';
import { INTERNAL_ONLY_SYSTEM_AGENT_SESSION_ID } from '../../shared/agent-bridge-contract/run-context';
import { RunStore } from '../run-store';
import { legacyRunFamilyMemberFileName, type RunFamilyMember } from '../run-files';
import type { RunStorePaths } from '../types';
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  LocalPromptType,
} from '../../shared/agent-bridge-contract/generated/api';
import type { CanonicalFileChangeFact } from '../../run/file-change-facts';
import type { RunChangedFilesDiagnosticEntry } from '../changed-files-diagnostics';

const createTempPaths = (root: string): RunStorePaths => ({
  baseDir: root,
  runsDir: path.join(root, 'runs'),
  indexPath: path.join(root, 'runs', 'run-index.json'),
  preferencesPath: path.join(root, 'preferences.json'),
});

const runFamilyMemberPath = async (
  root: string,
  runId: string,
  member: RunFamilyMember,
): Promise<string> => {
  const runsDir = path.join(root, 'runs');
  const manifest = JSON.parse(
    await fs.readFile(path.join(runsDir, `${runId}.family.json`), 'utf8'),
  ) as { members: Record<string, { relativePath: string }> };
  return path.join(runsDir, manifest.members[member]!.relativePath);
};

const demoteCurrentFamilyToLegacy = async (root: string, runId: string): Promise<void> => {
  const runsDir = path.join(root, 'runs');
  const manifestPath = path.join(runsDir, `${runId}.family.json`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    members: Record<RunFamilyMember, { relativePath: string }>;
  };
  for (const [member, descriptor] of Object.entries(manifest.members) as Array<
    [RunFamilyMember, { relativePath: string }]
  >) {
    try {
      await fs.copyFile(
        path.join(runsDir, descriptor.relativePath),
        path.join(runsDir, legacyRunFamilyMemberFileName(runId, member)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await fs.rm(manifestPath);
};

const createTaskInput = (
  overrides: Partial<CreateAgenticSessionInput> = {},
): CreateAgenticSessionInput => ({
  entity: null,
  services: [{ id: 'svc-1', path: '/tmp/repo' }],
  launchServiceId: 'svc-1',
  provider: 'claude',
  provider_session_id: `pending_${Date.now()}`,
  conversationId: 'conv-1',
  contextMetadata: {
    capturedAt: new Date().toISOString(),
    organizationId: 'org-1',
    projectId: 'proj-1',
    task: {
      id: 'task-1',
      name: 'Test task',
      type: 'STANDARD' as const,
      organizationId: 'org-1',
      projectId: 'proj-1',
      initiativeId: 'init-1',
      status: 'ACTIVE' as const,
      source: 'user' as const,
    },
    agentSessionId: 'agent-session-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
  ...overrides,
});

const makeChangedFilesDiagnostic = (
  runId: string,
  requestId: string,
): RunChangedFilesDiagnosticEntry => ({
  recordedAt: '2026-08-24T00:00:00.000Z',
  requestId,
  operation: 'run.changed_files.count',
  requestAgentSessionId: 'agent-session-1',
  runId,
  signedContext: {
    organizationId: 'org-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
  },
  runContext: {
    organizationId: 'org-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    provider: 'claude',
    providerSessionId: 'provider-1',
  },
  membership: {
    persistedFactCount: 1,
    projectionCount: 1,
    paths: [{ serviceId: 'svc-1', repoRelativePath: 'src/example.ts' }],
    providerSessionIds: ['provider-1'],
    turnIds: ['turn-1'],
    diagnosticReadError: null,
  },
  workspace: {
    launchServiceId: 'svc-1',
    workspaceRoot: '/tmp/repo',
    allowedRepositoryRoots: ['/tmp/repo'],
    services: [
      {
        serviceId: 'svc-1',
        configuredPath: '/tmp/repo',
        worktreePath: null,
        repositoryPath: null,
        branch: null,
      },
    ],
  },
  result: {
    changedFilesCount: 1,
    files: [{ serviceId: 'svc-1', repoPath: '/tmp/repo', filePath: 'src/example.ts' }],
  },
});

let tempRoot: string;
let store: RunStore;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-store-test-'));
  store = new RunStore({ paths: createTempPaths(tempRoot) });
  await store.initialize();
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('RunStore', () => {
  it.each(['claude', 'codex', 'opencode'] as const)(
    'persists %s tool calls once from provider events',
    async (provider) => {
      await store.createRun(createTaskInput({ agentic_session_id: 'run-1', provider }));
      const ctx = makeTestRun({ provider, persistenceStore: store });
      const command = {
        type: 'commandExecution',
        id: 'call-1',
        command: 'ls',
        cwd: '/tmp',
        status: 'completed',
        exitCode: 0,
        aggregatedOutput: 'a.txt',
      };
      const inputs =
        provider === 'codex'
          ? ['item/started', 'item/completed'].map((eventType) => ({
              eventType,
              rawEvent: { threadId: 'thread-1', turnId: 'turn-1', item: command },
            }))
          : provider === 'claude'
            ? [
                {
                  eventType: 'assistant',
                  rawEvent: {
                    type: 'assistant',
                    message: {
                      content: [
                        { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } },
                      ],
                    },
                  },
                },
              ]
            : [
                {
                  eventType: 'message.part.updated',
                  rawEvent: {
                    sessionID: 'provider-1',
                    part: {
                      type: 'tool',
                      tool: 'bash',
                      callID: 'call-1',
                      sessionID: 'provider-1',
                      state: {
                        status: 'completed',
                        input: { command: 'ls' },
                        output: 'a.txt',
                        time: { start: 1, end: 2 },
                      },
                    },
                  },
                },
              ];
      for (const input of inputs) {
        const normalize = provider === 'codex' ? mapCodexEvent : normalizeProviderEventPayload;
        const mapped = normalize({
          provider,
          runId: 'run-1',
          sessionId: 'provider-1',
          agentId: provider,
          timestamp: '2026-10-29T00:00:00.000Z',
          ...input,
          config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: true },
        });
        const event = normalizeEvent(
          {
            runId: 'run-1',
            source: 'provider',
            eventType: mapped.resolvedEventType ?? input.eventType,
            timestamp: '2026-10-29T00:00:00.000Z',
            sessionId: 'provider-1',
            agentId: provider,
            payload: mapped.payload,
          },
          provider,
        );
        if (event.kind === 'tool_use') {
          await handleToolUse(event, ctx, makeDeps());
        }
      }
      await vi.waitFor(async () => {
        expect(await store.getToolUsage('run-1')).toHaveLength(1);
      });
      const reopened = new RunStore({ paths: createTempPaths(tempRoot) });
      await reopened.initialize();
      expect((await reopened.getRunResult('run-1'))?.usage.toolCalls).toBe(1);
      expect(await reopened.getToolUsage('run-1')).toEqual([
        expect.objectContaining({ toolUseId: 'call-1' }),
      ]);
    },
  );

  it.each(['claude', 'codex', 'opencode'] as const)(
    'reads retained %s results without changing storage',
    async (provider) => {
      await store.createRun(createTaskInput({ agentic_session_id: 'run-1', provider }));
      expect(await store.getRunResult('missing')).toBeNull();
      expect(await store.getRunResult('run-1')).toEqual({ assistantCompleted: false, usage: {} });
      await store.updateRunLatestTurn('run-1', { turnId: 'first', state: 'running' });
      await store.updateRunFinalAssistantMessage('run-1', {
        turnId: 'first',
        messageId: 'answer',
        text: 'finished',
        committedAt: new Date().toISOString(),
      });
      await store.updateRunLatestTurn('run-1', {
        turnId: 'first',
        state: 'settled',
        outcome: 'COMPLETED',
      });
      const reopened = new RunStore({ paths: createTempPaths(tempRoot) });
      expect(await reopened.getRunResult('run-1')).toEqual({
        assistantCompleted: true,
        outputText: 'finished',
        usage: {},
      });
      for (const outcome of ['FAILED', 'ABORTED'] as const) {
        await store.updateRunLatestTurn('run-1', { turnId: 'next', state: 'settled', outcome });
        expect(await reopened.getRunResult('run-1')).toEqual({
          assistantCompleted: false,
          usage: {},
        });
      }
      await store.updateRunLatestTurn('run-1', {
        turnId: 'missing-answer',
        state: 'settled',
        outcome: 'COMPLETED',
      });
      await store.updateRunTokenUsage('run-1', { inputTokens: 0, outputTokens: 0 });
      const metadataPath = await runFamilyMemberPath(tempRoot, 'run-1', 'metadata');
      const before = await fs.readFile(metadataPath, 'utf8');
      expect(await reopened.getRunResult('run-1')).toEqual({
        assistantCompleted: true,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      expect(await fs.readFile(metadataPath, 'utf8')).toBe(before);
    },
  );

  it('reads older evidence without promoting and surfaces corrupt evidence', async () => {
    await store.createRun(createTaskInput({ agentic_session_id: 'legacy', inert: true }));
    await demoteCurrentFamilyToLegacy(tempRoot, 'legacy');
    expect(await store.getRunResult('legacy')).toEqual({ assistantCompleted: false, usage: {} });
    await expect(fs.stat(path.join(tempRoot, 'runs', 'legacy.family.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await fs.writeFile(
      path.join(tempRoot, 'runs', legacyRunFamilyMemberFileName('legacy', 'toolUsage')),
      '{broken',
    );
    await expect(store.getRunResult('legacy')).rejects.toThrow();
  });

  it('restores the latest final answer after carryover is consumed', async () => {
    const run = await store.createRun(createTaskInput({ agentic_session_id: 'run-1' }));
    for (const text of ['first answer', 'last answer']) {
      const ctx = makeTestRun({ persistenceStore: store, lastProviderStreamMessage: text });
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'provider',
          eventType: 'agent_output',
          timestamp: '2026-10-29T00:00:00.000Z',
          sessionId: 'provider-1',
          agentId: 'claude',
          payload: { summary: text, taskComplete: true, messageType: 'assistant' },
        },
        'claude',
      );
      if (event.kind !== 'assistant_complete') {
        throw new Error('Expected assistant completion');
      }
      await handleAssistantComplete(
        event,
        ctx,
        makeDeps(),
        makeTestTurn(codingFreeformHandler, text),
      );
    }
    await store.updateRunPreviousProviderSession(run.agentic_session_id, null);
    const reopened = new RunStore({ paths: createTempPaths(tempRoot) });
    await reopened.initialize();
    expect((await reopened.getRun(run.agentic_session_id))?.finalAssistantMessage).toMatchObject({
      turnId: 'last answer',
      messageId: 'oob-msg-1',
      text: 'last answer',
    });
  });

  it('retains every inert Run when an evaluation creates several executions concurrently', async () => {
    const runs = await Promise.all(
      [1, 2, 3].map((number) =>
        store.createRun(
          createTaskInput({
            agentic_session_id: `inert-${number}`,
            conversationId: `evidence-${number}`,
            inert: true,
          }),
        ),
      ),
    );
    const reopened = new RunStore({ paths: createTempPaths(tempRoot) });
    await reopened.initialize();
    for (const run of runs) {
      expect(await reopened.getRun(run.agentic_session_id)).toMatchObject({ inert: true });
    }
  });

  it('restores immutable inertness after a fresh store opens the persisted Run', async () => {
    const run = await store.createRun(createTaskInput({ inert: true }));
    const reopened = new RunStore({ paths: createTempPaths(tempRoot) });
    await reopened.initialize();
    expect(await reopened.getRun(run.agentic_session_id)).toMatchObject({ inert: true });
    await expect(
      reopened.createRun(
        createTaskInput({
          agentic_session_id: run.agentic_session_id,
          inert: false,
        }),
      ),
    ).rejects.toThrow('Run inertness cannot change');
  });

  it('preserves attachments when the authoritative completed Run is newer than retention cutoff', async () => {
    const run = await store.createRun(createTaskInput({ status: 'complete' }));
    const directory = path.join(tempRoot, 'run-attachments', run.agentic_session_id, 'attachment');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'file'), 'attachment');
    const result = await store.deleteCompletedFamiliesForRetention({
      runIds: [run.agentic_session_id],
      completedBefore: new Date(Date.parse(run.updatedAt) - 1),
    });
    expect(result).toEqual({ deletedRunCount: 0, logicalBytes: 0, pathCount: 0 });
    await expect(fs.readFile(path.join(directory, 'file'), 'utf8')).resolves.toBe('attachment');
  });
  it('keeps concurrent independent RunStore appends contiguous after reopening', async () => {
    const created = await store.createRun(createTaskInput());
    const runId = created.agentic_session_id;
    const second = new RunStore({ paths: createTempPaths(tempRoot) });
    await second.initialize();
    const input = {
      run_id: runId,
      actor: 'app',
      event_type: 'run_started',
      state_version: 1,
    } satisfies AppendAgenticEventInput;
    // Both writers retain a prior observation; the old per-instance cache collides
    // even when the next pair of appends happens to run sequentially.
    await store.appendEvent(runId, input);
    await second.appendEvent(runId, input);
    const writers = [store, second];
    const results = await Promise.allSettled(
      writers.map((writer) => writer.appendEvent(runId, input)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EEXIST' });
        await writers[index]!.appendEvent(runId, input);
      }
    }
    const reopened = new RunStore({ paths: createTempPaths(tempRoot) });
    await reopened.initialize();
    expect((await reopened.getRunWithEvents(runId))!.events.map((event) => event.seq)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  describe('initialize', () => {
    it('creates the runs directory', async () => {
      const stat = await fs.stat(path.join(tempRoot, 'runs'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('rebuilds index from existing run files on first init', async () => {
      const run = await store.createRun(createTaskInput());

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await fs.rm(path.join(tempRoot, 'runs', 'run-index.json'));
      const result = await freshStore.initialize();

      expect(result.migrated).toBe(true);
      const found = await freshStore.getRun(run.agentic_session_id);
      expect(found).not.toBeNull();
    });

    it('repairs a partially stale index before restart-trigger lookups', async () => {
      const run = await store.createRun(
        createTaskInput({
          agentic_session_id: 'restart-run',
          conversationId: 'restart-conversation',
          contextMetadata: {
            ...createTaskInput().contextMetadata,
            agentSessionId: 'restart-agent-session',
          },
        }),
      );

      const indexPath = path.join(tempRoot, 'runs', 'run-index.json');
      const staleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
      delete staleIndex.byAgentSessionId['restart-agent-session'];
      delete staleIndex.byConversationId['restart-conversation'];
      await fs.writeFile(indexPath, JSON.stringify(staleIndex, null, 2), 'utf8');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await expect(freshStore.initialize()).resolves.toEqual({ migrated: true });

      expect(freshStore.lookupByAgentSessionId('restart-agent-session')).toBe(
        run.agentic_session_id,
      );
      expect(freshStore.lookupByConversationId('restart-conversation')).toBe(
        run.agentic_session_id,
      );
    });

    it('migrates a version-1 Plan Run entity to its canonical Task identity at startup', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'version-1-plan-run' }),
      );
      const metadataPath = await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'metadata');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.entity = {
        entityType: 'PLAN',
        entityId: '11111111-1111-4111-8111-111111111111',
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      const sourceBytes = await fs.readFile(metadataPath);

      const manifestPath = path.join(tempRoot, 'runs', `${run.agentic_session_id}.family.json`);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.schemaVersion = 1;
      for (const member of Object.values(manifest.members) as Array<{ schemaVersion: number }>) {
        member.schemaVersion = 1;
      }
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await expect(freshStore.initialize()).resolves.toEqual({ migrated: false });
      await expect(freshStore.getRun(run.agentic_session_id)).resolves.toMatchObject({
        entity: {
          entityType: 'TASK',
          entityId: '11111111-1111-4111-8111-111111111111',
        },
      });
      await expect(fs.readFile(metadataPath)).resolves.toEqual(sourceBytes);

      const promotedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      expect(promotedManifest.schemaVersion).toBe(2);
      expect(
        Object.values(promotedManifest.members).every(
          (member) => (member as { schemaVersion: number }).schemaVersion === 2,
        ),
      ).toBe(true);
    });

    it('applies the Plan-to-Task migration after the legacy-family migration', async () => {
      const run = await store.createRun(createTaskInput({ agentic_session_id: 'legacy-plan-run' }));
      await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);
      const metadataPath = path.join(
        tempRoot,
        'runs',
        legacyRunFamilyMemberFileName(run.agentic_session_id, 'metadata'),
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.entity = {
        entityType: 'PLAN',
        entityId: '22222222-2222-4222-8222-222222222222',
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      const sourceBytes = await fs.readFile(metadataPath);

      const filteredRunIds: string[] = [];
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onInvalidRunMetadata: ({ runId }) => filteredRunIds.push(runId),
      });
      await expect(freshStore.initialize()).resolves.toEqual({ migrated: false });
      await expect(freshStore.getRun(run.agentic_session_id)).resolves.toMatchObject({
        entity: {
          entityType: 'TASK',
          entityId: '22222222-2222-4222-8222-222222222222',
        },
      });
      await expect(fs.readFile(metadataPath)).resolves.toEqual(sourceBytes);
      expect(filteredRunIds).toEqual([]);
    });

    it('promotes a selected legacy Run family on demand while preserving the legacy source bytes', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'legacy-family-run' }),
      );
      await store.persistIdempotencyToken(run.agentic_session_id, 'legacy-token');
      await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);
      const legacyMetadataPath = path.join(
        tempRoot,
        'runs',
        legacyRunFamilyMemberFileName(run.agentic_session_id, 'metadata'),
      );
      const sourceBytes = await fs.readFile(legacyMetadataPath);
      const progress: Array<{ operation: string; runId?: string }> = [];

      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onInitializationProgress: (event) => progress.push(event),
      });
      await expect(freshStore.initialize()).resolves.toMatchObject({ migrated: false });
      await expect(freshStore.getRun(run.agentic_session_id)).resolves.toMatchObject({
        agentic_session_id: run.agentic_session_id,
      });
      await expect(
        freshStore.hasIdempotencyToken(run.agentic_session_id, 'legacy-token'),
      ).resolves.toBe(true);
      expect(
        progress.filter(
          (event) =>
            event.operation === 'production_validation' && event.runId === run.agentic_session_id,
        ),
      ).toHaveLength(2);
      await expect(fs.readFile(legacyMetadataPath)).resolves.toEqual(sourceBytes);
    });

    it('keeps validation-only maintenance reads non-mutating until direct access', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'legacy-maintenance-run' }),
      );
      await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);
      const manifestPath = path.join(tempRoot, 'runs', `${run.agentic_session_id}.family.json`);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize({ reconcileIndex: false });

      await expect(freshStore.inspectRunFamily(run.agentic_session_id)).resolves.toMatchObject({
        agentic_session_id: run.agentic_session_id,
      });
      await expect(fs.access(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });

      await expect(freshStore.getRun(run.agentic_session_id)).resolves.toMatchObject({
        agentic_session_id: run.agentic_session_id,
      });
      await expect(fs.access(manifestPath)).resolves.toBeUndefined();
    });

    it('does not production-validate current Run sidecars during startup', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'current-family-fast-startup' }),
      );
      const toolUsagePath = await runFamilyMemberPath(
        tempRoot,
        run.agentic_session_id,
        'toolUsage',
      );
      await fs.writeFile(toolUsagePath, '{"invalid":true}', 'utf8');
      const progress: Array<{ operation: string; runId?: string }> = [];
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onInitializationProgress: (event) => progress.push(event),
      });

      await expect(freshStore.initialize()).resolves.toBeDefined();
      expect(progress).not.toContainEqual(
        expect.objectContaining({
          operation: 'production_validation',
          runId: run.agentic_session_id,
        }),
      );
      await expect(freshStore.getRun(run.agentic_session_id)).rejects.toMatchObject({
        diagnostic: { reason: 'production_codec_rejected' },
      });
      expect(progress).toContainEqual(
        expect.objectContaining({
          operation: 'production_validation',
          runId: run.agentic_session_id,
        }),
      );
    });

    it('attributes a slow manifest read to the file await rather than parsing', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'slow-manifest-read-run' }),
      );
      const progress: Array<{
        operation: string;
        status: string;
        runId?: string;
        fileReadMs?: number;
        parseMs?: number;
      }> = [];
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onInitializationProgress: (event) => progress.push(event),
      });
      await freshStore.initialize();
      const readFile = fs.readFile;
      const spy = vi
        .spyOn(fs, 'readFile')
        .mockImplementation(async (...args: Parameters<typeof readFile>) => {
          if (String(args[0]).endsWith(`${run.agentic_session_id}.family.json`))
            await new Promise((resolve) => setTimeout(resolve, 80));
          return readFile(...args);
        });
      try {
        await freshStore.getRun(run.agentic_session_id);
      } finally {
        spy.mockRestore();
      }
      const manifestRead = progress.find(
        (event) =>
          event.operation === 'manifest_read' &&
          event.status === 'completed' &&
          event.runId === run.agentic_session_id,
      );
      expect(manifestRead?.fileReadMs).toBeGreaterThanOrEqual(70);
      expect(manifestRead?.parseMs).toBeLessThan(70);
    });

    it('migrates legacy changed-files diff diagnostics only after selected access', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'legacy-diff-diagnostic-run' }),
      );
      await store.appendChangedFilesDiagnostic(
        run.agentic_session_id,
        makeChangedFilesDiagnostic(run.agentic_session_id, 'legacy-diff-request'),
      );
      await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);
      const legacyDiagnosticsPath = path.join(
        tempRoot,
        'runs',
        legacyRunFamilyMemberFileName(run.agentic_session_id, 'changedFilesDiagnostics'),
      );
      const legacyPayload = JSON.parse(await fs.readFile(legacyDiagnosticsPath, 'utf8'));
      legacyPayload.entries[0].operation = 'run.changed_files.diff';
      await fs.writeFile(legacyDiagnosticsPath, JSON.stringify(legacyPayload), 'utf8');
      const originalBytes = await fs.readFile(legacyDiagnosticsPath);
      const progress: Array<{ operation: string; status: string; runId?: string }> = [];
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onInitializationProgress: (event) => progress.push(event),
      });

      await expect(freshStore.initialize()).resolves.toEqual({ migrated: false });
      expect(progress).not.toContainEqual(
        expect.objectContaining({ operation: 'source_read', runId: run.agentic_session_id }),
      );

      await expect(
        freshStore.getChangedFilesDiagnostics(run.agentic_session_id),
      ).resolves.toMatchObject([{ operation: 'run.changed_files.inventory' }]);
      await expect(fs.readFile(legacyDiagnosticsPath)).resolves.toEqual(originalBytes);
      expect(progress).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'run_family',
            status: 'started',
            runId: run.agentic_session_id,
          }),
          expect.objectContaining({
            operation: 'source_read',
            status: 'completed',
            runId: run.agentic_session_id,
          }),
          expect.objectContaining({
            operation: 'generation_member_promotion',
            status: 'completed',
            runId: run.agentic_session_id,
          }),
          expect.objectContaining({
            operation: 'run_family_scan',
            status: 'completed',
          }),
        ]),
      );

      const firstGenerationDiagnosticsPath = await runFamilyMemberPath(
        tempRoot,
        run.agentic_session_id,
        'changedFilesDiagnostics',
      );
      const firstGenerationPayload = JSON.parse(
        await fs.readFile(firstGenerationDiagnosticsPath, 'utf8'),
      );
      firstGenerationPayload.entries[0].operation = 'run.changed_files.diff';
      await fs.writeFile(
        firstGenerationDiagnosticsPath,
        JSON.stringify(firstGenerationPayload),
        'utf8',
      );
      const firstGenerationBytes = await fs.readFile(firstGenerationDiagnosticsPath);
      const reopenedStore = new RunStore({ paths: createTempPaths(tempRoot) });

      await expect(reopenedStore.initialize()).resolves.toEqual({ migrated: false });
      await expect(
        reopenedStore.getChangedFilesDiagnostics(run.agentic_session_id),
      ).resolves.toMatchObject([{ operation: 'run.changed_files.inventory' }]);
      await expect(fs.readFile(firstGenerationDiagnosticsPath)).resolves.toEqual(
        firstGenerationBytes,
      );
    });

    it('isolates a newer Run family without blocking compatible Runs or changing source bytes', async () => {
      const incompatible = await store.createRun(
        createTaskInput({ agentic_session_id: 'newer-family-run' }),
      );
      const compatible = await store.createRun(
        createTaskInput({
          agentic_session_id: 'compatible-family-run',
          provider_session_id: 'compatible-provider',
          contextMetadata: {
            ...createTaskInput().contextMetadata,
            agentSessionId: 'compatible-agent-session',
          },
        }),
      );
      const manifestPath = path.join(
        tempRoot,
        'runs',
        `${incompatible.agentic_session_id}.family.json`,
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.schemaVersion = 99;
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      const sourceBytes = await fs.readFile(
        await runFamilyMemberPath(tempRoot, incompatible.agentic_session_id, 'metadata'),
      );

      const diagnostics: string[] = [];
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onCompatibilityDiagnostic: (diagnostic) => diagnostics.push(diagnostic.reason),
      });
      await expect(freshStore.initialize()).resolves.toBeDefined();
      await expect(freshStore.getRun(compatible.agentic_session_id)).resolves.toMatchObject({
        agentic_session_id: compatible.agentic_session_id,
      });
      await expect(freshStore.getRun(incompatible.agentic_session_id)).rejects.toMatchObject({
        diagnostic: {
          reason: 'unsupported_newer_schema',
          sourceSchemaVersion: 99,
          currentSchemaVersion: 2,
        },
      });
      await expect(freshStore.getRun(incompatible.agentic_session_id)).rejects.toMatchObject({
        diagnostic: { reason: 'unsupported_newer_schema' },
      });
      expect(diagnostics).toEqual(['unsupported_newer_schema']);
      await expect(
        fs.readFile(
          await runFamilyMemberPath(tempRoot, incompatible.agentic_session_id, 'metadata'),
        ),
      ).resolves.toEqual(sourceBytes);
    });

    it('isolates a manifest that redirects a member to another Run generation', async () => {
      const redirected = await store.createRun(
        createTaskInput({ agentic_session_id: 'redirected-family-run' }),
      );
      const target = await store.createRun(
        createTaskInput({
          agentic_session_id: 'redirect-target-run',
          provider_session_id: 'redirect-target-provider',
          contextMetadata: {
            ...createTaskInput().contextMetadata,
            agentSessionId: 'redirect-target-agent-session',
          },
        }),
      );
      const redirectedManifestPath = path.join(
        tempRoot,
        'runs',
        `${redirected.agentic_session_id}.family.json`,
      );
      const redirectedManifest = JSON.parse(await fs.readFile(redirectedManifestPath, 'utf8'));
      const targetManifest = JSON.parse(
        await fs.readFile(
          path.join(tempRoot, 'runs', `${target.agentic_session_id}.family.json`),
          'utf8',
        ),
      );
      redirectedManifest.members.metadata.relativePath =
        targetManifest.members.metadata.relativePath;
      await fs.writeFile(
        redirectedManifestPath,
        JSON.stringify(redirectedManifest, null, 2),
        'utf8',
      );
      const targetMetadataPath = await runFamilyMemberPath(
        tempRoot,
        target.agentic_session_id,
        'metadata',
      );
      const targetBytes = await fs.readFile(targetMetadataPath);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await expect(freshStore.initialize()).resolves.toBeDefined();
      await expect(freshStore.getRun(redirected.agentic_session_id)).rejects.toMatchObject({
        diagnostic: { reason: 'production_codec_rejected' },
      });
      await expect(freshStore.getRun(target.agentic_session_id)).resolves.toMatchObject({
        agentic_session_id: target.agentic_session_id,
      });
      await expect(fs.readFile(targetMetadataPath)).resolves.toEqual(targetBytes);
    });

    it('does not publish a partial generation when a legacy sidecar fails production validation', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'invalid-legacy-family' }),
      );
      await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);
      const metadataPath = path.join(
        tempRoot,
        'runs',
        legacyRunFamilyMemberFileName(run.agentic_session_id, 'metadata'),
      );
      const toolUsagePath = path.join(
        tempRoot,
        'runs',
        legacyRunFamilyMemberFileName(run.agentic_session_id, 'toolUsage'),
      );
      await fs.writeFile(toolUsagePath, '{"invalid":true}', 'utf8');
      const metadataBytes = await fs.readFile(metadataPath);
      const sidecarBytes = await fs.readFile(toolUsagePath);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      await expect(freshStore.getRun(run.agentic_session_id)).rejects.toMatchObject({
        diagnostic: { reason: 'production_codec_rejected' },
      });
      await expect(
        fs.access(path.join(tempRoot, 'runs', `${run.agentic_session_id}.family.json`)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(metadataPath)).resolves.toEqual(metadataBytes);
      await expect(fs.readFile(toolUsagePath)).resolves.toEqual(sidecarBytes);
    });

    it('rebuilds the index while filtering historical runs that omit entity', async () => {
      const validRun = await store.createRun(
        createTaskInput({ agentic_session_id: 'valid-run', promptType: 'daily_session' }),
      );
      const invalidRun = await store.createRun(
        createTaskInput({ agentic_session_id: 'historical-run', promptType: 'daily_session' }),
      );
      const invalidMetadataPath = await runFamilyMemberPath(
        tempRoot,
        invalidRun.agentic_session_id,
        'metadata',
      );
      const invalidMetadata = JSON.parse(await fs.readFile(invalidMetadataPath, 'utf8'));
      delete invalidMetadata.entity;
      await fs.writeFile(invalidMetadataPath, JSON.stringify(invalidMetadata, null, 2), 'utf8');
      await fs.rm(path.join(tempRoot, 'runs', 'run-index.json'));
      const filteredRunIds: string[] = [];
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        onInvalidRunMetadata: ({ runId }) => filteredRunIds.push(runId),
      });

      await expect(freshStore.initialize()).resolves.toEqual({ migrated: true });
      await expect(freshStore.listRuns()).resolves.toEqual([
        expect.objectContaining({ agentic_session_id: validRun.agentic_session_id }),
      ]);
      await expect(freshStore.findRunsByPromptType('daily_session')).resolves.toEqual([
        expect.objectContaining({ agentic_session_id: validRun.agentic_session_id }),
      ]);
      await expect(freshStore.getRun(invalidRun.agentic_session_id)).rejects.toThrow(
        /missing entity/,
      );
      expect(filteredRunIds).toContain(invalidRun.agentic_session_id);
    });
  });

  describe('createRun', () => {
    it('creates a run with generated id', async () => {
      const run = await store.createRun(createTaskInput());
      expect(run.agentic_session_id).toBeTruthy();
      expect(run.launchServiceId).toBe('svc-1');
      expect(run.services).toEqual([{ id: 'svc-1', path: '/tmp/repo' }]);
      expect(run.provider).toBe('claude');
      expect(run.status).toBe('idle');
      expect(run.events).toEqual([]);
      expect(run.conversationId).toBe('conv-1');
    });

    it('creates a run with explicit id', async () => {
      const run = await store.createRun(createTaskInput({ agentic_session_id: 'my-run-id' }));
      expect(run.agentic_session_id).toBe('my-run-id');
    });

    it('persists typed AgentSession config on the local Run', async () => {
      const config = {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: 'claude-opus-4-7',
        projectAssistant: {
          enabled: false,
          allowEdgeUpdates: true,
          notifyDiscrepancies: false,
          allowUpdateProposals: true,
        },
      };

      const run = await store.createRun(createTaskInput({ config }));
      const reloaded = await store.getRun(run.agentic_session_id);

      expect(run.config).toEqual(config);
      expect(reloaded?.config).toEqual(config);
    });

    it.each([
      ['omitted', undefined],
      ['enabled', { enabled: true }],
      ['disabled', { enabled: false }],
    ] as const)(
      'persists Entity Conversation Project Assistant %s',
      async (_state, projectAssistant) => {
        const config = {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: 'gpt-5.6-luna',
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
        };

        const run = await store.createRun(createTaskInput({ config }));
        const reloaded = await store.getRun(run.agentic_session_id);

        expect(run.config).toEqual(config);
        expect(reloaded?.config).toEqual(config);
      },
    );

    it.each([
      ['codex', true],
      ['codex', false],
      ['claude', true],
      ['claude', false],
    ] as const)('persists and restores %s fastMode=%s', async (provider, fastMode) => {
      const run = await store.createRun(createTaskInput({ provider, fastMode }));
      const reloaded = await store.getRun(run.agentic_session_id);

      expect(run.fastMode).toBe(fastMode);
      expect(reloaded?.fastMode).toBe(fastMode);
    });

    it.each(['codex', 'claude'] as const)(
      'omits fastMode for %s when no launch preference was supplied',
      async (provider) => {
        const run = await store.createRun(createTaskInput({ provider }));
        const reloaded = await store.getRun(run.agentic_session_id);

        expect(run).not.toHaveProperty('fastMode');
        expect(reloaded).not.toHaveProperty('fastMode');
      },
    );

    it('rejects persisted metadata that omits entity', async () => {
      const run = await store.createRun(createTaskInput());
      const metadataPath = await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'metadata');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      delete metadata.entity;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      await expect(store.getRun(run.agentic_session_id)).rejects.toThrow(/missing entity/);
    });

    it('rejects an invalid entity before writing Run metadata', async () => {
      const input = {
        ...createTaskInput({ agentic_session_id: 'invalid-entity' }),
        entity: { entityType: 'TASK', entityId: 'not-a-uuid' },
      } as unknown as CreateAgenticSessionInput;

      await expect(store.createRun(input)).rejects.toThrow(/entity is invalid/);
      await expect(
        fs.access(path.join(tempRoot, 'runs', 'invalid-entity.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('restores the same entity after store reconstruction', async () => {
      const entity = {
        entityType: 'DESIGN_DOC' as const,
        entityId: '11111111-1111-4111-8111-111111111111',
      };
      const run = await store.createRun(createTaskInput({ entity }));
      const reconstructedStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await reconstructedStore.initialize();

      expect((await reconstructedStore.getRun(run.agentic_session_id))?.entity).toEqual(entity);
    });

    it('is idempotent for a duplicate agentic session id', async () => {
      const entity = {
        entityType: 'TASK' as const,
        entityId: '11111111-1111-4111-8111-111111111111',
      };
      const first = await store.createRun(
        createTaskInput({ agentic_session_id: 'dup-id', entity }),
      );
      const second = await store.createRun(
        createTaskInput({ agentic_session_id: 'dup-id', entity }),
      );
      expect(second.agentic_session_id).toBe(first.agentic_session_id);
      expect(second.entity).toEqual(entity);
    });

    it('rejects a duplicate agentic session id with a different entity', async () => {
      await store.createRun(
        createTaskInput({
          agentic_session_id: 'conflicting-id',
          entity: {
            entityType: 'TASK',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
        }),
      );

      await expect(
        store.createRun(
          createTaskInput({
            agentic_session_id: 'conflicting-id',
            entity: {
              entityType: 'TASK',
              entityId: '22222222-2222-4222-8222-222222222222',
            },
          }),
        ),
      ).rejects.toThrow(/different entity/);
    });

    it('serializes concurrent creates for the same agentic session id', async () => {
      // Two createRun calls race for the same explicit id. withMetadataLock
      // serializes them so the second observes the first's write rather than
      // double-writing (TOCTOU). Both must resolve to the same run.
      const [first, second] = await Promise.all([
        store.createRun(createTaskInput({ agentic_session_id: 'concurrent-id' })),
        store.createRun(createTaskInput({ agentic_session_id: 'concurrent-id' })),
      ]);
      expect(first.agentic_session_id).toBe('concurrent-id');
      expect(second.agentic_session_id).toBe('concurrent-id');
      expect(second.agentic_session_id).toBe(first.agentic_session_id);
    });

    it('rejects one of two concurrent creates with different entities', async () => {
      const results = await Promise.allSettled([
        store.createRun(
          createTaskInput({
            agentic_session_id: 'concurrent-conflict-id',
            entity: {
              entityType: 'TASK',
              entityId: '11111111-1111-4111-8111-111111111111',
            },
          }),
        ),
        store.createRun(
          createTaskInput({
            agentic_session_id: 'concurrent-conflict-id',
            entity: {
              entityType: 'TASK',
              entityId: '22222222-2222-4222-8222-222222222222',
            },
          }),
        ),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });

    it('keeps a missing byAgentSessionId index entry repaired across duplicate create', async () => {
      const first = await store.createRun(createTaskInput({ agentic_session_id: 'drift-id' }));

      // Simulate a stale index by dropping only the byAgentSessionId entry.
      const indexPath = path.join(tempRoot, 'runs', 'run-index.json');
      const staleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
      delete staleIndex.byAgentSessionId['agent-session-1'];
      await fs.writeFile(indexPath, JSON.stringify(staleIndex, null, 2), 'utf8');

      // A future-dated clock makes a freshly minted run distinguishable from
      // the pre-existing one by its createdAt.
      const freshStore = new RunStore({
        paths: createTempPaths(tempRoot),
        now: () => new Date('2099-01-01T00:00:00.000Z'),
      });
      await freshStore.initialize();
      expect(freshStore.lookupByAgentSessionId('agent-session-1')).toBe('drift-id');

      // createRun for the same id resolves to the pre-existing run (same
      // createdAt — not a freshly minted object) and preserves the index.
      const second = await freshStore.createRun(
        createTaskInput({ agentic_session_id: 'drift-id' }),
      );
      expect(second.agentic_session_id).toBe(first.agentic_session_id);
      expect(second.createdAt).toBe(first.createdAt);
      expect(freshStore.lookupByAgentSessionId('agent-session-1')).toBe('drift-id');
    });

    it('rejects empty string agentic session id', async () => {
      await expect(store.createRun(createTaskInput({ agentic_session_id: '  ' }))).rejects.toThrow(
        /non-empty string/,
      );
    });

    it('requires contextMetadata for TASK origin', async () => {
      const input = createTaskInput();
      (input as unknown as Record<string, unknown>)['contextMetadata'] = undefined;
      await expect(store.createRun(input)).rejects.toThrow(/contextMetadata/);
    });

    it('persists run to disk', async () => {
      const run = await store.createRun(createTaskInput());
      const onDisk = await fs.readFile(
        await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'metadata'),
        'utf8',
      );
      const parsed = JSON.parse(onDisk);
      expect(parsed.agentic_session_id).toBe(run.agentic_session_id);
      expect(parsed.events).toBeUndefined();
    });

    it('updates index with agentSessionId', async () => {
      const run = await store.createRun(createTaskInput());
      const indexText = await fs.readFile(path.join(tempRoot, 'runs', 'run-index.json'), 'utf8');
      const index = JSON.parse(indexText);
      expect(index.byAgentSessionId['agent-session-1']).toBe(run.agentic_session_id);
    });

    it('creates non-task run', async () => {
      const run = await store.createRun({
        entity: null,
        services: [{ id: 'svc-1', path: '/tmp/repo' }],
        launchServiceId: 'svc-1',
        provider: 'claude',
        provider_session_id: 'prov-1',
        conversationId: 'conv-2',
        contextMetadata: {
          capturedAt: new Date().toISOString(),
          organizationId: 'org-1',
          projectId: 'proj-1',
          agentSessionId: INTERNAL_ONLY_SYSTEM_AGENT_SESSION_ID,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      });
      expect(run.launchServiceId).toBe('svc-1');
      expect(run.services).toEqual([{ id: 'svc-1', path: '/tmp/repo' }]);
    });
  });

  describe('getRun', () => {
    it('returns null for nonexistent run', async () => {
      const result = await store.getRun('nonexistent');
      expect(result).toBeNull();
    });

    it('returns run without events', async () => {
      const created = await store.createRun(createTaskInput());
      await store.appendEvent(created.agentic_session_id, {
        run_id: created.agentic_session_id,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
      });

      const run = await store.getRun(created.agentic_session_id);
      expect(run).not.toBeNull();
      expect(run!.events).toEqual([]);
    });
  });

  describe('getRunWithEvents', () => {
    it('returns run with events', async () => {
      const created = await store.createRun(createTaskInput());
      await store.appendEvent(created.agentic_session_id, {
        run_id: created.agentic_session_id,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
      });

      const run = await store.getRunWithEvents(created.agentic_session_id);
      expect(run).not.toBeNull();
      expect(run!.events).toHaveLength(1);
      expect(run!.events[0]!.event_type).toBe('run_started');
    });

    it('returns null for nonexistent run', async () => {
      const result = await store.getRunWithEvents('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listRuns', () => {
    it('returns empty list when no runs exist', async () => {
      const runs = await store.listRuns();
      expect(runs).toEqual([]);
    });

    it('returns all runs without events', async () => {
      await store.createRun(createTaskInput({ agentic_session_id: 'run-1' }));
      await store.createRun(
        createTaskInput({
          agentic_session_id: 'run-2',
          provider_session_id: 'prov-2',
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: 'org-1',
            projectId: 'proj-1',
            task: {
              id: 'task-2',
              name: 'Test 2',
              type: 'STANDARD' as const,
              organizationId: 'org-1',
              projectId: 'proj-1',
              initiativeId: 'init-1',
              status: 'ACTIVE' as const,
              source: 'user' as const,
            },
            agentSessionId: 'agent-session-2',
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        }),
      );

      const runs = await store.listRuns();
      expect(runs).toHaveLength(2);
      const ids = runs.map((r) => r.agentic_session_id).sort();
      expect(ids).toEqual(['run-1', 'run-2']);
      for (const run of runs) {
        expect(run.events).toEqual([]);
      }
    });

    it('filters invalid historical metadata without weakening direct reads', async () => {
      const validRun = await store.createRun(createTaskInput({ agentic_session_id: 'valid-run' }));
      const invalidRun = await store.createRun(
        createTaskInput({ agentic_session_id: 'historical-run' }),
      );
      const metadataPath = await runFamilyMemberPath(
        tempRoot,
        invalidRun.agentic_session_id,
        'metadata',
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      delete metadata.entity;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      await expect(store.listRuns()).resolves.toEqual([
        expect.objectContaining({ agentic_session_id: validRun.agentic_session_id }),
      ]);
      await expect(store.getRun(invalidRun.agentic_session_id)).rejects.toThrow(/missing entity/);
    });
  });

  describe('updateRunStatus', () => {
    it('updates status and updatedAt', async () => {
      let tick = 0;
      const tickingStore = new RunStore({
        paths: createTempPaths(tempRoot),
        now: () => new Date(Date.now() + tick++ * 1000),
      });
      await tickingStore.initialize();
      const created = await tickingStore.createRun(createTaskInput());
      const updated = await tickingStore.updateRunStatus(created.agentic_session_id, 'running');
      expect(updated.status).toBe('running');
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });

    it('persists status change to disk', async () => {
      const created = await store.createRun(createTaskInput());
      await store.updateRunStatus(created.agentic_session_id, 'complete');
      const reloaded = await store.getRun(created.agentic_session_id);
      expect(reloaded!.status).toBe('complete');
    });

    it('throws for unknown run', async () => {
      await expect(store.updateRunStatus('nonexistent', 'running')).rejects.toThrow(/Unknown/);
    });
  });

  describe('updateRunProviderIdentity', () => {
    it('updates provider session id', async () => {
      const created = await store.createRun(createTaskInput());
      const updated = await store.updateRunProviderIdentity(created.agentic_session_id, {
        providerSessionId: 'real-provider-id',
        providerSessionAgentId: 'test-agent',
      });
      expect(updated.provider_session_id).toBe('real-provider-id');
      expect(updated.provider_session_agent_id).toBe('test-agent');
    });

    it('updates provider conversation id', async () => {
      const created = await store.createRun(createTaskInput());
      const updated = await store.updateRunProviderIdentity(created.agentic_session_id, {
        providerSessionId: 'real-provider-id',
        providerConversationId: 'conv-id-123',
        providerSessionAgentId: 'test-agent',
      });
      expect(updated.provider_conversation_id).toBe('conv-id-123');
    });

    it('clears the provider session, conversation, and owning handler together', async () => {
      const created = await store.createRun(createTaskInput());
      await store.updateRunProviderIdentity(created.agentic_session_id, {
        providerSessionId: 'real-provider-id',
        providerConversationId: 'conv-id-123',
        providerSessionAgentId: 'test-agent',
      });

      const cleared = await store.updateRunProviderIdentity(created.agentic_session_id, {
        providerSessionId: null,
      });

      expect(cleared.provider_session_id).toBeNull();
      expect(cleared.provider_conversation_id).toBeNull();
      expect(cleared.provider_session_agent_id).toBeNull();
    });

    it('rejects a real provider session id without an owning handler id', async () => {
      const created = await store.createRun(createTaskInput());

      await expect(
        store.updateRunProviderIdentity(created.agentic_session_id, {
          providerSessionId: 'real-provider-id',
        }),
      ).rejects.toThrow(/requires a provider session agent id/);
    });

    it('rejects an empty provider session agent id', async () => {
      const created = await store.createRun(createTaskInput());

      await expect(
        store.updateRunProviderIdentity(created.agentic_session_id, {
          providerSessionId: 'real-provider-id',
          providerSessionAgentId: '  ',
        }),
      ).rejects.toThrow(/agent id must be null or a non-empty string/);
    });

    it('detects conflicting provider session id via index', async () => {
      await store.createRun(createTaskInput({ agentic_session_id: 'run-1' }));
      await store.updateRunProviderIdentity('run-1', {
        providerSessionId: 'shared-prov-id',
        providerSessionAgentId: 'test-agent',
      });

      await store.createRun(
        createTaskInput({
          agentic_session_id: 'run-2',
          provider_session_id: 'pending-2',
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: 'org-1',
            projectId: 'proj-1',
            task: {
              id: 'task-2',
              name: 'Test 2',
              type: 'STANDARD' as const,
              organizationId: 'org-1',
              projectId: 'proj-1',
              initiativeId: 'init-1',
              status: 'ACTIVE' as const,
              source: 'user' as const,
            },
            agentSessionId: 'agent-session-2',
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        }),
      );

      await expect(
        store.updateRunProviderIdentity('run-2', {
          providerSessionId: 'shared-prov-id',
          providerSessionAgentId: 'test-agent',
        }),
      ).rejects.toThrow(/already exists/);
    });

    it('rejects empty provider session id', async () => {
      const created = await store.createRun(createTaskInput());
      await expect(
        store.updateRunProviderIdentity(created.agentic_session_id, { providerSessionId: '  ' }),
      ).rejects.toThrow(/non-empty string/);
    });

    it('throws for unknown run', async () => {
      await expect(
        store.updateRunProviderIdentity('nonexistent', { providerSessionId: 'x' }),
      ).rejects.toThrow(/Unknown/);
    });
  });

  describe('provider session history', () => {
    it('appends each real membership once and retains it across clear and restart', async () => {
      const created = await store.createRun(createTaskInput());
      const entry = {
        providerSessionId: 'real-provider-id',
        providerConversationId: 'provider-conversation-id',
        providerSessionAgentId: 'coding_freeform',
        observedAt: '2026-07-27T20:00:00.000Z',
      };

      await store.appendRunProviderSessionHistory(created.agentic_session_id, entry);
      await store.appendRunProviderSessionHistory(created.agentic_session_id, {
        ...entry,
        observedAt: '2026-07-27T20:01:00.000Z',
      });
      await store.updateRunProviderIdentity(created.agentic_session_id, {
        providerSessionId: null,
      });

      const restartedStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await restartedStore.initialize();
      const restarted = await restartedStore.getRun(created.agentic_session_id);

      expect(restarted?.provider_session_id).toBeNull();
      expect(restarted?.provider_session_history).toEqual([entry]);
    });

    it('reconciles legacy event identities without changing the active pointer', async () => {
      const created = await store.createRun(
        createTaskInput({
          agentic_session_id: 'legacy-run',
          provider_session_id: 'pending_legacy',
        }),
      );
      const metadataPath = await runFamilyMemberPath(
        tempRoot,
        created.agentic_session_id,
        'metadata',
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      delete metadata.provider_session_history;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      await store.appendEvent(created.agentic_session_id, {
        run_id: created.agentic_session_id,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
        payload: {
          mode: 'prompt',
          prompt: 'test',
          adapterId: 'claude',
          repositoryPath: '/tmp',
          provider_session_id: 'legacy-provider-id',
          provider_conversation_id: 'legacy-conversation-id',
        },
      });
      await store.appendEvent(created.agentic_session_id, {
        run_id: created.agentic_session_id,
        actor: 'app',
        event_type: 'run_completed',
        state_version: 2,
        payload: {
          mode: 'prompt',
          provider_session_id: 'legacy-provider-id',
          provider_conversation_id: 'legacy-conversation-id',
        },
      });

      const reconciled = await store.getRun(created.agentic_session_id);
      expect(reconciled?.provider_session_id).toBe('pending_legacy');
      expect(reconciled?.provider_session_history).toEqual([
        {
          providerSessionId: 'legacy-provider-id',
          providerConversationId: 'legacy-conversation-id',
          providerSessionAgentId: null,
          observedAt: expect.any(String),
        },
      ]);

      const persisted = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      expect(persisted.provider_session_history).toEqual(reconciled?.provider_session_history);
    });
  });

  describe('updateRunWorktreeState', () => {
    it('persists every service entry in the worktree state map', async () => {
      const created = await store.createRun(createTaskInput());
      const worktreeState = {
        'svc-1': {
          worktreePath: '/tmp/repo/.worktrees/branch-a',
          branch: 'branch-a',
          repoPath: '/tmp/repo',
        },
        'svc-2': {
          worktreePath: '/tmp/other/.worktrees/branch-a',
          branch: 'branch-a',
          repoPath: '/tmp/other',
        },
      };

      const updated = await store.updateRunWorktreeState(created.agentic_session_id, worktreeState);
      expect(updated.worktreeState).toEqual(worktreeState);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const reloaded = await freshStore.getRun(created.agentic_session_id);
      expect(reloaded!.worktreeState).toEqual(worktreeState);

      const metadataPath = await runFamilyMemberPath(
        tempRoot,
        created.agentic_session_id,
        'metadata',
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      expect(metadata.worktreeState).toEqual(worktreeState);
    });

    it('upgrades legacy single-record worktree state using the launch service id', async () => {
      const created = await store.createRun(createTaskInput());
      const legacyState = {
        worktreePath: '/tmp/repo/.worktrees/legacy',
        branch: 'legacy',
        repoPath: '/tmp/repo',
      };
      const metadataPath = await runFamilyMemberPath(
        tempRoot,
        created.agentic_session_id,
        'metadata',
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.worktreeState = legacyState;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const reloaded = await freshStore.getRun(created.agentic_session_id);

      expect(reloaded!.worktreeState).toEqual({ 'svc-1': legacyState });
    });

    it('upgrades legacy single-record worktree state using repoPath when launch service is absent', async () => {
      const created = await store.createRun(createTaskInput());
      const legacyState = {
        worktreePath: '/tmp/repo/.worktrees/legacy',
        branch: 'legacy',
        repoPath: '/tmp/repo',
      };
      const metadataPath = await runFamilyMemberPath(
        tempRoot,
        created.agentic_session_id,
        'metadata',
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      delete metadata.launchServiceId;
      metadata.services = [];
      metadata.worktreeState = legacyState;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const reloaded = await freshStore.getRun(created.agentic_session_id);

      expect(reloaded!.worktreeState).toEqual({ '/tmp/repo': legacyState });
    });

    it('throws for unknown run', async () => {
      await expect(store.updateRunWorktreeState('nonexistent', {})).rejects.toThrow(/Unknown/);
    });
  });

  describe('updateRunServices', () => {
    it('atomically persists the approved Service union while retaining the launch anchor', async () => {
      const created = await store.createRun(createTaskInput());
      const services = [
        { id: 'svc-1', path: '/tmp/repo' },
        { id: 'svc-2', path: '/tmp/other' },
      ];

      const updated = await store.updateRunServices(created.agentic_session_id, {
        services,
        launchServiceId: 'svc-1',
      });

      expect(updated.services).toEqual(services);
      expect(updated.launchServiceId).toBe('svc-1');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      await expect(freshStore.getRun(created.agentic_session_id)).resolves.toEqual(
        expect.objectContaining({
          services,
          launchServiceId: 'svc-1',
        }),
      );
    });

    it('rejects a launch Service outside the persisted scope', async () => {
      const created = await store.createRun(createTaskInput());

      await expect(
        store.updateRunServices(created.agentic_session_id, {
          services: [{ id: 'svc-1', path: '/tmp/repo' }],
          launchServiceId: 'svc-missing',
        }),
      ).rejects.toThrow('is not in the service scope');

      await expect(store.getRun(created.agentic_session_id)).resolves.toEqual(
        expect.objectContaining({
          services: [{ id: 'svc-1', path: '/tmp/repo' }],
          launchServiceId: 'svc-1',
        }),
      );
    });
  });

  describe('appendEvent', () => {
    it('appends event with auto-incremented seq', async () => {
      const run = await store.createRun(createTaskInput());
      const event1 = await store.appendEvent(run.agentic_session_id, {
        run_id: run.agentic_session_id,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
      });
      expect(event1.seq).toBe(1);
      expect(event1.app_session_id).toBe(run.agentic_session_id);

      const event2 = await store.appendEvent(run.agentic_session_id, {
        run_id: run.agentic_session_id,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
      });
      expect(event2.seq).toBe(2);
    });

    it('persists events to JSONL file', async () => {
      const run = await store.createRun(createTaskInput());
      await store.appendEvent(run.agentic_session_id, {
        run_id: run.agentic_session_id,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
      });

      const jsonl = await fs.readFile(
        await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'events'),
        'utf8',
      );
      const lines = jsonl.trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.event_type).toBe('run_started');
    });

    it('keeps ordinary provider output transient instead of writing its envelope', async () => {
      const run = await store.createRun(createTaskInput());
      const transient = await store.appendEvent(run.agentic_session_id, {
        run_id: run.agentic_session_id,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: {
          messageType: 'provider_event',
          provider: 'claude',
          eventType: 'assistant',
          raw_event: { type: 'assistant', message: { content: 'transient' } },
        },
      });

      expect(transient.payload).toMatchObject({ messageType: 'provider_event' });
      await expect(store.readDurableRunEvents(run.agentic_session_id)).resolves.toEqual([]);
      await expect(
        fs.access(await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'events')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('serializes concurrent appends per run', async () => {
      const run = await store.createRun(createTaskInput());
      const promises = Array.from({ length: 5 }, (_, i) =>
        store.appendEvent(run.agentic_session_id, {
          run_id: run.agentic_session_id,
          actor: 'agent',
          event_type: 'agent_output',
          state_version: 1,
          payload: { messageType: `msg-${i}` },
        }),
      );
      const events = await Promise.all(promises);
      const seqs = events.map((e) => e.seq).sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
    });

    it('includes payload and payload_ref when provided', async () => {
      const run = await store.createRun(createTaskInput());
      const event = await store.appendEvent(run.agentic_session_id, {
        run_id: run.agentic_session_id,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
        payload: { mode: 'prompt', prompt: 'test', adapterId: 'claude', repositoryPath: '/tmp' },
        payload_ref: 'ref-123',
      });
      expect(event.payload).toBeDefined();
      expect(event.payload_ref).toBe('ref-123');
    });
  });

  describe('provider preference', () => {
    it('returns null when no preference set', async () => {
      const pref = await store.getProviderPreference();
      expect(pref).toBeNull();
    });

    it('persists and retrieves preference', async () => {
      await store.setProviderPreference('codex');
      const pref = await store.getProviderPreference();
      expect(pref).toBe('codex');
    });

    it('overwrites existing preference', async () => {
      await store.setProviderPreference('codex');
      await store.setProviderPreference('claude');
      const pref = await store.getProviderPreference();
      expect(pref).toBe('claude');
    });
  });

  describe('index lookups', () => {
    it('finds run by agentSessionId after create', async () => {
      const run = await store.createRun(createTaskInput());

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();

      const found = await freshStore.getRun(run.agentic_session_id);
      expect(found).not.toBeNull();
      expect(found!.agentic_session_id).toBe(run.agentic_session_id);
    });

    it('updates provider session id in index after identity update', async () => {
      const run = await store.createRun(createTaskInput());
      await store.updateRunProviderIdentity(run.agentic_session_id, {
        providerSessionId: 'real-prov-id',
        providerSessionAgentId: 'test-agent',
      });

      const indexText = await fs.readFile(path.join(tempRoot, 'runs', 'run-index.json'), 'utf8');
      const index = JSON.parse(indexText);
      expect(index.byProviderSessionId['real-prov-id']).toBe(run.agentic_session_id);
    });
  });

  describe('reindexRun', () => {
    it('re-adds a missing byAgentSessionId entry from a stale index', async () => {
      const run = await store.createRun(createTaskInput());

      // Simulate a stale index: drop the byAgentSessionId entry from the
      // persisted index file while leaving the run file itself on disk.
      const indexPath = path.join(tempRoot, 'runs', 'run-index.json');
      const staleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
      delete staleIndex.byAgentSessionId['agent-session-1'];
      await fs.writeFile(indexPath, JSON.stringify(staleIndex, null, 2), 'utf8');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      expect(freshStore.lookupByAgentSessionId('agent-session-1')).toBe(run.agentic_session_id);

      const onDisk = await freshStore.getRun(run.agentic_session_id);
      expect(onDisk).not.toBeNull();

      await freshStore.reindexRun(onDisk!);

      // The in-memory index now resolves the agentSessionId.
      expect(freshStore.lookupByAgentSessionId('agent-session-1')).toBe(run.agentic_session_id);

      // ...and the repair is persisted: a brand-new store loads the fixed index.
      const reloadedStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await reloadedStore.initialize();
      expect(reloadedStore.lookupByAgentSessionId('agent-session-1')).toBe(run.agentic_session_id);
    });
  });

  describe('idempotency tokens', () => {
    it('returns false for a token that has not been persisted', async () => {
      const run = await store.createRun(createTaskInput());
      const result = await store.hasIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');
      expect(result).toBe(false);
    });

    it('returns true after a token is persisted', async () => {
      const run = await store.createRun(createTaskInput());
      await store.persistIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');
      const result = await store.hasIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');
      expect(result).toBe(true);
    });

    it('persists multiple tokens without overwriting', async () => {
      const run = await store.createRun(createTaskInput());
      await store.persistIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');
      await store.persistIdempotencyToken(run.agentic_session_id, 'proc:run:step-2');

      expect(await store.hasIdempotencyToken(run.agentic_session_id, 'proc:run:step-1')).toBe(true);
      expect(await store.hasIdempotencyToken(run.agentic_session_id, 'proc:run:step-2')).toBe(true);
    });

    it('does not duplicate tokens on repeat persist', async () => {
      const run = await store.createRun(createTaskInput());
      await store.persistIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');
      await store.persistIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');

      const filePath = await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'idempotency');
      const tokens = JSON.parse(await fs.readFile(filePath, 'utf8'));
      expect(tokens).toEqual(['proc:run:step-1']);
    });

    it('survives store reconstruction (durable across restarts)', async () => {
      const run = await store.createRun(createTaskInput());
      await store.persistIdempotencyToken(run.agentic_session_id, 'proc:run:step-1');

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();

      const result = await freshStore.hasIdempotencyToken(
        run.agentic_session_id,
        'proc:run:step-1',
      );
      expect(result).toBe(true);
    });
  });

  describe('addTouchedFiles / getTouchedFiles', () => {
    it('returns empty array for a run with no touched-files sidecar', async () => {
      const run = await store.createRun(createTaskInput());
      const files = await store.getTouchedFiles(run.agentic_session_id);
      expect(files).toEqual([]);
    });

    it('persists file paths', async () => {
      const run = await store.createRun(createTaskInput());
      await store.addTouchedFiles(run.agentic_session_id, ['/src/foo.ts', '/src/bar.ts']);
      const files = await store.getTouchedFiles(run.agentic_session_id);
      expect(files).toEqual(['/src/foo.ts', '/src/bar.ts']);
    });

    it('accumulates paths across multiple calls', async () => {
      const run = await store.createRun(createTaskInput());
      await store.addTouchedFiles(run.agentic_session_id, ['/src/foo.ts']);
      await store.addTouchedFiles(run.agentic_session_id, ['/src/bar.ts']);
      const files = await store.getTouchedFiles(run.agentic_session_id);
      expect(files).toContain('/src/foo.ts');
      expect(files).toContain('/src/bar.ts');
      expect(files).toHaveLength(2);
    });

    it('deduplicates paths', async () => {
      const run = await store.createRun(createTaskInput());
      await store.addTouchedFiles(run.agentic_session_id, ['/src/foo.ts', '/src/bar.ts']);
      await store.addTouchedFiles(run.agentic_session_id, ['/src/foo.ts']);
      const files = await store.getTouchedFiles(run.agentic_session_id);
      expect(files).toHaveLength(2);
    });

    it('is a no-op when called with an empty array', async () => {
      const run = await store.createRun(createTaskInput());
      await store.addTouchedFiles(run.agentic_session_id, []);
      const files = await store.getTouchedFiles(run.agentic_session_id);
      expect(files).toEqual([]);
    });

    it('serializes concurrent writes without dropping paths', async () => {
      const run = await store.createRun(createTaskInput());
      await Promise.all([
        store.addTouchedFiles(run.agentic_session_id, ['/src/a.ts']),
        store.addTouchedFiles(run.agentic_session_id, ['/src/b.ts']),
        store.addTouchedFiles(run.agentic_session_id, ['/src/c.ts']),
      ]);
      const files = await store.getTouchedFiles(run.agentic_session_id);
      expect(files).toHaveLength(3);
      expect(files).toContain('/src/a.ts');
      expect(files).toContain('/src/b.ts');
      expect(files).toContain('/src/c.ts');
    });
  });

  describe('canonical file-change facts', () => {
    const makeFact = (
      runId: string,
      factId: string,
      repoRelativePath: string,
    ): CanonicalFileChangeFact => ({
      factId,
      runId,
      turnId: 'turn-1',
      provider: 'claude',
      providerSessionId: 'provider-1',
      providerThreadId: null,
      providerTurnId: null,
      serviceId: 'svc-1',
      repoRelativePath,
      occurredAt: '2026-01-01T00:00:00.000Z',
      evidence: {
        kind: 'baseline',
        diff: `diff ${repoRelativePath}`,
        baselineContent: null,
        postContent: repoRelativePath,
      },
    });

    it('serializes concurrent appends and survives store reconstruction', async () => {
      const run = await store.createRun(createTaskInput({ agentic_session_id: 'facts-run' }));
      await Promise.all([
        store.appendFileChangeFacts(run.agentic_session_id, [
          makeFact(run.agentic_session_id, 'fact-a', 'src/a.ts'),
        ]),
        store.appendFileChangeFacts(run.agentic_session_id, [
          makeFact(run.agentic_session_id, 'fact-b', 'src/b.ts'),
        ]),
      ]);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const facts = await freshStore.getFileChangeFacts(run.agentic_session_id);
      expect(facts.map((fact) => fact.factId).sort()).toEqual(['fact-a', 'fact-b']);
      expect((await freshStore.getTouchedFiles(run.agentic_session_id)).sort()).toEqual([
        '/tmp/repo/src/a.ts',
        '/tmp/repo/src/b.ts',
      ]);
    });

    it('uses the legacy sidecar only until canonical facts exist', async () => {
      const run = await store.createRun(createTaskInput({ agentic_session_id: 'legacy-run' }));
      await store.addTouchedFiles(run.agentic_session_id, ['/tmp/repo/src/legacy.ts']);
      expect(await store.getTouchedFiles(run.agentic_session_id)).toEqual([
        '/tmp/repo/src/legacy.ts',
      ]);

      await store.appendFileChangeFacts(run.agentic_session_id, [
        makeFact(run.agentic_session_id, 'fact-new', 'src/new.ts'),
      ]);
      expect(await store.getTouchedFiles(run.agentic_session_id)).toEqual(['/tmp/repo/src/new.ts']);
    });
  });

  describe('changed-files diagnostics', () => {
    it('serializes concurrent records and keeps them with the Run across reconstruction', async () => {
      const run = await store.createRun(createTaskInput({ agentic_session_id: 'diagnostic-run' }));
      await Promise.all([
        store.appendChangedFilesDiagnostic(
          run.agentic_session_id,
          makeChangedFilesDiagnostic(run.agentic_session_id, 'request-a'),
        ),
        store.appendChangedFilesDiagnostic(
          run.agentic_session_id,
          makeChangedFilesDiagnostic(run.agentic_session_id, 'request-b'),
        ),
      ]);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const diagnostics = await freshStore.getChangedFilesDiagnostics(run.agentic_session_id);

      expect(diagnostics.map((entry) => entry.requestId).sort()).toEqual([
        'request-a',
        'request-b',
      ]);
      expect(diagnostics[0]?.membership.paths).toEqual([
        { serviceId: 'svc-1', repoRelativePath: 'src/example.ts' },
      ]);
    });
  });

  describe('Review file-scope approval state', () => {
    it('persists pending presentation and interrupted Review input across reconstruction', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'review-file-scope-run' }),
      );
      const request = {
        id: 'request-1',
        runId: run.agentic_session_id,
        sessionId: 'agent-session-1',
        agentId: 'code_review',
        agentType: 'claude' as const,
        timestamp: '2026-08-14T00:00:00.000Z',
        idempotencyToken: 'idempotency-1',
        files: [
          {
            serviceId: 'svc-1',
            filePath: 'src/additional.ts',
            reason: 'Required repair.',
          },
        ] as unknown as Set<{
          serviceId: string;
          filePath: string;
          reason: string;
        }>,
      };
      await store.updateRunReviewFileScopeRequestPresentations(run.agentic_session_id, [
        { request, messageId: 'message-1' },
      ]);
      await store.updateRunReviewFileScopeContinuation(run.agentic_session_id, {
        input: {
          promptType: 'code_review',
          payload: { userMessage: 'Focus on lifecycle recovery.' },
          references: { resolved: [], unresolved: [] },
          triggerContext: null,
        },
      });

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const rehydrated = await freshStore.getRun(run.agentic_session_id);

      expect(rehydrated?.reviewFileScopeRequestPresentations).toEqual([
        {
          request: {
            ...request,
            files: [
              {
                serviceId: 'svc-1',
                filePath: 'src/additional.ts',
                reason: 'Required repair.',
              },
            ],
          },
          messageId: 'message-1',
        },
      ]);
      expect(rehydrated?.reviewFileScopeContinuation?.input).toMatchObject({
        promptType: 'code_review',
        payload: { userMessage: 'Focus on lifecycle recovery.' },
      });
    });

    it('retains original evidence and reconciliation disposition across restart', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'review-service-recovery-run' }),
      );
      const request = {
        id: 'request-1',
        runId: run.agentic_session_id,
        sessionId: 'agent-session-1',
        agentId: 'code_review',
        agentType: 'claude' as const,
        timestamp: '2026-10-09T00:00:00.000Z',
        idempotencyToken: 'token-1',
        files: new Set([{ serviceId: 'svc-1', filePath: 'new.ts', reason: 'Required repair.' }]),
      };
      await store.updateRunReviewFileScopeRequestPresentations(run.agentic_session_id, [
        { request, messageId: 'message-1', closed: true },
      ]);
      const reconciliations = [
        {
          requestId: request.id,
          stableKey: 'review-service-recovery:original-review',
          turnId: 'original-review',
          disposition: 'continue' as const,
          userId: 'user-1',
          delivered: false,
          input: { userMessage: 'Focus.' },
        },
      ];
      await store.updateRunReviewFileScopeReconciliations(run.agentic_session_id, reconciliations);
      const rehydrated = await store.getRun(run.agentic_session_id);
      expect(rehydrated?.reviewFileScopeRequestPresentations?.[0]).toMatchObject({
        request: { id: request.id, idempotencyToken: request.idempotencyToken },
        closed: true,
      });
      expect(rehydrated?.reviewFileScopeReconciliations).toEqual(reconciliations);
    });
  });

  describe('updateRunTokenUsage', () => {
    it('initializes token usage from zero', async () => {
      const run = await store.createRun(createTaskInput());
      const updated = await store.updateRunTokenUsage(run.agentic_session_id, {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 20,
      });
      expect(updated.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 20,
        cacheAvailability: 'unsupported',
      });
    });

    it('accumulates token usage across calls', async () => {
      const run = await store.createRun(createTaskInput());
      await store.updateRunTokenUsage(run.agentic_session_id, {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 20,
      });
      const updated = await store.updateRunTokenUsage(run.agentic_session_id, {
        inputTokens: 200,
        outputTokens: 75,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 40,
      });
      expect(updated.tokenUsage).toEqual({
        inputTokens: 300,
        outputTokens: 125,
        cacheCreationInputTokens: 40,
        cacheReadInputTokens: 60,
        cacheAvailability: 'unsupported',
      });
    });

    it('persists token usage to disk', async () => {
      const run = await store.createRun(createTaskInput());
      await store.updateRunTokenUsage(run.agentic_session_id, {
        inputTokens: 500,
        outputTokens: 200,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 150,
      });
      const reloaded = await store.getRun(run.agentic_session_id);
      expect(reloaded!.tokenUsage).toEqual({
        inputTokens: 500,
        outputTokens: 200,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 150,
        cacheAvailability: 'unsupported',
      });
    });

    it('throws for unknown run', async () => {
      await expect(
        store.updateRunTokenUsage('nonexistent', { inputTokens: 1, outputTokens: 1 }),
      ).rejects.toThrow(/Unknown/);
    });
  });

  describe('promptType persistence', () => {
    it('persists promptType to disk when provided', async () => {
      const run = await store.createRun(createTaskInput({ promptType: 'daily_session' }));
      expect(run.promptType).toBe('daily_session');

      const onDisk = await fs.readFile(
        await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'metadata'),
        'utf8',
      );
      const parsed = JSON.parse(onDisk);
      expect(parsed.promptType).toBe('daily_session');
    });

    it('omits promptType when not provided', async () => {
      const run = await store.createRun(createTaskInput());
      expect(run.promptType).toBeUndefined();

      const onDisk = await fs.readFile(
        await runFamilyMemberPath(tempRoot, run.agentic_session_id, 'metadata'),
        'utf8',
      );
      const parsed = JSON.parse(onDisk);
      expect(parsed.promptType).toBeUndefined();
    });

    it('survives store reconstruction', async () => {
      const run = await store.createRun(createTaskInput({ promptType: 'daily_session' }));

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();

      const reloaded = await freshStore.getRun(run.agentic_session_id);
      expect(reloaded!.promptType).toBe('daily_session');
    });
  });

  describe('updateRunPreviousProviderSession', () => {
    it('round-trips a summary through write → read → clear', async () => {
      const run = await store.createRun(createTaskInput());
      expect(run.previousProviderSession).toBeUndefined();

      const summary = {
        promptType: 'startup_session',
        lastMessage: '## Plan\n\n- Step 1',
        completedAt: '2026-04-26T12:00:00.000Z',
      };

      const afterWrite = await store.updateRunPreviousProviderSession(
        run.agentic_session_id,
        summary,
      );
      expect(afterWrite.previousProviderSession).toEqual(summary);

      const reloaded = await store.getRun(run.agentic_session_id);
      expect(reloaded!.previousProviderSession).toEqual(summary);

      const afterClear = await store.updateRunPreviousProviderSession(run.agentic_session_id, null);
      expect(afterClear.previousProviderSession).toBeNull();

      const reloadedCleared = await store.getRun(run.agentic_session_id);
      expect(reloadedCleared!.previousProviderSession).toBeNull();
    });

    it('throws for an unknown run id', async () => {
      await expect(store.updateRunPreviousProviderSession('does-not-exist', null)).rejects.toThrow(
        /Unknown agentic session/,
      );
    });
  });

  describe('appendRunMemo', () => {
    it('accumulates memos in order and survives a fresh store load', async () => {
      const run = await store.createRun(createTaskInput());
      expect(run.memos).toBeUndefined();

      const first = {
        source: 'project_assistant',
        content: 'frame body one',
        writtenAt: '2026-04-26T12:00:00.000Z',
      };
      const second = {
        source: 'coding_freeform',
        content: 'frame body two',
        writtenAt: '2026-04-26T13:00:00.000Z',
      };

      const afterFirst = await store.appendRunMemo(run.agentic_session_id, first);
      expect(afterFirst.memos).toEqual([first]);

      const afterSecond = await store.appendRunMemo(run.agentic_session_id, second);
      expect(afterSecond.memos).toEqual([first, second]);

      // Rehydrate from disk through a fresh store instance.
      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const reloaded = await freshStore.getRun(run.agentic_session_id);
      expect(reloaded!.memos).toEqual([first, second]);
    });

    it('throws for an unknown run id', async () => {
      await expect(
        store.appendRunMemo('does-not-exist', {
          source: 'project_assistant',
          content: 'x',
          writtenAt: '2026-04-26T12:00:00.000Z',
        }),
      ).rejects.toThrow(/Unknown agentic session/);
    });
  });

  describe('appendRunGatherTrace', () => {
    const traceFor = (runId: string, turnId: string): Omit<GatherTrace, 'round'> => ({
      runId,
      turnId,
      focal: { id: 'f', type: 'task', title: 'Focal' },
      ask: 'Do it',
      caps: { maxSearches: 8, maxResultsPerSearch: 25, hops: [{ max: 8, minScore: 0 }] },
      steps: [],
      expansionFailures: [],
      returned: [],
    });

    it('numbers rounds per turn and survives a fresh store load', async () => {
      const run = await store.createRun(createTaskInput());
      const id = run.agentic_session_id;

      const first = await store.appendRunGatherTrace(id, traceFor(id, 'turn-1'));
      const second = await store.appendRunGatherTrace(id, traceFor(id, 'turn-1'));
      const other = await store.appendRunGatherTrace(id, traceFor(id, 'turn-2'));
      expect([first.round, second.round, other.round]).toEqual([1, 2, 1]);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();
      const reloaded = await freshStore.getRun(id);
      expect(reloaded!.gatherTraces).toEqual([first, second, other]);
    });

    it('throws for an unknown run id', async () => {
      await expect(
        store.appendRunGatherTrace('does-not-exist', traceFor('does-not-exist', 'turn-1')),
      ).rejects.toThrow(/Unknown agentic session/);
    });
  });

  describe('updateRunProjectAssistantDone', () => {
    it('persists the flag and survives a fresh store load', async () => {
      const run = await store.createRun(createTaskInput());
      expect(run.projectAssistantDone).toBeUndefined();

      const afterWrite = await store.updateRunProjectAssistantDone(run.agentic_session_id, true);
      expect(afterWrite.projectAssistantDone).toBe(true);

      const reloaded = await store.getRun(run.agentic_session_id);
      expect(reloaded!.projectAssistantDone).toBe(true);
    });

    it('throws for an unknown run id', async () => {
      await expect(store.updateRunProjectAssistantDone('does-not-exist', true)).rejects.toThrow(
        /Unknown agentic session/,
      );
    });
  });

  describe('recordRunStartedPromptType', () => {
    it('persists each started prompt type once, in start order, across a fresh load', async () => {
      const run = await store.createRun(createTaskInput());
      expect(run.startedPromptTypes).toBeUndefined();

      await store.recordRunStartedPromptType(run.agentic_session_id, 'feature_sync_analyze');
      await store.recordRunStartedPromptType(run.agentic_session_id, 'coding_plan');
      const again = await store.recordRunStartedPromptType(
        run.agentic_session_id,
        'feature_sync_analyze',
      );
      expect(again.startedPromptTypes).toEqual(['feature_sync_analyze', 'coding_plan']);

      const reloaded = await store.getRun(run.agentic_session_id);
      expect(reloaded?.startedPromptTypes).toEqual(['feature_sync_analyze', 'coding_plan']);
    });

    it('throws for an unknown run id', async () => {
      await expect(
        store.recordRunStartedPromptType('does-not-exist', 'coding_plan'),
      ).rejects.toThrow(/Unknown agentic session/);
    });
  });

  describe('findRunsByPromptType', () => {
    it('returns matching runs', async () => {
      await store.createRun(
        createTaskInput({ agentic_session_id: 'run-daily', promptType: 'daily_session' }),
      );
      await store.createRun(
        createTaskInput({
          agentic_session_id: 'run-other',
          provider_session_id: 'prov-2',
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: 'org-1',
            projectId: 'proj-1',
            agentSessionId: 'agent-session-2',
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        }),
      );

      const results = await store.findRunsByPromptType('daily_session');
      expect(results).toHaveLength(1);
      expect(results[0]!.agentic_session_id).toBe('run-daily');
    });

    it('returns empty array when no runs match', async () => {
      await store.createRun(createTaskInput());
      const results = await store.findRunsByPromptType('daily_session');
      expect(results).toEqual([]);
    });

    it('returns multiple runs of the same prompt type', async () => {
      await store.createRun(
        createTaskInput({ agentic_session_id: 'run-1', promptType: 'daily_session' }),
      );
      await store.createRun(
        createTaskInput({
          agentic_session_id: 'run-2',
          provider_session_id: 'prov-2',
          promptType: 'daily_session',
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: 'org-1',
            projectId: 'proj-1',
            agentSessionId: 'agent-session-2',
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        }),
      );

      const results = await store.findRunsByPromptType('daily_session');
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.agentic_session_id).sort();
      expect(ids).toEqual(['run-1', 'run-2']);
    });

    it('works after store reconstruction', async () => {
      await store.createRun(
        createTaskInput({ agentic_session_id: 'run-daily', promptType: 'daily_session' }),
      );

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();

      const results = await freshStore.findRunsByPromptType('daily_session');
      expect(results).toHaveLength(1);
      expect(results[0]!.agentic_session_id).toBe('run-daily');
    });

    it('rehydrates a durable pending Service-scope checkpoint after reconstruction', async () => {
      const run = await store.createRun(
        createTaskInput({ agentic_session_id: 'service-scope-checkpoint-run' }),
      );
      const continuation = {
        input: {
          promptType: LocalPromptType.CodingFreeform,
          payload: {
            promptType: LocalPromptType.CodingFreeform,
            userMessage: 'continue implementation',
          },
          references: { resolved: [], unresolved: [] },
          triggerContext: null,
        },
        checkpoint: {
          completedActions: ['Validated the requested Service union.'],
          discoveries: [],
          toolResults: [],
          changedFiles: [],
          nextAction: 'Apply the approved roots.',
        },
        delivery: 'pending' as const,
        interruptedTurnId: 'turn-1',
        capturedAt: '2026-08-31T00:00:00.000Z',
      };
      await store.updateRunServiceScopeContinuation(run.agentic_session_id, continuation);

      const freshStore = new RunStore({ paths: createTempPaths(tempRoot) });
      await freshStore.initialize();

      expect((await freshStore.getRun(run.agentic_session_id))?.serviceScopeContinuation).toEqual(
        continuation,
      );
    });
  });
});
