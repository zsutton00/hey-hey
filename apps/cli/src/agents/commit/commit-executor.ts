import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type { LocalCommitPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type { ServerLogger } from '../../server/logger';
import {
  canonicalFileChangeKey,
  resolveProjectedFilePath,
  resolveRunFilePath,
} from '../../run/file-change-facts';
import type { Run } from '../../run/run';
import type { CommitReportTool } from '../submission-tools/create-commit-report-tool';

const execFileAsync = promisify(execFile);
const MAX_GIT_BUFFER = 50 * 1024 * 1024;

interface ServiceCommitScope {
  serviceId: string;
  repoPath: string;
  files: string[];
}

type CommitTraceability =
  | { kind: 'task'; taskId: string; runId: string }
  | { kind: 'service'; runId: string; serviceIds: string[] };

type GitOperation = 'add' | 'commit' | 'read_head' | 'read_branch' | 'read_committed_files';

interface GitOperationContext {
  runId: string;
  serviceId: string;
  repositoryRoot: string;
  operation: GitOperation;
  files?: readonly string[];
}

export interface ExecuteCanonicalCommitInput {
  run: Run;
  payload: LocalCommitPromptPayload;
  liveFiles: readonly string[];
  message: string | null;
  commitReportTool: CommitReportTool;
  logger: ServerLogger;
}

const git = async (repoPath: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd: repoPath,
    maxBuffer: MAX_GIT_BUFFER,
  });
  return stdout.trim();
};

