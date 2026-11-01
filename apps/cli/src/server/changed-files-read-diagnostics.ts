import { createHash } from 'node:crypto';
import path from 'node:path';
import { RunReadPreparationError } from './run-read-preparation-error';
import type { AgenticSession } from '../session/types';

export type ChangedFilesReadPhase = 'restore' | 'reuse' | 'membership_seed' | 'normal_read';

type ChangedFilesWorkspaceSource = 'active_worktree' | 'service_directory' | 'process_cwd';

type ChangedFilesSessionKind = 'graph_only' | 'service_bound' | 'cross_service_review' | 'unknown';

export type ChangedFilesWorkspaceResolutionStatus =
  | 'resolved'
  | 'missing'
  | 'invalid'
  | 'unavailable'
  | 'failed';

export type ChangedFilesFailureClassification =
  | 'NOT_A_REPOSITORY'
  | 'GIT_EXECUTABLE_NOT_FOUND'
  | 'GIT_PERMISSION_DENIED'
  | 'GIT_COMMAND_FAILED'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_UNAVAILABLE'
  | 'INVALID_REPOSITORY_PATH'
  | 'REPOSITORY_NOT_FOUND'
  | 'INVALID_FILE_MEMBERSHIP'
  | 'RUN_NOT_FOUND'
  | 'RUN_ID_MISMATCH'
  | 'INVALID_RUN_CONTEXT'
  | 'SERVICE_NOT_FOUND'
  | 'MEMBERSHIP_READ_FAILED'
  | 'READ_FAILED';

export interface ChangedFilesWorkspaceDiagnostic {
  workspaceSource: ChangedFilesWorkspaceSource;
  workspaceIdentifier: string;
  sessionKind: ChangedFilesSessionKind;
  workspaceResolutionStatus: ChangedFilesWorkspaceResolutionStatus;
  serviceId: string | null;
  repositoryIdentity: string | null;
  worktreeIdentity: string | null;
  gitRootDetected: boolean | null;
  gitRootIdentity: string | null;
}

export interface ChangedFilesFailureDetails {
  workspace: ChangedFilesWorkspaceDiagnostic;
  exitCode: number | null;
  failureClassification: ChangedFilesFailureClassification;
}

export interface ChangedFilesReadFailureDiagnostic {
  requestId: string;
  agentSessionId: string;
  runId: string;
  operation: 'run.changed_files.count' | 'run.changed_files.inventory' | 'run.changed_files.detail';
  readPhase: ChangedFilesReadPhase;
  sessionKind: ChangedFilesSessionKind;
  workspaceSource: ChangedFilesWorkspaceSource;
  workspaceIdentifier: string;
  workspaceResolutionStatus: ChangedFilesWorkspaceResolutionStatus;
  serviceId: string | null;
  repositoryIdentity: string | null;
  worktreeIdentity: string | null;
  gitRootDetected: boolean | null;
  gitRootIdentity: string | null;
  exitCode: number | null;
  failureClassification: ChangedFilesFailureClassification;
  errorName: string;
  promptType: string | null;
}

const stableIdentity = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

export const stableWorkspaceIdentity = (workspacePath: string | null | undefined): string =>
  stableIdentity(path.resolve(workspacePath?.trim() || process.cwd()));

const isCrossServiceReview = (session: AgenticSession): boolean =>
  session.scope?.mode === 'cross_service_review';

const getChangedFilesSessionKind = (session: AgenticSession | null): ChangedFilesSessionKind => {
  if (!session) return 'unknown';
  if (session.services.length === 0) return 'graph_only';
  if (isCrossServiceReview(session)) return 'cross_service_review';
  return 'service_bound';
};

const serviceWorktree = (session: AgenticSession | null, serviceId: string | null) => {
  if (!session || !serviceId || !session.worktreeState) return null;
  return session.worktreeState[serviceId] ?? null;
};

