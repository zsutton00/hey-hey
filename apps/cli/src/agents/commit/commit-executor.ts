import { execFile } from 'node:child_process';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { CommitGitError } from './commit-git-error';
import { isEntityConversationRun } from './commit-traceability';
import { randomUUID } from 'node:crypto';
import { resolveCommitIntent, type CommitIntent } from './commit-intent';

import type { LocalCommitPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type { ServerLogger } from '../../server/logger';
import {
  canonicalFileChangeKey,
  resolveProjectedFilePath,
  resolveRunFilePath,
} from '../../run/file-change-facts';
import type { Run } from '../../run/run';
import type { CommitReportTool } from '../submission-tools/create-commit-report-tool';

const MAX_GIT_BUFFER = 50 * 1024 * 1024;

interface ServiceCommitScope {
  serviceId: string;
  repoPath: string;
  files: string[];
}

type CommitTraceability =
  | { kind: 'task'; taskId: string; runId: string }
  | { kind: 'service'; runId: string; serviceIds: string[] };

type GitOperation =
  | 'read_workspace_prefix'
  | 'read_staged_deletions'
  | 'add'
  | 'commit'
  | 'read_branch';

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

const git = (
  repoPath: string,
  args: readonly string[],
  trim = true,
  intentId?: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--literal-pathspecs', ...(intentId ? ['-c', 'core.logAllRefUpdates=always'] : []), ...args],
      {
        cwd: repoPath,
        ...(intentId ? { env: { ...process.env, GIT_REFLOG_ACTION: intentId } } : {}),
        maxBuffer: MAX_GIT_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Do not include execFile's message: it contains the full command, including
          // the generated commit message. Git's stderr supplies the operation's reason.
          reject(
            new CommitGitError(
              args[0] ?? 'unknown',
              stderr.trim() || `Git exited with code ${error.code}.`,
            ),
          );
          return;
        }
        resolve(trim ? stdout.trim() : stdout);
      },
    );
  });