const runGitOperation = async <Result>(
  logger: ServerLogger,
  context: GitOperationContext,
  operation: () => Promise<Result>,
): Promise<Result> => {
  logger.debug('local.commit_runtime.git_operation_started', { ...context });
  try {
    const result = await operation();
    logger.debug('local.commit_runtime.git_operation_succeeded', { ...context });
    return result;
  } catch (error) {
    logger.error('local.commit_runtime.git_operation_failed', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const readCommittedFiles = async (repoPath: string, hash: string): Promise<string[]> => {
  const { stdout } = await execFileAsync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '--root', '-r', '-z', hash],
    {
      cwd: repoPath,
      maxBuffer: MAX_GIT_BUFFER,
    },
  );

  return stdout
    .split('\0')
    .filter((file) => file.length > 0)
    .sort();
};

const getServiceWorkspaces = (run: Run) =>
  run.session.services.map((service) => {
    const worktree = run.session.worktreeState?.[service.id];
    return {
      serviceId: service.id,
      configuredRepositoryRoot: service.path,
      activeRepositoryRoot: worktree?.worktreePath ?? service.path,
      worktreeBranch: worktree?.branch ?? null,
    };
  });

const buildScopes = (
  run: Run,
  liveFiles: readonly string[],
  logger: ServerLogger,
): ServiceCommitScope[] => {
  const services = new Map(run.session.services.map((service) => [service.id, service.path]));
  const canonicalKeys = new Set<string>();
  const scopes = new Map<string, ServiceCommitScope>();
  const canonicalFiles = run.getFileChangeProjection().map((projection) => ({
    serviceId: projection.serviceId,
    repoRelativePath: projection.repoRelativePath,
    canonicalKey: canonicalFileChangeKey(projection.serviceId, projection.repoRelativePath),
  }));

  logger.debug('local.commit_runtime.canonical_scope_loaded', {
    runId: run.runId,
    canonicalFiles,
    serviceWorkspaces: getServiceWorkspaces(run),
  });

  for (const projection of run.getFileChangeProjection()) {
    if (!services.has(projection.serviceId)) {
      logger.warn('local.commit_runtime.canonical_projection_service_unavailable', {
        runId: run.runId,
        serviceId: projection.serviceId,
        repoRelativePath: projection.repoRelativePath,
        serviceWorkspaces: getServiceWorkspaces(run),
      });
      throw new Error(
        `Commit validation failed: canonical Run facts reference unavailable service ${projection.serviceId}.`,
      );
    }
    if (!resolveProjectedFilePath(run.session, projection)) {
      logger.warn('local.commit_runtime.canonical_projection_path_invalid', {
        runId: run.runId,
        serviceId: projection.serviceId,
        repoRelativePath: projection.repoRelativePath,
        canonicalKey: canonicalFileChangeKey(projection.serviceId, projection.repoRelativePath),
      });
      throw new Error(
        `Commit validation failed: canonical Run fact has an invalid path for service ${projection.serviceId}: ${projection.repoRelativePath}.`,
      );
    }
    canonicalKeys.add(canonicalFileChangeKey(projection.serviceId, projection.repoRelativePath));
  }

  for (const liveFile of liveFiles) {
    logger.debug('local.commit_runtime.live_file_resolution_started', {
      runId: run.runId,
      liveFile: path.resolve(liveFile),
    });
    const resolved = resolveRunFilePath(run.session, liveFile);
    if (!resolved) {
      logger.warn('local.commit_runtime.live_file_resolution_failed', {
        runId: run.runId,
        liveFile: path.resolve(liveFile),
        serviceWorkspaces: getServiceWorkspaces(run),
      });
      throw new Error(
        `Commit validation failed: live changed file is outside the selected service workspaces: ${path.resolve(liveFile)}.`,
      );
    }
    const key = canonicalFileChangeKey(resolved.serviceId, resolved.repoRelativePath);
    const canonicalMatch = canonicalKeys.has(key);
    logger.debug('local.commit_runtime.live_file_canonical_membership_checked', {
      runId: run.runId,
      liveFile: resolved.absolutePath,
      serviceId: resolved.serviceId,
      repositoryRoot: resolved.repositoryRoot,
      repoRelativePath: resolved.repoRelativePath,
      canonicalKey: key,
      canonicalMatch,
    });
    if (!canonicalMatch) {
      logger.warn('local.commit_runtime.live_file_missing_from_canonical_scope', {
        runId: run.runId,
        liveFile: resolved.absolutePath,
        serviceId: resolved.serviceId,
        repositoryRoot: resolved.repositoryRoot,
        repoRelativePath: resolved.repoRelativePath,
        canonicalKey: key,
      });
      throw new Error(
        `Commit validation failed: live changed file was not present in canonical Run facts for service ${resolved.serviceId}: ${resolved.absolutePath}.`,
      );
    }

    const existingScope = scopes.get(resolved.serviceId);
    if (existingScope && existingScope.repoPath !== resolved.repositoryRoot) {
      logger.warn('local.commit_runtime.service_workspace_inconsistent', {
        runId: run.runId,
        serviceId: resolved.serviceId,
        firstRepositoryRoot: existingScope.repoPath,
        conflictingRepositoryRoot: resolved.repositoryRoot,
        liveFile: resolved.absolutePath,
      });
      throw new Error(
        `Commit validation failed: service ${resolved.serviceId} resolved to inconsistent active workspace roots.`,
      );
    }
    const scope = existingScope ?? {
      serviceId: resolved.serviceId,
      repoPath: resolved.repositoryRoot,
      files: [],
    };
    scope.files.push(resolved.repoRelativePath);
    scopes.set(resolved.serviceId, scope);
  }

  const resolvedScopes = [...scopes.values()]
    .map((scope) => ({ ...scope, files: [...new Set(scope.files)].sort() }))
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));
  logger.debug('local.commit_runtime.commit_scopes_resolved', {
    runId: run.runId,
    scopes: resolvedScopes.map((scope) => ({
      serviceId: scope.serviceId,
      repositoryRoot: scope.repoPath,
      files: scope.files,
    })),
  });
  return resolvedScopes;
};

const deriveCommitTraceability = (
  run: Run,
  payload: LocalCommitPromptPayload,
): CommitTraceability => {
  if (payload.codingSessionId && payload.codingSessionId !== run.runId) {
    throw new Error(
      'Commit validation failed: caller coding-session identifier disagrees with Run context.',
    );
  }

  if (run.taskId) {
    if (payload.taskId && payload.taskId !== run.taskId) {
      throw new Error(
        'Commit validation failed: caller task identifier disagrees with Run context.',
      );
    }
    return { kind: 'task', taskId: run.taskId, runId: run.runId };
  }

  if (payload.taskId) {
    throw new Error(
      'Commit validation failed: taskless Run cannot accept caller task traceability.',
    );
  }

  const serviceIds = [...new Set(run.session.services.map(({ id }) => id))].sort();
  const subject = run.entity;
  if (
    subject?.entityType !== 'SERVICE' ||
    !serviceIds.includes(subject.entityId) ||
    !run.session.launchServiceId ||
    !serviceIds.includes(run.session.launchServiceId)
  ) {
    throw new Error(
      'Commit validation failed: the taskless Run has no valid Service execution scope.',
    );
  }

  return { kind: 'service', runId: run.runId, serviceIds };
};

