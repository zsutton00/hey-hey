import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getGitChangedFileDetail,
  getGitChangedFilesInventory,
  getGitDiff,
  resolveGitRoot,
} from '../git';
import type { RepoMappingStore } from '../repo';
import { toServiceId } from '../repo';
import type { CanonicalFileChangeFact, FileChangeProjection } from '../run/file-change-facts';
import type { AgenticSession } from '../session/types';
import type {
  CliReadChangedFileDetail,
  CliReadChangedFileIdentity,
  CliReadChangedFileInventoryEntry,
} from '../shared/agent-bridge-contract/generated/api';
import type {
  LocalRunDiffFilePatch,
  LocalWorktreeState,
} from '../shared/agent-bridge-contract/contract';
import {
  classifyChangedFilesFailure,
  createChangedFilesWorkspaceDiagnostic,
  getChangedFilesExitCode,
  stableWorkspaceIdentity,
  type ChangedFilesFailureDetails,
} from './changed-files-read-diagnostics';
import { NOOP_LOGGER, type ServerLogger } from './logger';

export class RunChangedFilesContextError extends Error {
  constructor(
    message: string,
    readonly serviceId: string,
    readonly code:
      | 'REPOSITORY_NOT_FOUND'
      | 'INVALID_REPOSITORY_PATH'
      | 'INVALID_FILE_MEMBERSHIP'
      | 'GIT_READ_FAILED' = 'INVALID_REPOSITORY_PATH',
    readonly details?: ChangedFilesFailureDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RunChangedFilesContextError';
  }
}