export const createChangedFilesWorkspaceDiagnostic = (input: {
  session: AgenticSession | null;
  serviceId?: string | null;
  repoPath?: string | null;
  workspaceResolutionStatus?: ChangedFilesWorkspaceResolutionStatus;
  gitRootPath?: string | null;
}): ChangedFilesWorkspaceDiagnostic => {
  const { session, serviceId = null, repoPath = null } = input;
  const service = session?.services.find((entry) => entry.id === serviceId) ?? null;
  const worktree = serviceWorktree(session, serviceId);
  const resolvedRepoPath = repoPath?.trim() || null;
  const worktreePath = worktree?.worktreePath?.trim() || null;
  const workspacePath = resolvedRepoPath ?? worktreePath ?? service?.path.trim() ?? null;
  const usesWorktree = Boolean(
    worktreePath &&
    resolvedRepoPath &&
    path.resolve(worktreePath) === path.resolve(resolvedRepoPath),
  );
  const workspaceSource: ChangedFilesWorkspaceSource = usesWorktree
    ? 'active_worktree'
    : service
      ? 'service_directory'
      : 'process_cwd';
  const workspaceIdentifier = stableWorkspaceIdentity(workspacePath);
  const repositoryPath = worktree?.repoPath?.trim() || resolvedRepoPath || service?.path.trim();

  return {
    workspaceSource,
    workspaceIdentifier,
    sessionKind: getChangedFilesSessionKind(session),
    workspaceResolutionStatus: input.workspaceResolutionStatus ?? 'resolved',
    serviceId,
    repositoryIdentity: repositoryPath ? stableWorkspaceIdentity(repositoryPath) : null,
    worktreeIdentity: worktreePath ? stableWorkspaceIdentity(worktreePath) : null,
    gitRootDetected: input.gitRootPath === undefined ? null : input.gitRootPath !== null,
    gitRootIdentity: input.gitRootPath ? stableWorkspaceIdentity(input.gitRootPath) : null,
  };
};

const readErrorCode = (error: Error): string | number | null => {
  if (!('code' in error)) return null;
  return typeof error.code === 'string' || typeof error.code === 'number' ? error.code : null;
};

const readErrorStderr = (error: Error): string => {
  if (!('stderr' in error)) return '';
  return typeof error.stderr === 'string' ? error.stderr : '';
};

export const getChangedFilesExitCode = (error: Error): number | null => {
  const code = readErrorCode(error);
  return typeof code === 'number' ? code : null;
};

export const classifyChangedFilesFailure = (
  error: Error,
  fallback: ChangedFilesFailureClassification = 'READ_FAILED',
): ChangedFilesFailureClassification => {
  const code = readErrorCode(error);
  const detail = `${error.message} ${readErrorStderr(error)}`.toLowerCase();
  if (detail.includes('not a git repository')) return 'NOT_A_REPOSITORY';
  if (code === 'ENOENT' && detail.includes('git')) return 'GIT_EXECUTABLE_NOT_FOUND';
  if (code === 'EACCES' || code === 'EPERM') return 'GIT_PERMISSION_DENIED';
  if (typeof code === 'number') return 'GIT_COMMAND_FAILED';
  return fallback;
};

export const getChangedFilesFailureClassification = (
  error: Error,
): ChangedFilesFailureClassification => {
  if ('code' in error) {
    const code = error.code;
    if (code === 'REPOSITORY_NOT_FOUND') return 'REPOSITORY_NOT_FOUND';
    if (code === 'INVALID_FILE_MEMBERSHIP') return 'INVALID_FILE_MEMBERSHIP';
    if (code === 'INVALID_REPOSITORY_PATH') return 'INVALID_REPOSITORY_PATH';
    if (code === 'RUN_NOT_FOUND') return 'RUN_NOT_FOUND';
    if (code === 'RUN_ID_MISMATCH') return 'RUN_ID_MISMATCH';
    if (code === 'INVALID_RUN_CONTEXT') return 'INVALID_RUN_CONTEXT';
    if (code === 'SERVICE_NOT_FOUND') return 'SERVICE_NOT_FOUND';
    if (code === 'READ_FAILED') return 'READ_FAILED';
  }
  return classifyChangedFilesFailure(error);
};

export const safeChangedFilesErrorName = (error: Error): string => error.name || 'Error';

/** Only include structured preparation details; messages may contain private paths. */
export const safeRunReadPreparationDetails = (error: Error) =>
  error instanceof RunReadPreparationError
    ? {
        errorCode: error.code,
        ...(error.cause !== undefined
          ? {
              causeErrorName:
                error.cause instanceof Error ? safeChangedFilesErrorName(error.cause) : 'NonError',
            }
          : {}),
      }
    : {};