const buildCommitTrailers = (
  traceability: CommitTraceability,
  serviceId: string,
  planId: string | undefined,
): string[] => [
  ...(traceability.kind === 'task' ? [`Task-Id: ${traceability.taskId}`] : []),
  ...(planId ? [`Plan-Id: ${planId}`] : []),
  `Coding-Session-Id: ${traceability.runId}`,
  ...(traceability.kind === 'service' ? [`Service-Id: ${serviceId}`] : []),
];

const executeValidatedCommit = async (input: ExecuteCanonicalCommitInput): Promise<void> => {
  const { run, payload, liveFiles, message, commitReportTool, logger } = input;
  logger.debug('local.commit_runtime.validation_started', {
    runId: run.runId,
    liveFileCount: liveFiles.length,
    canonicalFileCount: run.getFileChangeProjection().length,
  });

  if (!message) {
    throw new Error(
      'Commit validation failed: commit agent did not submit a typed message result.',
    );
  }
  const traceability = deriveCommitTraceability(run, payload);
  logger.debug('local.commit_runtime.traceability_derived', {
    runId: run.runId,
    traceabilityKind: traceability.kind,
    ...(traceability.kind === 'task'
      ? { taskId: traceability.taskId }
      : { serviceIds: traceability.serviceIds }),
  });
  const scopes = buildScopes(run, liveFiles, logger);
  if (scopes.length === 0) {
    throw new Error('Commit validation failed: no uncommitted canonical Run files remain.');
  }
  logger.info('local.commit_runtime.validation_succeeded', {
    runId: run.runId,
    services: scopes.map((scope) => ({ serviceId: scope.serviceId, files: scope.files })),
  });

  const planId = run.session.contextMetadata.launchPlanId;

  const commits: Array<{ service: string; hash: string; branch: string; files: string[] }> = [];
  for (const scope of scopes) {
    const trailers = buildCommitTrailers(traceability, scope.serviceId, planId);
    logger.info('local.commit_runtime.staging_started', {
      runId: run.runId,
      serviceId: scope.serviceId,
      repositoryRoot: scope.repoPath,
      files: scope.files,
    });
    const context = {
      runId: run.runId,
      serviceId: scope.serviceId,
      repositoryRoot: scope.repoPath,
      files: scope.files,
    };
    await runGitOperation(logger, { ...context, operation: 'add' }, () =>
      git(scope.repoPath, ['add', '--', ...scope.files]),
    );
    await runGitOperation(logger, { ...context, operation: 'commit' }, () =>
      git(scope.repoPath, [
        'commit',
        '--only',
        '-m',
        message,
        '-m',
        trailers.join('\n'),
        '--',
        ...scope.files,
      ]),
    );
    const hash = await runGitOperation(logger, { ...context, operation: 'read_head' }, () =>
      git(scope.repoPath, ['rev-parse', '--short', 'HEAD']),
    );
    // Traceability only: the branch name is recorded, never the (machine-local) repoPath.
    const branch = await runGitOperation(logger, { ...context, operation: 'read_branch' }, () =>
      git(scope.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    );
    const committedFiles = await runGitOperation(
      logger,
      { ...context, operation: 'read_committed_files' },
      () => readCommittedFiles(scope.repoPath, hash),
    );
    commits.push({ service: scope.serviceId, hash, branch, files: committedFiles });
    logger.info('local.commit_runtime.commit_succeeded', {
      runId: run.runId,
      serviceId: scope.serviceId,
      hash,
      branch,
      files: committedFiles,
    });
  }

  const hashes = commits.map(({ service, hash, branch }) => ({ service, hash, branch }));
  const files = commits.flatMap(({ files: committedFiles }) => committedFiles);
  await commitReportTool.execute({
    runId: run.runId,
    run,
    args: { summary: message, files, hashes },
  });
  logger.info('local.commit_runtime.report_succeeded', {
    runId: run.runId,
    hashes,
    fileCount: files.length,
  });
};

export const executeCanonicalCommit = async (input: ExecuteCanonicalCommitInput): Promise<void> => {
  try {
    await executeValidatedCommit(input);
  } catch (error) {
    input.logger.error('local.commit_runtime.failed', {
      runId: input.run.runId,
      error: error instanceof Error ? error.message : String(error),
      liveFileCount: input.liveFiles.length,
      canonicalFileCount: input.run.getFileChangeProjection().length,
      serviceWorkspaces: getServiceWorkspaces(input.run),
    });
    throw error;
  }
};