const isWithinRoot = (candidate: string, root: string): boolean => {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

const readServiceWorktreeState = (
  run: AgenticSession,
  serviceId: string,
  serviceRepoPath: string | null,
): LocalWorktreeState | null => {
  const worktreeState = run.worktreeState;
  if (!worktreeState) return null;

  const exactEntry = worktreeState[serviceId];
  if (exactEntry) return exactEntry;
  if (!serviceRepoPath) return null;

  const normalizedRepoPath = path.resolve(serviceRepoPath);
  return (
    Object.values(worktreeState).find(
      (entry) =>
        path.resolve(entry.repoPath) === normalizedRepoPath ||
        path.resolve(entry.worktreePath) === normalizedRepoPath,
    ) ?? null
  );
};

const resolveRepoPathForService = async (
  run: AgenticSession,
  repoStore: RepoMappingStore,
  serviceId: string,
): Promise<{
  repoPath: string;
  workspace: ReturnType<typeof createChangedFilesWorkspaceDiagnostic>;
}> => {
  const service = run.services.find((entry) => entry.id === serviceId) ?? null;
  const cachedServicePath = service?.path.trim() || null;
  const worktreeState = readServiceWorktreeState(run, serviceId, cachedServicePath);
  const repoPath =
    worktreeState?.worktreePath.trim() ||
    worktreeState?.repoPath.trim() ||
    cachedServicePath ||
    (await repoStore.getBinding(toServiceId(serviceId)))?.repositoryPath ||
    null;

  if (!repoPath) {
    throw new RunChangedFilesContextError(
      `Cannot resolve a repository path for service ${serviceId}.`,
      serviceId,
      'REPOSITORY_NOT_FOUND',
      {
        workspace: createChangedFilesWorkspaceDiagnostic({
          session: run,
          serviceId,
          workspaceResolutionStatus: 'missing',
        }),
        exitCode: null,
        failureClassification: 'REPOSITORY_NOT_FOUND',
      },
    );
  }
  if (!path.isAbsolute(repoPath)) {
    throw new RunChangedFilesContextError(
      `Resolved repository path for service ${serviceId} is not absolute.`,
      serviceId,
      'INVALID_REPOSITORY_PATH',
      {
        workspace: createChangedFilesWorkspaceDiagnostic({
          session: run,
          serviceId,
          repoPath,
          workspaceResolutionStatus: 'invalid',
        }),
        exitCode: null,
        failureClassification: 'INVALID_REPOSITORY_PATH',
      },
    );
  }

  const allowedRoots = run.scope?.allowedRepositoryRoots;
  if (allowedRoots?.length && !allowedRoots.some((root) => root && isWithinRoot(repoPath, root))) {
    throw new RunChangedFilesContextError(
      `Resolved repository path for service ${serviceId} is outside the allowed roots for this run.`,
      serviceId,
      'INVALID_REPOSITORY_PATH',
      {
        workspace: createChangedFilesWorkspaceDiagnostic({
          session: run,
          serviceId,
          repoPath,
          workspaceResolutionStatus: 'invalid',
        }),
        exitCode: null,
        failureClassification: 'INVALID_REPOSITORY_PATH',
      },
    );
  }
  return {
    repoPath,
    workspace: createChangedFilesWorkspaceDiagnostic({ session: run, serviceId, repoPath }),
  };
};

const isValidMembership = (run: AgenticSession, entry: FileChangeProjection): boolean => {
  const segments = entry.repoRelativePath.split('/');
  return (
    entry.repoRelativePath.length > 0 &&
    !path.posix.isAbsolute(entry.repoRelativePath) &&
    !segments.includes('..') &&
    run.services.some((service) => service.id === entry.serviceId)
  );
};

const isCanonicalFileChangeFact = (
  entry: FileChangeProjection | CanonicalFileChangeFact,
): entry is CanonicalFileChangeFact => 'evidence' in entry;

const hasDurableEvidence = (fact: CanonicalFileChangeFact): boolean =>
  fact.evidence.diff.length > 0 ||
  (fact.evidence.kind === 'patch'
    ? fact.evidence.preContent !== null || fact.evidence.postContent !== null
    : fact.evidence.baselineContent !== null || fact.evidence.postContent !== null);

const evidenceToDiff = (
  fact: CanonicalFileChangeFact,
  repoPath: string,
): LocalRunDiffFilePatch => ({
  serviceId: fact.serviceId,
  repoPath,
  filePath: fact.repoRelativePath,
  diff: fact.evidence.diff,
  preContent:
    fact.evidence.kind === 'patch' ? fact.evidence.preContent : fact.evidence.baselineContent,
  postContent: fact.evidence.postContent,
});

type ResolvedServiceWorkspace = Awaited<ReturnType<typeof resolveRepoPathForService>>;

const inspectGitWorkspace = async (
  workspace: ResolvedServiceWorkspace,
): Promise<ResolvedServiceWorkspace> => {
  const serviceId = workspace.workspace.serviceId;
  if (!serviceId) {
    throw new Error('Resolved repository workspace is missing service identity.');
  }
  try {
    const stats = await fs.stat(workspace.repoPath);
    if (!stats.isDirectory()) {
      throw new RunChangedFilesContextError(
        'Resolved repository workspace is not a directory.',
        serviceId,
        'GIT_READ_FAILED',
        {
          workspace: {
            ...workspace.workspace,
            workspaceResolutionStatus: 'invalid',
            gitRootDetected: false,
          },
          exitCode: null,
          failureClassification: 'WORKSPACE_UNAVAILABLE',
        },
      );
    }
  } catch (error) {
    if (error instanceof RunChangedFilesContextError) throw error;
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    const errorCode =
      'code' in resolvedError && typeof resolvedError.code === 'string' ? resolvedError.code : null;
    throw new RunChangedFilesContextError(
      errorCode === 'ENOENT' || errorCode === 'ENOTDIR'
        ? 'Resolved repository workspace is unavailable.'
        : 'Resolved repository workspace could not be inspected.',
      serviceId,
      'GIT_READ_FAILED',
      {
        workspace: {
          ...workspace.workspace,
          workspaceResolutionStatus:
            errorCode === 'ENOENT' || errorCode === 'ENOTDIR' ? 'unavailable' : 'failed',
          ...(errorCode === 'ENOENT' || errorCode === 'ENOTDIR' ? { gitRootDetected: false } : {}),
        },
        exitCode: getChangedFilesExitCode(resolvedError),
        failureClassification:
          errorCode === 'ENOENT' || errorCode === 'ENOTDIR'
            ? 'WORKSPACE_NOT_FOUND'
            : classifyChangedFilesFailure(resolvedError),
      },
      { cause: resolvedError },
    );
  }
  const gitRootPath = await resolveGitRoot(path.join(workspace.repoPath, '.heyhey-git-root-check'));
  return {
    ...workspace,
    workspace: {
      ...workspace.workspace,
      gitRootDetected: gitRootPath !== null,
      gitRootIdentity: gitRootPath ? stableWorkspaceIdentity(gitRootPath) : null,
    },
  };
};

const gitReadFailure = (
  serviceId: string,
  workspace: ResolvedServiceWorkspace,
  error: Error,
): RunChangedFilesContextError => {
  const details = {
    workspace: workspace.workspace,
    exitCode: getChangedFilesExitCode(error),
    failureClassification: classifyChangedFilesFailure(error),
  } satisfies ChangedFilesFailureDetails;
  return new RunChangedFilesContextError(
    `Git changed-file read failed for service ${serviceId}.`,
    serviceId,
    'GIT_READ_FAILED',
    details,
    { cause: error },
  );
};

export class RunChangedFilesReader {
  private readonly unavailableWorktreesByRun = new WeakMap<AgenticSession, Set<string>>();

  public constructor(
    private readonly repoStore: RepoMappingStore,
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {}

  public async getLiveRunChangedFilesInventory(
    run: AgenticSession,
    fileChanges: readonly (FileChangeProjection | CanonicalFileChangeFact)[],
  ): Promise<CliReadChangedFileInventoryEntry[]> {
    const pathsByService = new Map<string, Set<string>>();
    for (const entry of fileChanges) {
      if (!isValidMembership(run, entry)) {
        throw new RunChangedFilesContextError(
          `Invalid file membership for service ${entry.serviceId}: ${entry.repoRelativePath}`,
          entry.serviceId,
          'INVALID_FILE_MEMBERSHIP',
        );
      }
      const paths = pathsByService.get(entry.serviceId) ?? new Set<string>();
      paths.add(entry.repoRelativePath);
      pathsByService.set(entry.serviceId, paths);
    }

    const inventories = await Promise.all(
      [...pathsByService.entries()].map(async ([serviceId, paths]) => {
        const resolvedWorkspace = await resolveRepoPathForService(run, this.repoStore, serviceId);
        if (await this.isUnavailableWorktree(run, serviceId, resolvedWorkspace.repoPath)) {
          throw new RunChangedFilesContextError(
            `Resolved repository path for service ${serviceId} is unavailable.`,
            serviceId,
            'GIT_READ_FAILED',
            {
              workspace: {
                ...resolvedWorkspace.workspace,
                workspaceResolutionStatus: 'unavailable',
                gitRootDetected: false,
              },
              exitCode: null,
              failureClassification: 'WORKSPACE_UNAVAILABLE',
            },
          );
        }
        const workspace = await inspectGitWorkspace(resolvedWorkspace);
        try {
          const entries = await getGitChangedFilesInventory({
            repoPath: workspace.repoPath,
            paths: [...paths],
          });
          return entries.map((entry) => ({
            ...entry,
            serviceId,
            repoPath: workspace.repoPath,
          }));
        } catch (error) {
          const resolvedError = error instanceof Error ? error : new Error(String(error));
          throw gitReadFailure(serviceId, workspace, resolvedError);
        }
      }),
    );
    return inventories.flat();
  }

  public async getLiveRunChangedFileDetail(
    run: AgenticSession,
    fileChanges: readonly (FileChangeProjection | CanonicalFileChangeFact)[],
    requestedFile: CliReadChangedFileIdentity,
  ): Promise<CliReadChangedFileDetail> {
    const membership = fileChanges.find(
      (entry) =>
        entry.serviceId === requestedFile.serviceId &&
        entry.repoRelativePath === requestedFile.filePath,
    );
    if (!membership || !isValidMembership(run, membership)) {
      throw new RunChangedFilesContextError(
        `The selected file is not part of this Run's canonical changed-file membership.`,
        requestedFile.serviceId,
        'INVALID_FILE_MEMBERSHIP',
      );
    }
    const resolvedWorkspace = await resolveRepoPathForService(
      run,
      this.repoStore,
      requestedFile.serviceId,
    );
    if (path.resolve(resolvedWorkspace.repoPath) !== path.resolve(requestedFile.repoPath)) {
      throw new RunChangedFilesContextError(
        `The selected repository path does not match the Run's service repository.`,
        requestedFile.serviceId,
        'INVALID_FILE_MEMBERSHIP',
        {
          workspace: {
            ...resolvedWorkspace.workspace,
            workspaceResolutionStatus: 'invalid',
          },
          exitCode: null,
          failureClassification: 'INVALID_FILE_MEMBERSHIP',
        },
      );
    }
    if (
      await this.isUnavailableWorktree(run, requestedFile.serviceId, resolvedWorkspace.repoPath)
    ) {
      throw new RunChangedFilesContextError(
        `Resolved repository path for service ${requestedFile.serviceId} is unavailable.`,
        requestedFile.serviceId,
        'GIT_READ_FAILED',
        {
          workspace: {
            ...resolvedWorkspace.workspace,
            workspaceResolutionStatus: 'unavailable',
            gitRootDetected: false,
          },
          exitCode: null,
          failureClassification: 'WORKSPACE_UNAVAILABLE',
        },
      );
    }
    const workspace = await inspectGitWorkspace(resolvedWorkspace);
    let detail: Awaited<ReturnType<typeof getGitChangedFileDetail>>;
    try {
      detail = await getGitChangedFileDetail({
        repoPath: workspace.repoPath,
        filePath: requestedFile.filePath,
      });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      throw gitReadFailure(requestedFile.serviceId, workspace, resolvedError);
    }
    if (!detail) {
      throw new RunChangedFilesContextError(
        `The selected file is no longer dirty within this Run's canonical membership.`,
        requestedFile.serviceId,
        'INVALID_FILE_MEMBERSHIP',
        {
          workspace: {
            ...workspace.workspace,
            workspaceResolutionStatus: 'resolved',
          },
          exitCode: null,
          failureClassification: 'INVALID_FILE_MEMBERSHIP',
        },
      );
    }
    return {
      ...detail,
      serviceId: requestedFile.serviceId,
      repoPath: workspace.repoPath,
    };
  }

  public async getLiveRunChangedFiles(
    run: AgenticSession,
    fileChanges: readonly (FileChangeProjection | CanonicalFileChangeFact)[],
    options: { strictContext?: boolean } = {},
  ): Promise<LocalRunDiffFilePatch[]> {
    if (fileChanges.some(isCanonicalFileChangeFact)) {
      const diffs: LocalRunDiffFilePatch[] = [];
      for (const entry of fileChanges) {
        if (!isCanonicalFileChangeFact(entry)) {
          this.logger.debug('local.run_changed_files.legacy_projection_ignored_with_facts', {
            runId: run.agentic_session_id,
            serviceId: entry.serviceId,
            repoRelativePath: entry.repoRelativePath,
          });
          continue;
        }
        if (!isValidMembership(run, entry)) {
          this.logger.warn('local.run_changed_files.fact_skipped_invalid_membership', {
            runId: run.agentic_session_id,
            factId: entry.factId,
            serviceId: entry.serviceId,
            repoRelativePath: entry.repoRelativePath,
          });
          if (options.strictContext) {
            throw new RunChangedFilesContextError(
              `Invalid file membership for service ${entry.serviceId}: ${entry.repoRelativePath}`,
              entry.serviceId,
              'INVALID_FILE_MEMBERSHIP',
            );
          }
          continue;
        }
        if (!hasDurableEvidence(entry)) {
          this.logger.warn('local.run_changed_files.fact_skipped_missing_evidence', {
            runId: run.agentic_session_id,
            factId: entry.factId,
            serviceId: entry.serviceId,
            repoRelativePath: entry.repoRelativePath,
            evidenceKind: entry.evidence.kind,
          });
          continue;
        }
        const resolvedWorkspace = await resolveRepoPathForService(
          run,
          this.repoStore,
          entry.serviceId,
        );
        diffs.push(evidenceToDiff(entry, resolvedWorkspace.repoPath));
      }
      this.logger.debug('local.run_changed_files.persisted_evidence_rendered', {
        runId: run.agentic_session_id,
        factCount: fileChanges.filter(isCanonicalFileChangeFact).length,
        diffCount: diffs.length,
      });
      return diffs;
    }

    this.logger.trace('local.run_changed_files.legacy_live_projection_rendering', {
      runId: run.agentic_session_id,
      projectionCount: fileChanges.length,
    });

    const pathsByService = new Map<string, Set<string>>();
    for (const entry of fileChanges) {
      if (!isValidMembership(run, entry)) {
        this.logger.warn('local.run_changed_files.projection_skipped_invalid_membership', {
          runId: run.agentic_session_id,
          serviceId: entry.serviceId,
          repoRelativePath: entry.repoRelativePath,
        });
        if (options.strictContext) {
          throw new RunChangedFilesContextError(
            `Invalid file membership for service ${entry.serviceId}: ${entry.repoRelativePath}`,
            entry.serviceId,
            'INVALID_FILE_MEMBERSHIP',
          );
        }
        continue;
      }
      const paths = pathsByService.get(entry.serviceId) ?? new Set<string>();
      paths.add(entry.repoRelativePath);
      pathsByService.set(entry.serviceId, paths);
    }

    const serviceDiffs = await Promise.all(
      [...pathsByService.entries()].map(async ([serviceId, paths]) => {
        const resolvedWorkspace = await resolveRepoPathForService(run, this.repoStore, serviceId);
        this.logger.debug('local.run_changed_files.git_projection.started', {
          runId: run.agentic_session_id,
          serviceId,
          workspaceIdentifier: resolvedWorkspace.workspace.workspaceIdentifier,
          workspaceSource: resolvedWorkspace.workspace.workspaceSource,
          membershipCount: paths.size,
          membershipPaths: [...paths],
        });
        if (await this.isUnavailableWorktree(run, serviceId, resolvedWorkspace.repoPath)) {
          if (options.strictContext) {
            throw new RunChangedFilesContextError(
              `Resolved repository path for service ${serviceId} is unavailable.`,
              serviceId,
              'GIT_READ_FAILED',
              {
                workspace: {
                  ...resolvedWorkspace.workspace,
                  workspaceResolutionStatus: 'unavailable',
                  gitRootDetected: false,
                },
                exitCode: null,
                failureClassification: 'WORKSPACE_UNAVAILABLE',
              },
            );
          }
          this.logger.info('local.run_changed_files.git_projection.resolved', {
            runId: run.agentic_session_id,
            serviceId,
            workspaceIdentifier: resolvedWorkspace.workspace.workspaceIdentifier,
            workspaceSource: resolvedWorkspace.workspace.workspaceSource,
            membershipCount: paths.size,
            changedFilesCount: 0,
            changedFiles: [],
            reason: 'worktree_unavailable',
          });
          return [];
        }
        const workspace = await inspectGitWorkspace(resolvedWorkspace);
        let diffs: Awaited<ReturnType<typeof getGitDiff>>;
        try {
          diffs = await getGitDiff({ repoPath: workspace.repoPath, paths: [...paths] });
        } catch (error) {
          const resolvedError = error instanceof Error ? error : new Error(String(error));
          throw gitReadFailure(serviceId, workspace, resolvedError);
        }
        this.logger.info('local.run_changed_files.git_projection.resolved', {
          runId: run.agentic_session_id,
          serviceId,
          workspaceIdentifier: workspace.workspace.workspaceIdentifier,
          workspaceSource: workspace.workspace.workspaceSource,
          membershipCount: paths.size,
          changedFilesCount: diffs.length,
          changedFiles: diffs.map((diff) => diff.filePath),
          reason: diffs.length === 0 ? 'membership_clean_or_absent' : 'dirty_membership_found',
        });
        return diffs.map((diff) => ({
          ...diff,
          serviceId,
          repoPath: workspace.repoPath,
        }));
      }),
    );

    const diffs = serviceDiffs.flat();
    this.logger.info('local.run_changed_files.projection.completed', {
      runId: run.agentic_session_id,
      membershipCount: fileChanges.length,
      serviceCount: pathsByService.size,
      changedFilesCount: diffs.length,
      changedFiles: diffs.map((diff) => ({
        serviceId: diff.serviceId,
        workspaceIdentifier: stableWorkspaceIdentity(diff.repoPath),
        filePath: diff.filePath,
      })),
    });
    return diffs;
  }

  private async isUnavailableWorktree(
    run: AgenticSession,
    serviceId: string,
    repoPath: string,
  ): Promise<boolean> {
    const serviceRepoPath = run.services.find((entry) => entry.id === serviceId)?.path.trim();
    const worktreeState = readServiceWorktreeState(
      run,
      serviceId,
      serviceRepoPath?.length ? serviceRepoPath : null,
    );
    if (!worktreeState || path.resolve(worktreeState.worktreePath) !== path.resolve(repoPath)) {
      return false;
    }

    const worktreeKey = `${serviceId}\0${path.resolve(repoPath)}`;
    try {
      const worktreeStats = await fs.stat(repoPath);
      if (!worktreeStats.isDirectory()) {
        throw new RunChangedFilesContextError(
          `Resolved worktree path for service ${serviceId} is not a directory.`,
          serviceId,
          'GIT_READ_FAILED',
          {
            workspace: {
              ...createChangedFilesWorkspaceDiagnostic({
                session: run,
                serviceId,
                repoPath,
                workspaceResolutionStatus: 'invalid',
              }),
              gitRootDetected: false,
            },
            exitCode: null,
            failureClassification: 'WORKSPACE_UNAVAILABLE',
          },
        );
      }
      const unavailableWorktrees = this.unavailableWorktreesByRun.get(run);
      if (unavailableWorktrees?.delete(worktreeKey)) {
        this.logger.debug('local.run_changed_files.worktree_available_again', {
          runId: run.agentic_session_id,
          serviceId,
          workspaceIdentifier: stableWorkspaceIdentity(repoPath),
        });
      }
      return false;
    } catch (error) {
      const errorCode =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : null;
      if (errorCode !== 'ENOENT' && errorCode !== 'ENOTDIR') throw error;

      const unavailableWorktrees = this.unavailableWorktreesByRun.get(run) ?? new Set<string>();
      if (!unavailableWorktrees.has(worktreeKey)) {
        unavailableWorktrees.add(worktreeKey);
        this.unavailableWorktreesByRun.set(run, unavailableWorktrees);
        this.logger.debug('local.run_changed_files.worktree_unavailable', {
          runId: run.agentic_session_id,
          serviceId,
          workspaceIdentifier: stableWorkspaceIdentity(repoPath),
        });
      } else {
        this.logger.trace('local.run_changed_files.worktree_still_unavailable', {
          runId: run.agentic_session_id,
          serviceId,
          workspaceIdentifier: stableWorkspaceIdentity(repoPath),
        });
      }
      return true;
    }
  }
}
