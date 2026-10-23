import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RunFileContextReader } from './run-file-context-reader';
import { RunStore } from '../run-store/run-store';
import { parsePersistedRunFamilyManifest } from '../run-store/run-family';
import { legacyRunFamilyMemberFileName, RUN_FAMILY_MEMBERS } from '../run-store/run-files';
import {
  CliReadErrorCode,
  CliReadChangedFileDetailStatusEnum,
  CliReadChangedFileInventoryEntryStatusEnum,
  type CliReadChangedFileDetail,
  type CliReadProviderUsageResult,
  type CliReadRuntimeModelCatalogResult,
} from '../shared/agent-bridge-contract/generated/api';
import { RepoMappingStore } from '../repo';
import type { Run } from '../run/run';
import type { RunChangedFilesDiagnosticEntry } from '../run-store/changed-files-diagnostics';
import { createTestRun as createBaseTestRun, createTestRunStore } from '../run/run.test-support';
import { createTestRunRegistryWiring } from './__tests__/helpers/test-run-registry';
import { CliReadHandler } from './cli-read-handler';
import { NOOP_LOGGER, type ServerLogger } from './logger';
import { RunChangedFilesContextError, RunChangedFilesReader } from './run-changed-files';
import { RunReadPreparationError, RunReadRestoreCoordinator } from './restore-persisted-runs';
import { createTestTriggerVerificationRuntime } from './trigger-verification/test-owners.test-support';
import type { VerifiedCliReadFrame, VerifyCliReadResult } from './trigger-verification/verify';
import type { HostActionAdmission } from './controller-authorization/host-action-admission';
import { PROTECTED_CLI_READ_OPERATIONS } from './trigger-verification/protocol-v2';
import type { ControllerAuthorizationDenialReason } from './controller-authorization/types';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import { guardCliReadResponse } from './cli-read-response-size-guard';
import type { SessionActivitySource, SessionToolEntry } from './session-activity-source';
import type { Turn } from '../turn/turn';

const requestId = '11111111-1111-4111-8111-111111111111';
const createTestRun = (...args: Parameters<typeof createBaseTestRun>): Run => {
  const run = createBaseTestRun(...args);
  run.refreshSessionFields({
    contextMetadata: { ...run.session.contextMetadata, agentSessionId: run.runId },
  });
  return run;
};
const runId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';
const serviceId = '66666666-6666-4666-8666-666666666666';
const machineId = '77777777-7777-4777-8777-777777777777';
const userId = '88888888-8888-4888-8888-888888888888';
const nonce = '99999999-9999-4999-8999-999999999999';
const agentSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const verifiedRead = (
  body: VerifiedCliReadFrame['body'],
  frame: VerifiedCliReadFrame['frame'] = {
    organizationId,
    projectId,
    conversationId,
  },
): VerifyCliReadResult => ({
  ok: true,
  verified: {
    body,
    frame,
    envelope: {
      machineId,
      userId,
      nonce,
      timestampMs: 1,
      signature: 'signature',
      protocolVersion: 2,
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      event: body,
    },
  },
});

const verified = verifiedRead({
  requestId,
  agentSessionId,
  operation: 'run.changed_files.count',
  runId,
});

const readBodiesByOperation = {
  'workspace.skills.list': {
    requestId,
    operation: 'workspace.skills.list',
    organizationId,
    projectId,
    machineId,
    authorizationRequestId: requestId,
    provider: 'codex',
    catalogContext: { policy: 'non_repository' },
  },
  'run.changed_files.count': {
    requestId,
    agentSessionId,
    operation: 'run.changed_files.count',
    runId,
  },
  'run.changed_files.inventory': {
    requestId,
    agentSessionId,
    operation: 'run.changed_files.inventory',
    runId,
  },
  'run.changed_files.detail': {
    requestId,
    agentSessionId,
    operation: 'run.changed_files.detail',
    runId,
    file: { serviceId, repoPath: '/tmp/repository', filePath: 'src/example.ts' },
  },
  'run.context_usage.get': {
    requestId,
    agentSessionId,
    operation: 'run.context_usage.get',
    runId,
  },
  'run.skills.list': {
    requestId,
    agentSessionId,
    operation: 'run.skills.list',
    runId,
  },
  'run.tool_calls.latest_turn': {
    requestId,
    agentSessionId,
    operation: 'run.tool_calls.latest_turn',
    runId,
  },
  'project.session_costs.list': {
    requestId,
    agentSessionId,
    operation: 'project.session_costs.list',
    projectId,
    limit: 25,
  },
  'provider.usage.get': {
    requestId,
    agentSessionId,
    operation: 'provider.usage.get',
  },
  'runtime.model_catalog.get': {
    requestId,
    operation: 'runtime.model_catalog.get',
    organizationId,
    projectId,
    machineId,
    authorizationRequestId: requestId,
  },
} satisfies Record<VerifiedCliReadFrame['body']['operation'], VerifiedCliReadFrame['body']>;

const denialCases = [
  ['unresolved', 'AUTHORIZATION_NOT_FOUND'],
  ['denied', 'SIGNATURE_INVALID'],
  ['expired', 'AUTHORIZATION_EXPIRED'],
  ['revoked', 'MACHINE_REVOKED'],
  ['mismatched', 'TARGET_MISMATCH'],
  ['widened', 'GRANT_SCOPE_MISMATCH'],
  ['unknown', 'SCHEMA_INVALID'],
  ['stale prior authority', 'GRANT_NOT_ACTIVE'],
] as const satisfies readonly (readonly [string, ControllerAuthorizationDenialReason])[];