const filesToStage = async (scope: ServiceCommitScope): Promise<string[]> => {
  const deleted = new Set(
    (
      await git(
        scope.repoPath,
        [
          'diff',
          '--cached',
          '--diff-filter=D',
          '--no-renames',
          '--name-only',
          '-z',
          '--',
          ...scope.files,
        ],
        false,
      )
    ).split('\0'),
  );
  const files: string[] = [];
  for (const file of scope.files) {
    if (deleted.has(file)) {
      try {
        await lstat(path.join(scope.repoPath, file));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }
    files.push(file);
  }
  return files;
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

  const entityConversation = isEntityConversationRun(run);
  if (run.taskId && !entityConversation) {
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
  const subjectInScope = entityConversation
    ? true
    : subject?.entityType === 'SERVICE' && serviceIds.includes(subject.entityId);
  if (
    !subjectInScope ||
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

async function finishCommitIntent(run: Run, intent: CommitIntent) {
  const outcome = await resolveCommitIntent(run.session, intent);
  if (!outcome) {
    return false;
  }
  const pending = run.reportProvenance.pending;
  if (
    !pending?.hashes.some(
      (entry) => entry.service === intent.service && entry.hash === outcome.hash,
    )
  ) {
    await run.reportProvenance.retain({
      summary: intent.summary,
      files: [...(pending?.files ?? []), ...outcome.files],
      hashes: [
        ...(pending?.hashes ?? []),
        {
          service: intent.service,
          branch: intent.branch,
          hash: outcome.hash,
          implementReportIds: intent.implementReportIds,
        },
      ],
    });
  }
  await run.saveCommitState(null, outcome.versions);
  return true;
}

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
    entityConversation: isEntityConversationRun(run),
    launchServiceId: run.session.launchServiceId ?? null,
    ...(traceability.kind === 'task'
      ? { taskId: traceability.taskId }
      : { serviceIds: traceability.serviceIds }),
  });
  const versions = run.captureFileChangeVersions();
  const scopes = buildScopes(run, liveFiles, logger);
  if (scopes.length === 0) {
    throw new Error('Commit validation failed: no uncommitted canonical Run files remain.');
  }
  logger.info('local.commit_runtime.validation_succeeded', {
    runId: run.runId,
    services: scopes.map((scope) => ({ serviceId: scope.serviceId, files: scope.files })),
  });

  const planId = run.session.contextMetadata.launchPlanId;

  const chain = run.readReportChain();
  const claimed = new Set(
    chain
      .filter((entry) => entry.sourceRunId === run.runId && entry.reportType === 'COMMIT')
      .flatMap(
        (entry) => entry.commitHashes?.flatMap((hash) => hash.implementReportIds ?? []) ?? [],
      ),
  );
  let commitFailure: unknown;
  try {
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
      const prefix = await runGitOperation(
        logger,
        { ...context, operation: 'read_workspace_prefix' },
        async () =>
          (await git(scope.repoPath, ['rev-parse', '--show-prefix'], false)).replace(/\n$/, ''),
      );
      const stagingFiles = await runGitOperation(
        logger,
        { ...context, operation: 'read_staged_deletions' },
        () => filesToStage(scope),
      );
      if (stagingFiles.length > 0) {
        await runGitOperation(logger, { ...context, operation: 'add' }, () =>
          git(scope.repoPath, ['add', '--', ...stagingFiles]),
        );
      }
      const branch = await git(scope.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(
        async (error) => {
          // An unborn branch has a symbolic HEAD but no commit to resolve.
          if (!(error instanceof CommitGitError)) {
            throw error;
          }
          return git(scope.repoPath, ['symbolic-ref', '--short', 'HEAD']);
        },
      );
      const intent: CommitIntent = {
        id: randomUUID(),
        service: scope.serviceId,
        branch,
        prefix,
        summary: message,
        versions: Object.fromEntries(
          scope.files.map((file) => [
            file,
            versions.get(canonicalFileChangeKey(scope.serviceId, file)) ?? null,
          ]),
        ),
        implementReportIds: [
          ...new Set(
            chain
              .filter(
                (entry) =>
                  entry.reportType === 'IMPLEMENT' &&
                  entry.sourceRunId === run.runId &&
                  entry.serviceId === scope.serviceId &&
                  !claimed.has(entry.reportId),
              )
              .map((entry) => entry.reportId),
          ),
        ],
      };
      await run.saveCommitState(intent);
      trailers.push(`Hey-Hey-Commit-Id: ${intent.id}`);
      try {
        await runGitOperation(logger, { ...context, operation: 'commit' }, () =>
          git(
            scope.repoPath,
            ['commit', '--only', '-m', message, '-m', trailers.join('\n'), '--', ...scope.files],
            true,
            intent.id,
          ),
        );
      } catch (error) {
        if (!(await finishCommitIntent(run, intent))) {
          await run.saveCommitState(null);
        }
        throw error;
      }
      if (!(await finishCommitIntent(run, intent))) {
        throw new Error(`Git succeeded but commit intent ${intent.id} could not be resolved`);
      }
      logger.info('local.commit_runtime.commit_succeeded', {
        ...context,
        branch,
        hash: run.reportProvenance.pending?.hashes.at(-1)?.hash,
      });
    }
  } catch (error) {
    commitFailure = error;
  }
  const pending = run.reportProvenance.pending;
  if (!pending || run.session.commitIntent) {
    throw commitFailure;
  }
  const { hashes, files } = pending;
  try {
    await commitReportTool.execute({
      runId: run.runId,
      run,
      args: { summary: message, files, hashes },
    });
  } catch (error) {
    logger.error('local.commit_runtime.report_failed', {
      runId: run.runId,
      hashes,
      files,
      summary: message,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (commitFailure) {
    throw commitFailure;
  }
  logger.info('local.commit_runtime.report_succeeded', {
    runId: run.runId,
    hashes,
    fileCount: files.length,
  });
};

export const executeCanonicalCommit = async (input: ExecuteCanonicalCommitInput): Promise<void> => {
  try {
    await input.run.ensureSeeded();
    const intent = input.run.session.commitIntent;
    if (intent && !(await finishCommitIntent(input.run, intent))) {
      await input.run.saveCommitState(null);
    }
    const pending = input.run.reportProvenance.pending;
    if (pending) {
      await input.commitReportTool.execute({
        runId: input.run.runId,
        run: input.run,
        args: pending,
      });
      return;
    }
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