const createSubject = (
  restore: (requestedRunId: string) => Promise<Run>,
  verification: VerifyCliReadResult = verified,
  listProjectSessionCosts = vi.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
    sourceAvailability: 'unavailable',
    costReadAt: '2026-07-27T00:00:00.000Z',
  }),
  changedFileDetails: CliReadChangedFileDetail[] = [],
  observeDiagnostic?: (entry: RunChangedFilesDiagnosticEntry) => void,
  readRunContextUsage = vi.fn().mockRejectedValue(new Error('not configured')),
  hostActionAdmission: Pick<HostActionAdmission, 'admit'> | null = {
    admit: vi.fn().mockResolvedValue({
      admitted: true,
      authorizationId: 'authorization-1',
      grantId: 'grant-1',
    }),
  },
  listRunSkills = vi.fn().mockResolvedValue({
    provider: 'codex' as const,
    skills: [],
    errors: [],
  }),
  subjectOptions: {
    logger?: ServerLogger;
    changedFilesError?: Error;
    readProviderUsage?: () => Promise<CliReadProviderUsageResult>;
    readRuntimeModelCatalog?: () => Promise<CliReadRuntimeModelCatalogResult>;
    sessionActivity?: Pick<SessionActivitySource, 'snapshot'>;
    isRemoteToolCallViewingEnabled?: () => Promise<boolean>;
  } = {},
): CliReadHandler => {
  const runStore = createTestRunStore();
  const runRegistry = createTestRunRegistryWiring({ runStore }).runRegistry;
  const triggerVerificationRuntime = createTestTriggerVerificationRuntime({
    runStore,
    runRegistry,
  });
  const repoStore = new RepoMappingStore();
  vi.spyOn(repoStore, 'getBinding').mockResolvedValue(null);
  const runChangedFilesReader = new RunChangedFilesReader(repoStore);
  vi.spyOn(triggerVerificationRuntime, 'verifyCliReadFrame').mockReturnValue(verification);
  vi.spyOn(RunReadRestoreCoordinator.prototype, 'restore').mockImplementation(restore);
  vi.spyOn(RunReadRestoreCoordinator.prototype, 'restoreForContextUsage').mockImplementation(
    restore,
  );
  vi.spyOn(RunFileContextReader.prototype, 'read').mockImplementation(restore);
  const changedFilesInventory = vi
    .spyOn(runChangedFilesReader, 'getLiveRunChangedFilesInventory')
    .mockResolvedValue(
      changedFileDetails.map(({ serviceId: changedServiceId, repoPath, filePath }) => ({
        serviceId: changedServiceId,
        repoPath,
        filePath,
        status: CliReadChangedFileInventoryEntryStatusEnum.Modify,
      })),
    );
  if (subjectOptions.changedFilesError) {
    changedFilesInventory.mockRejectedValue(subjectOptions.changedFilesError);
  }
  vi.spyOn(runChangedFilesReader, 'getLiveRunChangedFileDetail').mockImplementation(
    async (_run, _fileChanges, requestedFile) => {
      const detail = changedFileDetails.find(
        (entry) =>
          entry.serviceId === requestedFile.serviceId &&
          entry.repoPath === requestedFile.repoPath &&
          entry.filePath === requestedFile.filePath,
      );
      if (!detail) {
        throw new Error('Changed-file detail fixture is not configured.');
      }
      return detail;
    },
  );
  vi.spyOn(runStore, 'appendChangedFilesDiagnostic').mockImplementation((_runId, entry) => {
    observeDiagnostic?.(entry);
    return Promise.resolve();
  });
  return new CliReadHandler({
    triggerVerificationRuntime,
    runStore,
    runRegistry,
    runChangedFilesReader,
    agentService: {
      listProjectSessionCosts,
      readRunContextUsage,
      listRunSkills,
      readRuntimeModelCatalog:
        subjectOptions.readRuntimeModelCatalog ?? vi.fn().mockResolvedValue({ providers: [] }),
      readProviderUsage:
        subjectOptions.readProviderUsage ??
        vi.fn().mockResolvedValue({
          providers: [
            {
              provider: 'claude',
              status: 'unreported',
              observedAt: null,
              fiveHour: null,
              weekly: null,
            },
            {
              provider: 'codex',
              status: 'unreported',
              observedAt: null,
              fiveHour: null,
              weekly: null,
            },
            {
              provider: 'opencode',
              status: 'unreported',
              observedAt: null,
              fiveHour: null,
              weekly: null,
            },
          ],
        }),
      listWorkspaceSkills: vi.fn().mockResolvedValue({
        requestId,
        operation: 'workspace.skills.list',
        status: 'success',
        result: { provider: 'codex', skills: [], errors: [] },
      }),
    },
    sessionActivity: subjectOptions.sessionActivity ?? { snapshot: vi.fn() },
    isRemoteToolCallViewingEnabled:
      subjectOptions.isRemoteToolCallViewingEnabled ?? vi.fn().mockResolvedValue(true),
    logger: subjectOptions.logger ?? NOOP_LOGGER,
    ...(hostActionAdmission
      ? { hostActionAdmission: hostActionAdmission as HostActionAdmission }
      : {}),
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CliReadHandler', () => {
  it.each(['legacy', 'version-1', 'current'] as const)(
    'reads bounded live file data with corrupt %s event history and preserves source authority',
    async (format) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'changed-files-corrupt-events-'));
      try {
        const repoPath = path.join(root, 'repo');
        await fs.mkdir(repoPath);
        const git = async (...args: string[]) =>
          promisify(execFile)('git', args, { cwd: repoPath });
        await git('init');
        await git('config', 'user.email', 'test@example.com');
        await git('config', 'user.name', 'Test');
        await fs.writeFile(path.join(repoPath, 'owned.ts'), 'before\n');
        await git('add', '.');
        await git('commit', '-m', 'initial');
        await fs.writeFile(path.join(repoPath, 'owned.ts'), 'after\n');
        await fs.writeFile(path.join(repoPath, 'unrelated.ts'), 'unrelated\n');
        const paths = {
          baseDir: root,
          runsDir: path.join(root, 'runs'),
          indexPath: path.join(root, 'runs', 'run-index.json'),
          preferencesPath: path.join(root, 'preferences.json'),
        };
        const writer = new RunStore({ paths });
        await writer.initialize();
        await writer.createRun({
          entity: null,
          agentic_session_id: runId,
          provider: 'codex',
          provider_session_id: 'provider-1',
          services: [{ id: serviceId, path: repoPath }],
          launchServiceId: serviceId,
          conversationId,
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId,
            projectId,
            agentSessionId: runId,
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        });
        await writer.appendFileChangeFacts(runId, [
          {
            factId: 'owned',
            runId,
            turnId: 'turn-1',
            provider: 'codex',
            providerSessionId: 'provider-1',
            providerThreadId: null,
            providerTurnId: null,
            serviceId,
            repoRelativePath: 'owned.ts',
            occurredAt: new Date().toISOString(),
            evidence: {
              kind: 'baseline',
              diff: '',
              baselineContent: 'before\n',
              postContent: 'after\n',
            },
          },
        ]);
        const manifestPath = path.join(paths.runsDir, `${runId}.family.json`);
        const manifest = parsePersistedRunFamilyManifest(
          runId,
          await fs.readFile(manifestPath, 'utf8'),
        );
        const event = {
          schema_version: 1,
          seq: 1,
          ts: new Date().toISOString(),
          app_session_id: runId,
          run_id: runId,
          actor: 'app',
          event_type: 'run_started',
          state_version: 1,
          payload: {
            kind: 'run_started',
            mode: 'prompt',
            prompt: 'test',
            adapterId: 'codex',
            repositoryPath: repoPath,
            provider: 'codex',
            providerSessionId: 'provider-1',
            providerConversationId: null,
            providerSessionAgentId: null,
            observedAt: new Date().toISOString(),
          },
        };
        const eventBytes = `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`;
        await fs.writeFile(
          path.join(paths.runsDir, manifest.members.events.relativePath),
          eventBytes,
        );
        if (format === 'legacy') {
          for (const member of RUN_FAMILY_MEMBERS) {
            const source = path.join(paths.runsDir, manifest.members[member].relativePath);
            try {
              await fs.copyFile(
                source,
                path.join(paths.runsDir, legacyRunFamilyMemberFileName(runId, member)),
              );
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
          await fs.unlink(manifestPath);
        } else if (format === 'version-1') {
          manifest.schemaVersion = 1;
          for (const member of RUN_FAMILY_MEMBERS) manifest.members[member].schemaVersion = 1;
          await fs.writeFile(manifestPath, JSON.stringify(manifest));
        }
        const sourceFiles = (await fs.readdir(paths.runsDir, { recursive: true })).map((entry) =>
          path.join(paths.runsDir, entry),
        );
        const sourceBytes = new Map<string, Buffer>();
        for (const file of sourceFiles) {
          if ((await fs.stat(file)).isFile()) sourceBytes.set(file, await fs.readFile(file));
        }
        const runStore = new RunStore({ paths });
        await runStore.initialize();
        const wiring = createTestRunRegistryWiring({ runStore });
        const triggerVerificationRuntime = createTestTriggerVerificationRuntime({
          runStore,
          runRegistry: wiring.runRegistry,
        });
        const verify = vi.spyOn(triggerVerificationRuntime, 'verifyCliReadFrame');
        const repoStore = new RepoMappingStore();
        vi.spyOn(repoStore, 'getBinding').mockResolvedValue(null);
        const handler = new CliReadHandler({
          runStore,
          runRegistry: wiring.runRegistry,
          triggerVerificationRuntime,
          runChangedFilesReader: new RunChangedFilesReader(repoStore),
          sessionActivity: { snapshot: vi.fn() },
          isRemoteToolCallViewingEnabled: vi.fn().mockResolvedValue(true),
          logger: NOOP_LOGGER,
          agentService: {
            listProjectSessionCosts: vi.fn(),
            readProviderUsage: vi.fn(),
            readRuntimeModelCatalog: vi.fn(),
            readRunContextUsage: vi.fn(),
            listRunSkills: vi.fn(),
            listWorkspaceSkills: vi.fn(),
          },
          hostActionAdmission: {
            admit: vi.fn().mockResolvedValue({ admitted: true }),
          } as unknown as HostActionAdmission,
        });
        const eventRead = vi.spyOn(fs, 'readFile');
        for (const operation of [
          'run.changed_files.count',
          'run.changed_files.inventory',
          'run.changed_files.detail',
        ] as const) {
          verify.mockReturnValue(
            verifiedRead({
              requestId,
              agentSessionId: runId,
              runId,
              operation,
              ...(operation === 'run.changed_files.detail'
                ? { file: { serviceId, repoPath, filePath: 'owned.ts' } }
                : {}),
            } as VerifiedCliReadFrame['body']),
          );
          const response = await handler.handle({});
          expect(response).toMatchObject({ status: 'success', operation });
          if (response?.operation === 'run.changed_files.count' && response.status === 'success') {
            expect(response.result.changedFilesCount).toBe(1);
          }
          if (
            response?.operation === 'run.changed_files.inventory' &&
            response.status === 'success'
          ) {
            expect(JSON.stringify(response.result)).not.toContain('after');
            expect(JSON.stringify(response.result)).not.toContain('unrelated.ts');
          }
          if (response?.operation === 'run.changed_files.detail' && response.status === 'success') {
            expect(response.result.file).toMatchObject({
              preContent: 'before\n',
              postContent: 'after\n',
            });
          }
        }
        verify.mockReturnValue(
          verifiedRead({
            requestId,
            agentSessionId: runId,
            runId,
            operation: 'run.changed_files.detail',
            file: { serviceId, repoPath, filePath: 'unrelated.ts' },
          }),
        );
        await expect(handler.handle({})).resolves.toMatchObject({
          status: 'error',
          error: { code: 'INVALID_FILE_MEMBERSHIP' },
        });
        expect(
          eventRead.mock.calls.some(([file]) => /events\.(data|jsonl)$/.test(String(file))),
        ).toBe(false);
        expect(wiring.runRegistry.get(runId)).toBeNull();
        eventRead.mockRestore();
        await expect(runStore.readDurableRunEvents(runId)).rejects.toMatchObject({
          diagnostic: {
            member: 'events',
            reason: format === 'current' ? 'production_codec_rejected' : 'migration_failed',
            errorMessage: expect.stringContaining('sequence is not contiguous'),
          },
        });
        await expect(runStore.getRun(runId)).rejects.toMatchObject({
          diagnostic: { member: 'events' },
        });
        await expect(runStore.getFileChangeFacts(runId)).resolves.toHaveLength(1);
        for (const [file, bytes] of sourceBytes) expect(await fs.readFile(file)).toEqual(bytes);
        if (format === 'legacy')
          await expect(fs.access(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
        const factsPath = path.join(
          paths.runsDir,
          format === 'legacy'
            ? legacyRunFamilyMemberFileName(runId, 'fileChangeFacts')
            : manifest.members.fileChangeFacts.relativePath,
        );
        await fs.writeFile(factsPath, '{invalid');
        verify.mockReturnValue(
          verifiedRead({
            requestId,
            agentSessionId: runId,
            runId,
            operation: 'run.changed_files.count',
          }),
        );
        await expect(handler.handle({})).resolves.toMatchObject({
          status: 'error',
          error: { code: 'READ_FAILED', message: expect.stringContaining('fileChangeFacts') },
        });
        expect(await fs.readFile(factsPath, 'utf8')).toBe('{invalid');
        await wiring.runRegistry.dispose();
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
  it('returns a correlated changed-file count without starting a Run turn', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    vi.spyOn(restoredRun, 'getFileChangeProjection').mockReturnValue([]);
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const diagnostics: RunChangedFilesDiagnosticEntry[] = [];

    await expect(
      createSubject(restore, verified, undefined, [], (entry) => diagnostics.push(entry)).handle(
        {},
      ),
    ).resolves.toEqual({
      requestId,
      operation: 'run.changed_files.count',
      status: 'success',
      result: { runId, changedFilesCount: 0 },
    });
    expect(restore).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ onPhase: expect.any(Function) }),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.requestId).toBe(requestId);
    expect(diagnostics[0]?.requestAgentSessionId).toBe(agentSessionId);
    expect(diagnostics[0]?.runId).toBe(runId);
    expect(diagnostics[0]?.membership.projectionCount).toBe(0);
    expect(diagnostics[0]?.membership.paths).toEqual([]);
    expect(diagnostics[0]?.result).toEqual({ changedFilesCount: 0, files: [] });
  });

  it('returns the coordinator typed error', async () => {
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockRejectedValue(new RunReadPreparationError('RUN_NOT_FOUND', 'Missing Run.'));

    await expect(createSubject(restore).handle({})).resolves.toMatchObject({
      requestId,
      status: 'error',
      error: { code: 'RUN_NOT_FOUND' },
    });
  });

  it('logs correlated safe workspace diagnostics when the changed-file read fails', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    vi.spyOn(restoredRun, 'getFileChangeProjection').mockReturnValue([
      { serviceId, repoRelativePath: 'src/example.ts' },
    ]);
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => NOOP_LOGGER),
    } satisfies ServerLogger;
    const failure = new RunChangedFilesContextError(
      'Git changed-file read failed for the selected service.',
      serviceId,
      'GIT_READ_FAILED',
      {
        workspace: {
          workspaceSource: 'active_worktree',
          workspaceIdentifier: 'sha256:workspace',
          sessionKind: 'service_bound',
          workspaceResolutionStatus: 'resolved',
          serviceId,
          repositoryIdentity: 'sha256:repository',
          worktreeIdentity: 'sha256:worktree',
          gitRootDetected: false,
          gitRootIdentity: null,
        },
        exitCode: 128,
        failureClassification: 'NOT_A_REPOSITORY',
      },
    );

    await expect(
      createSubject(restore, verified, undefined, [], undefined, undefined, undefined, undefined, {
        logger,
        changedFilesError: failure,
      }).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.changed_files.count',
      status: 'error',
      error: { code: 'READ_FAILED' },
    });

    expect(logger.error).toHaveBeenCalledWith(
      'cli-read.changed_files.read_failed',
      expect.objectContaining({
        requestId,
        agentSessionId,
        runId,
        operation: 'run.changed_files.count',
        readPhase: 'normal_read',
        workspaceSource: 'active_worktree',
        workspaceIdentifier: 'sha256:workspace',
        sessionKind: 'service_bound',
        workspaceResolutionStatus: 'resolved',
        serviceId,
        repositoryIdentity: 'sha256:repository',
        worktreeIdentity: 'sha256:worktree',
        gitRootDetected: false,
        exitCode: 128,
        failureClassification: 'NOT_A_REPOSITORY',
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('/');
  });

  it('returns a correlated bounded changed-file detail without starting a Run turn', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    vi.spyOn(restoredRun, 'getFileChangeProjection').mockReturnValue([]);
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const detailVerification = verifiedRead({
      requestId,
      agentSessionId,
      operation: 'run.changed_files.detail',
      runId,
      file: { serviceId, repoPath: '/tmp/repository', filePath: 'src/example.ts' },
    });
    const detail = {
      serviceId,
      repoPath: '/tmp/repository',
      filePath: 'src/example.ts',
      status: CliReadChangedFileDetailStatusEnum.Modify,
      diff: '@@ -1 +1 @@\n-before\n+after',
      preContent: 'before',
      postContent: 'after',
    } satisfies CliReadChangedFileDetail;

    await expect(
      createSubject(restore, detailVerification, undefined, [detail]).handle({}),
    ).resolves.toEqual({
      requestId,
      operation: 'run.changed_files.detail',
      status: 'success',
      result: { runId, file: detail },
    });
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledWith(runId);
  });

  it('returns a typed error when a changed-file detail exceeds its bound', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    vi.spyOn(restoredRun, 'getFileChangeProjection').mockReturnValue([]);
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const detailVerification = verifiedRead({
      requestId,
      agentSessionId,
      operation: 'run.changed_files.detail',
      runId,
      file: { serviceId, repoPath: '/tmp/repository', filePath: 'src/example.ts' },
    });
    const oversizedDetail = {
      serviceId,
      repoPath: '/tmp/repository',
      filePath: 'src/example.ts',
      status: CliReadChangedFileDetailStatusEnum.Modify,
      diff: 'x'.repeat(1_048_577),
      preContent: null,
      postContent: null,
    } satisfies CliReadChangedFileDetail;

    await expect(
      createSubject(restore, detailVerification, undefined, [oversizedDetail]).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.changed_files.detail',
      status: 'error',
      error: { code: 'RESULT_TOO_LARGE' },
    });
  });

  it('returns a typed error when changed-file post-content exceeds its bound', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    vi.spyOn(restoredRun, 'getFileChangeProjection').mockReturnValue([]);
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const detailVerification = verifiedRead({
      requestId,
      agentSessionId,
      operation: 'run.changed_files.detail',
      runId,
      file: { serviceId, repoPath: '/tmp/repository', filePath: 'src/example.ts' },
    });
    const oversizedDetail = {
      serviceId,
      repoPath: '/tmp/repository',
      filePath: 'src/example.ts',
      status: CliReadChangedFileDetailStatusEnum.Modify,
      diff: 'diff',
      preContent: 'before',
      postContent: 'y'.repeat(1_048_577),
    } satisfies CliReadChangedFileDetail;

    await expect(
      createSubject(restore, detailVerification, undefined, [oversizedDetail]).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.changed_files.detail',
      status: 'error',
      error: { code: 'RESULT_TOO_LARGE' },
    });
  });

  it('drops an unverified frame without attempting restoration', async () => {
    const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
    const handler = createSubject(restore, {
      ok: false,
      reason: 'signature_invalid',
      details: {},
    });

    await expect(handler.handle({})).resolves.toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it.each(PROTECTED_CLI_READ_OPERATIONS)(
    'denies %s when the concrete authority owner is absent',
    async (operation) => {
      const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
      const listProjectSessionCosts = vi.fn();
      const readRunContextUsage = vi.fn();
      const handler = createSubject(
        restore,
        verifiedRead(readBodiesByOperation[operation]),
        listProjectSessionCosts,
        [],
        undefined,
        readRunContextUsage,
        null,
      );

      await expect(handler.handle({})).resolves.toBeNull();
      expect(restore).not.toHaveBeenCalled();
      expect(listProjectSessionCosts).not.toHaveBeenCalled();
      expect(readRunContextUsage).not.toHaveBeenCalled();
    },
  );

  it.each(
    PROTECTED_CLI_READ_OPERATIONS.flatMap((operation) =>
      denialCases.map(([state, reason]) => [operation, state, reason] as const),
    ),
  )('denies %s for %s authority before any host read', async (operation, _state, reason) => {
    const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
    const listProjectSessionCosts = vi.fn();
    const readRunContextUsage = vi.fn();
    const admit = vi.fn().mockResolvedValue({ admitted: false, reason });
    const handler = createSubject(
      restore,
      verifiedRead(readBodiesByOperation[operation]),
      listProjectSessionCosts,
      [],
      undefined,
      readRunContextUsage,
      { admit },
    );

    await expect(handler.handle({})).resolves.toBeNull();
    expect(admit).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(listProjectSessionCosts).not.toHaveBeenCalled();
    expect(readRunContextUsage).not.toHaveBeenCalled();
  });

  it('returns project-session Costs without restoring or starting a Run', async () => {
    const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
    const listProjectSessionCosts = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      sourceAvailability: 'unavailable',
      costReadAt: '2026-07-27T00:00:00.000Z',
    });
    const projectVerification = verifiedRead(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      { organizationId, projectId },
    );

    await expect(
      createSubject(restore, projectVerification, listProjectSessionCosts).handle({}),
    ).resolves.toEqual({
      requestId,
      operation: 'project.session_costs.list',
      status: 'success',
      result: {
        items: [],
        nextCursor: null,
        sourceAvailability: 'unavailable',
        costReadAt: '2026-07-27T00:00:00.000Z',
      },
    });
    expect(listProjectSessionCosts).toHaveBeenCalledWith(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      organizationId,
    );
    expect(restore).not.toHaveBeenCalled();
  });

  it('returns one provider-usage entry per provider without blocking healthy entries on an item error', async () => {
    const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
    const result: CliReadProviderUsageResult = {
      providers: [
        {
          provider: 'claude',
          status: 'reported',
          observedAt: '2026-10-11T23:00:00.000Z',
          fiveHour: { usedPercent: 42, resetsAt: '2026-10-12T04:00:00.000Z' },
          weekly: null,
        },
        {
          provider: 'codex',
          status: 'error',
          observedAt: null,
          fiveHour: null,
          weekly: null,
        },
        {
          provider: 'opencode',
          status: 'unreported',
          observedAt: null,
          fiveHour: null,
          weekly: null,
        },
      ],
    };
    const readProviderUsage = vi.fn().mockResolvedValue(result);
    const providerVerification = verifiedRead({
      requestId,
      agentSessionId,
      operation: 'provider.usage.get',
    });

    await expect(
      createSubject(
        restore,
        providerVerification,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        { readProviderUsage },
      ).handle({}),
    ).resolves.toEqual({
      requestId,
      operation: 'provider.usage.get',
      status: 'success',
      result,
    });
    expect(readProviderUsage).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
  });

  it('returns the CLI model catalog, with a zero-model notice, without restoring a Run', async () => {
    const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
    const result: CliReadRuntimeModelCatalogResult = {
      providers: [
        {
          provider: 'codex',
          models: [{ id: 'gpt-5', label: 'GPT-5', efforts: ['low', 'high'] }],
        },
        {
          provider: 'claude',
          models: [],
          notice: 'Claude Code reported zero models on this machine.',
        },
      ],
    };
    const readRuntimeModelCatalog = vi.fn().mockResolvedValue(result);

    await expect(
      createSubject(
        restore,
        verifiedRead(readBodiesByOperation['runtime.model_catalog.get']),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        { readRuntimeModelCatalog },
      ).handle({}),
    ).resolves.toEqual({
      requestId,
      operation: 'runtime.model_catalog.get',
      status: 'success',
      result,
    });
    expect(readRuntimeModelCatalog).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
  });

  it('returns RESULT_TOO_LARGE instead of a partial model catalog', async () => {
    const oversized: CliReadRuntimeModelCatalogResult = {
      providers: [
        {
          provider: 'opencode',
          models: [{ id: 'a', label: 'x'.repeat(1_048_576), efforts: ['default'] }],
        },
      ],
    };

    await expect(
      createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>(),
        verifiedRead(readBodiesByOperation['runtime.model_catalog.get']),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        { readRuntimeModelCatalog: () => Promise.resolve(oversized) },
      ).handle({}),
    ).resolves.toEqual({
      requestId,
      operation: 'runtime.model_catalog.get',
      status: 'error',
      error: {
        code: CliReadErrorCode.ResultTooLarge,
        message: 'The model catalog exceeds the response size limit.',
      },
    });
  });

  it('returns a typed error, not an empty catalog, when no catalog is installed', async () => {
    await expect(
      createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>(),
        verifiedRead(readBodiesByOperation['runtime.model_catalog.get']),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        {
          readRuntimeModelCatalog: () =>
            Promise.reject(new Error('The model catalog is not ready.')),
        },
      ).handle({}),
    ).resolves.toMatchObject({
      operation: 'runtime.model_catalog.get',
      status: 'error',
      error: { code: CliReadErrorCode.ReadFailed },
    });
  });

  it('returns cohesive context and cost for the addressed restored Run', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const readRunContextUsage = vi.fn().mockResolvedValue({
      runId,
      providerSessionId: 'provider-session-1',
      contextData: {
        categories: [],
        totalTokens: 10,
        maxTokens: 100,
        rawMaxTokens: 100,
        percentage: 10,
        gridRows: [],
        model: 'model-1',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        isAutoCompactEnabled: false,
        apiUsage: null,
      },
      cost: { state: 'unavailable', reason: 'session_not_found' },
    });
    const contextVerification = verifiedRead({
      requestId,
      agentSessionId: runId,
      operation: 'run.context_usage.get',
      runId,
      providerSessionId: 'provider-session-1',
    });

    await expect(
      createSubject(
        restore,
        contextVerification,
        undefined,
        [],
        undefined,
        readRunContextUsage,
      ).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.context_usage.get',
      status: 'success',
      result: {
        runId,
        providerSessionId: 'provider-session-1',
        cost: { state: 'unavailable', reason: 'session_not_found' },
      },
    });
    expect(restore).toHaveBeenCalledWith(runId);
    expect(readRunContextUsage).toHaveBeenCalledWith(restoredRun, 'provider-session-1');
  });

  it('returns the provider Skill catalog for the addressed Run without exposing host paths', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const listRunSkills = vi.fn().mockResolvedValue({
      provider: 'codex' as const,
      skills: [
        {
          provider: 'codex' as const,
          name: 'release-check',
          catalogScope: 'repo' as const,
          description: 'Check the release state.',
          enabled: true,
        },
      ],
      errors: [],
    });
    const skillVerification = verifiedRead({
      requestId,
      agentSessionId: runId,
      operation: 'run.skills.list',
      runId,
    });

    await expect(
      createSubject(
        restore,
        skillVerification,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        listRunSkills,
      ).handle({}),
    ).resolves.toEqual({
      requestId,
      operation: 'run.skills.list',
      status: 'success',
      result: {
        runId,
        provider: 'codex',
        skills: [
          {
            provider: 'codex',
            name: 'release-check',
            catalogScope: 'repo',
            description: 'Check the release state.',
            enabled: true,
          },
        ],
        errors: [],
      },
    });
    expect(listRunSkills).toHaveBeenCalledWith(restoredRun);
  });

  it('returns PROVIDER_UNAVAILABLE when the selected provider cannot list Skills', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const listRunSkills = vi
      .fn()
      .mockRejectedValue(
        new AgentSessionRunnerError(
          'NOT_SUPPORTED',
          'Provider opencode does not expose a Skill catalog.',
        ),
      );
    const skillVerification = verifiedRead({
      requestId,
      agentSessionId: runId,
      operation: 'run.skills.list',
      runId,
    });

    await expect(
      createSubject(
        restore,
        skillVerification,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        listRunSkills,
      ).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.skills.list',
      status: 'error',
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Provider opencode does not expose a Skill catalog.',
      },
    });
  });

  it('returns RESULT_TOO_LARGE when the provider catalog exceeds the read bound', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const listRunSkills = vi.fn().mockResolvedValue({
      provider: 'codex' as const,
      skills: [
        {
          provider: 'codex' as const,
          name: 'oversized-skill',
          catalogScope: 'repo' as const,
          description: 'x'.repeat(1_048_577),
          enabled: true,
        },
      ],
      errors: [],
    });
    const skillVerification = verifiedRead({
      requestId,
      agentSessionId: runId,
      operation: 'run.skills.list',
      runId,
    });

    await expect(
      createSubject(
        restore,
        skillVerification,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        listRunSkills,
      ).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.skills.list',
      status: 'error',
      error: { code: 'RESULT_TOO_LARGE' },
    });
  });

  it('rejects a Skill catalog whose signed Agent Session context does not match the Run', async () => {
    const restoredRun = createTestRun({
      runId,
      organizationId,
      projectId,
      conversationId,
    });
    const restore = vi
      .fn<(requestedRunId: string) => Promise<Run>>()
      .mockResolvedValue(restoredRun);
    const listRunSkills = vi.fn();
    const skillVerification = verifiedRead({
      requestId,
      agentSessionId,
      operation: 'run.skills.list',
      runId,
    });

    await expect(
      createSubject(
        restore,
        skillVerification,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        listRunSkills,
      ).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'run.skills.list',
      status: 'error',
      error: { code: 'INVALID_RUN_CONTEXT' },
    });
    expect(listRunSkills).not.toHaveBeenCalled();
  });

  describe('run.tool_calls.latest_turn', () => {
    const toolCallsVerification = (overrides: { agentSessionId?: string } = {}) =>
      verifiedRead({
        requestId,
        agentSessionId: overrides.agentSessionId ?? runId,
        operation: 'run.tool_calls.latest_turn',
        runId,
      });

    const toolEntry = (turnId: string, seq: number, toolUseId: string): SessionToolEntry => ({
      kind: 'tool',
      entryId: `1:${String(seq)}`,
      seq,
      lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
      turnId,
      providerTurnId: null,
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:01.000Z',
      toolUseId,
      toolName: 'Bash',
      input: { text: '{"command":"ls"}', truncatedBytes: 0 },
      status: 'completed',
      output: { text: '', truncatedBytes: 0 },
      result: { text: 'file.ts', truncatedBytes: 0 },
      exitCode: null,
    });

    const activityOf = (entries: SessionToolEntry[]): Pick<SessionActivitySource, 'snapshot'> => ({
      snapshot: () => ({
        revision: 1,
        runs: [
          {
            runId,
            runInstanceId: 1,
            entries,
            gap: { evictedCount: 2, throughSeq: 2 },
          },
        ],
      }),
    });

    const restoredRun = (activeTurnId: string | null) => {
      const run = createTestRun({ runId, organizationId, projectId, conversationId });
      run.activeTurn = activeTurnId === null ? null : ({ turnId: activeTurnId } as Turn);
      return run;
    };

    it('returns the active Turn tool calls and passes the size guard unreplaced', async () => {
      const run = restoredRun('turn-2');
      const handler = createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>().mockResolvedValue(run),
        toolCallsVerification(),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        {
          sessionActivity: activityOf([
            toolEntry('turn-1', 3, 'old'),
            toolEntry('turn-2', 4, 'current'),
          ]),
        },
      );

      const response = await handler.handle({});

      expect(response).toMatchObject({
        requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'success',
        result: {
          state: 'available',
          runId,
          turnId: 'turn-2',
          omittedEarlierCount: 0,
          evictedCount: 2,
          toolCalls: [{ toolUseId: 'current', summary: 'Bash: ls' }],
        },
      });
      expect(guardCliReadResponse(response as NonNullable<typeof response>).replaced).toBe(false);
    });

    it('selects the newest Turn with activity when no Turn is active', async () => {
      const handler = createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>().mockResolvedValue(restoredRun(null)),
        toolCallsVerification(),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        {
          sessionActivity: activityOf([toolEntry('turn-1', 3, 'a'), toolEntry('turn-2', 4, 'b')]),
        },
      );

      await expect(handler.handle({})).resolves.toMatchObject({
        result: { turnId: 'turn-2', toolCalls: [{ toolUseId: 'b' }] },
      });
    });

    it('returns the disabled state without tool-call content and honours a toggle on the next request', async () => {
      let enabled = false;
      const snapshot = vi.fn(activityOf([toolEntry('turn-1', 3, 'secret-call')]).snapshot);
      const handler = createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>().mockResolvedValue(restoredRun(null)),
        toolCallsVerification(),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        {
          sessionActivity: { snapshot },
          isRemoteToolCallViewingEnabled: () => Promise.resolve(enabled),
        },
      );

      const disabled = await handler.handle({});
      expect(disabled).toEqual({
        requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'success',
        result: { state: 'disabled', runId },
      });
      expect(JSON.stringify(disabled)).not.toContain('secret-call');
      expect(snapshot).not.toHaveBeenCalled();

      enabled = true;
      await expect(handler.handle({})).resolves.toMatchObject({
        result: { state: 'available', toolCalls: [{ toolUseId: 'secret-call' }] },
      });
    });

    it('rejects a signed Agent Session that does not match the Run before reading the setting or activity', async () => {
      const isRemoteToolCallViewingEnabled = vi.fn().mockResolvedValue(true);
      const snapshot = vi.fn();
      const handler = createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>().mockResolvedValue(restoredRun(null)),
        toolCallsVerification({ agentSessionId }),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        { sessionActivity: { snapshot }, isRemoteToolCallViewingEnabled },
      );

      await expect(handler.handle({})).resolves.toMatchObject({
        operation: 'run.tool_calls.latest_turn',
        status: 'error',
        error: { code: 'INVALID_RUN_CONTEXT' },
      });
      expect(isRemoteToolCallViewingEnabled).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
    });

    it('logs counts only, never tool names, arguments or results', async () => {
      const logged: unknown[] = [];
      const record = (_message: string, details?: unknown) => logged.push(details);
      const logger: ServerLogger = {
        ...NOOP_LOGGER,
        debug: record,
        info: record,
        warn: record,
        error: record,
        child: () => logger,
      };
      const handler = createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>().mockResolvedValue(restoredRun(null)),
        toolCallsVerification(),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        { logger, sessionActivity: activityOf([toolEntry('turn-1', 3, 'a')]) },
      );

      await handler.handle({});

      const serialized = JSON.stringify(logged);
      expect(serialized).toContain('toolCallCount');
      expect(serialized).not.toContain('Bash');
      expect(serialized).not.toContain('file.ts');
      expect(serialized).not.toContain('"command"');
    });

    it('writes nothing to the Run store', async () => {
      const writers = Object.getOwnPropertyNames(RunStore.prototype).filter((name) =>
        /^(append|update|set|add|create|persist|replace|record|reindex|delete)/u.test(name),
      );
      const spies = writers.map((name) =>
        vi.spyOn(RunStore.prototype, name as keyof RunStore & string),
      );
      const handler = createSubject(
        vi.fn<(requestedRunId: string) => Promise<Run>>().mockResolvedValue(restoredRun('turn-1')),
        toolCallsVerification(),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        { sessionActivity: activityOf([toolEntry('turn-1', 3, 'a')]) },
      );

      await handler.handle({});

      expect(writers.length).toBeGreaterThan(0);
      expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    });
  });

  it('rejects a project-session Costs request outside the signed project', async () => {
    const restore = vi.fn<(requestedRunId: string) => Promise<Run>>();
    const listProjectSessionCosts = vi.fn();
    const projectVerification = verifiedRead(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      {
        organizationId,
        projectId: '66666666-6666-4666-8666-666666666666',
      },
    );

    await expect(
      createSubject(restore, projectVerification, listProjectSessionCosts).handle({}),
    ).resolves.toMatchObject({
      requestId,
      operation: 'project.session_costs.list',
      status: 'error',
      error: { code: 'INVALID_PROJECT_CONTEXT' },
    });
    expect(listProjectSessionCosts).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});

describe('workspace catalog admission', () => {
  it('recomputes exact catalog authority and never restores a Run', async () => {
    const restore = vi.fn();
    const admit = vi.fn().mockResolvedValue({ admitted: true });
    const body = readBodiesByOperation['workspace.skills.list'];
    const subject = createSubject(
      restore,
      verifiedRead(body),
      undefined,
      [],
      undefined,
      undefined,
      { admit },
    );
    expect(await subject.handle({})).toMatchObject({
      operation: 'workspace.skills.list',
      status: 'success',
    });
    expect(restore).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'CLI_READ', id: machineId, revision: null },
        agentSessionId: null,
        organizationId,
        projectId,
        actionPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
  it('admits the model catalog by machine, without a session or Run', async () => {
    const restore = vi.fn();
    const admit = vi.fn().mockResolvedValue({ admitted: true });
    const readRuntimeModelCatalog = vi.fn().mockResolvedValue({ providers: [] });
    const subject = createSubject(
      restore,
      verifiedRead(readBodiesByOperation['runtime.model_catalog.get']),
      undefined,
      [],
      undefined,
      undefined,
      { admit },
      undefined,
      { readRuntimeModelCatalog },
    );
    expect(await subject.handle({})).toMatchObject({
      operation: 'runtime.model_catalog.get',
      status: 'success',
    });
    expect(restore).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'CLI_READ', id: machineId, revision: null },
        agentSessionId: null,
        organizationId,
        projectId,
        actionPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
  it('does not read the model catalog when admission is denied', async () => {
    const admit = vi.fn().mockResolvedValue({ admitted: false, reason: 'DENIED' });
    const readRuntimeModelCatalog = vi.fn();
    const subject = createSubject(
      vi.fn(),
      verifiedRead(readBodiesByOperation['runtime.model_catalog.get']),
      undefined,
      [],
      undefined,
      undefined,
      { admit },
      undefined,
      { readRuntimeModelCatalog },
    );
    expect(await subject.handle({})).toBeNull();
    expect(readRuntimeModelCatalog).not.toHaveBeenCalled();
  });
  it.each(['organizationId', 'projectId', 'machineId'] as const)(
    'rejects mismatched signed %s before reading',
    async (field) => {
      const restore = vi.fn();
      const admit = vi.fn();
      const body = { ...readBodiesByOperation['workspace.skills.list'], [field]: serviceId };
      const subject = createSubject(
        restore,
        verifiedRead(body),
        undefined,
        [],
        undefined,
        undefined,
        { admit },
      );
      expect(await subject.handle({})).toBeNull();
      expect(admit).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
    },
  );
});
