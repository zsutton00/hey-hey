import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import type { ReportedChangedFile } from '../agents/completion-reconciliation/schemas';
import { getGitDiff, listGitChangedFilePaths } from '../git/index';
import type { AgenticSession } from '../session/types';

type FileChangeProvider = 'claude' | 'codex' | 'opencode';

export interface ResolvedRunFilePath {
  serviceId: string;
  repositoryRoot: string;
  absolutePath: string;
  repoRelativePath: string;
}

type CanonicalFileChangeEvidence =
  | {
      kind: 'patch';
      diff: string;
      preContent: string | null;
      postContent: string | null;
    }
  | {
      kind: 'baseline';
      diff: string;
      baselineContent: string | null;
      postContent: string | null;
    };

export interface FileChangeEvidenceCapture {
  evidence: CanonicalFileChangeEvidence;
  source: 'git_diff' | 'provider_baseline';
  gitDiffError: string | null;
}

export interface CanonicalFileChangeFact {
  attributionSource?: 'provider_event' | 'agent_report' | undefined;
  executionRoot?: string | undefined;
  factId: string;
  runId: string;
  turnId: string;
  provider: FileChangeProvider;
  providerSessionId: string;
  providerThreadId: string | null;
  providerTurnId: string | null;
  serviceId: string;
  repoRelativePath: string;
  occurredAt: string;
  evidence: CanonicalFileChangeEvidence;
}

export interface CanonicalFileChangeCandidate {
  runId: string;
  provider: FileChangeProvider;
  providerSessionId: string | null;
  providerThreadId: string | null;
  providerTurnId: string | null;
  paths: string[];
  occurredAt: string;
  providerPatch: string | null;
}

export interface StagedFileChange {
  toolUseId: string;
  candidate: CanonicalFileChangeCandidate;
}

export interface FileChangeProjection {
  serviceId: string;
  repoRelativePath: string;
}

export interface ServiceFileChangeProjection {
  serviceId: string;
  filesChanged: string[];
}

export const canonicalFileChangeKey = (serviceId: string, repoRelativePath: string): string =>
  `${serviceId}\u0000${repoRelativePath.split(path.sep).join('/')}`;

const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('patch'),
    diff: z.string(),
    preContent: z.string().nullable(),
    postContent: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('baseline'),
    diff: z.string(),
    baselineContent: z.string().nullable(),
    postContent: z.string().nullable(),
  }),
]);

const factSchema = z.object({
  attributionSource: z.enum(['provider_event', 'agent_report']).optional(),
  executionRoot: z.string().optional(),
  factId: z.string().min(1),
  runId: z.string().min(1),
  turnId: z.string().min(1),
  provider: z.enum(['claude', 'codex', 'opencode']),
  providerSessionId: z.string().min(1),
  providerThreadId: z.string().nullable(),
  providerTurnId: z.string().nullable(),
  serviceId: z.string().min(1),
  repoRelativePath: z.string().min(1),
  occurredAt: z.string().min(1),
  evidence: evidenceSchema,
});

const persistedFactsSchema = z.object({
  version: z.literal(1),
  facts: z.array(factSchema),
});

export const parsePersistedFileChangeFacts = (value: unknown): CanonicalFileChangeFact[] =>
  persistedFactsSchema.parse(value).facts;

const isWithinRoot = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const selectedRootForService = (
  session: AgenticSession,
  serviceId: string,
  repositoryPath: string,
): string => {
  const worktree =
    session.worktreeState?.[serviceId] ??
    Object.values(session.worktreeState ?? {}).find(
      (entry) => path.resolve(entry.repoPath) === path.resolve(repositoryPath),
    );
  if (worktree) return path.resolve(worktree.worktreePath);
  return path.resolve(repositoryPath);
};

export const resolveRunServiceRoots = (
  session: AgenticSession,
): Array<{ serviceId: string; root: string }> =>
  session.services
    .filter((service) => service.id.trim().length > 0 && service.path.trim().length > 0)
    .map((service) => ({
      serviceId: service.id,
      root: selectedRootForService(session, service.id, service.path),
    }))
    .sort((left, right) => right.root.length - left.root.length);

export const resolveRunFilePath = (
  session: AgenticSession,
  candidatePath: string,
): ResolvedRunFilePath | null => {
  const trimmed = candidatePath.trim();
  if (trimmed.length === 0) return null;

  const roots = resolveRunServiceRoots(session);
  if (roots.length === 0) return null;

  let absolutePath: string;
  if (path.isAbsolute(trimmed)) {
    absolutePath = path.resolve(trimmed);
  } else {
    const launchRoot =
      roots.find((entry) => entry.serviceId === session.launchServiceId)?.root ?? roots[0]?.root;
    if (!launchRoot) return null;
    absolutePath = path.resolve(launchRoot, trimmed);
  }

  const owner = roots.find((entry) => isWithinRoot(absolutePath, entry.root));
  if (!owner) return null;

  const repoRelativePath = path.relative(owner.root, absolutePath).split(path.sep).join('/');
  if (
    repoRelativePath.length === 0 ||
    repoRelativePath.startsWith('../') ||
    path.posix.isAbsolute(repoRelativePath)
  ) {
    return null;
  }

  return {
    serviceId: owner.serviceId,
    repositoryRoot: owner.root,
    absolutePath,
    repoRelativePath,
  };
};

export const resolveProjectedFilePath = (
  session: AgenticSession,
  projection: FileChangeProjection,
): string | null => {
  const owner = resolveRunServiceRoots(session).find(
    (entry) => entry.serviceId === projection.serviceId,
  );
  if (!owner) return null;
  const absolutePath = path.resolve(owner.root, projection.repoRelativePath);
  return isWithinRoot(absolutePath, owner.root) ? absolutePath : null;
};

const readPostContent = async (absolutePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
};

export const captureFileChangeEvidence = async (
  resolved: ResolvedRunFilePath,
  providerPatch: string | null,
): Promise<FileChangeEvidenceCapture> => {
  let gitDiffError: string | null = null;
  try {
    const patches = await getGitDiff({
      repoPath: resolved.repositoryRoot,
      paths: [resolved.repoRelativePath],
    });
    const patch =
      patches.find((entry) => entry.filePath === resolved.repoRelativePath) ?? patches[0];
    if (patch) {
      return {
        evidence: {
          kind: 'patch',
          diff: patch.diff,
          preContent: patch.preContent ?? null,
          postContent: patch.postContent ?? null,
        },
        source: 'git_diff',
        gitDiffError,
      };
    }
  } catch (error) {
    gitDiffError = error instanceof Error ? error.message : String(error);
    // Provider evidence remains usable when git cannot be queried (for
    // example a just-created path or a transient repository state).
  }

  return {
    evidence: {
      kind: 'baseline',
      diff: providerPatch ?? '',
      baselineContent: null,
      postContent: await readPostContent(resolved.absolutePath),
    },
    source: 'provider_baseline',
    gitDiffError,
  };
};

type ReportedFileChangeRejectionReason =
  | 'unknown_service'
  | 'invalid_path'
  | 'git_read_failed'
  | 'not_changed_in_git'
  | 'absent_path'
  | 'untracked_clean_path'
  | 'ambiguous_correction'
  | 'uncorroborated_correction';

export interface ReportedFileChangeResolution {
  admitted: ResolvedRunFilePath[];
  corrected: Array<{ claim: ReportedChangedFile; path: string }>;
  rejected: Array<
    ReportedChangedFile & { reason: ReportedFileChangeRejectionReason; suggestion?: string }
  >;
}

export class ReportedFileChangeFailure extends Error {
  public constructor(public readonly reason: 'git_read_failed' | 'persistence_failed') {
    super(reason);
  }
}

const execFileAsync = promisify(execFile);
const listTrackedPaths = async (root: string): Promise<string[]> => {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
    cwd: root,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.split('\0').filter(Boolean);
};

/** Small spelling changes only; never use basename similarity across unrelated directories. */
export const isConservativePathCorrection = (claim: string, candidate: string): boolean => {
  const normalize = (value: string) =>
    value.replace(/(^|\/)__tests__(?=\/)/g, '$1tests').replace(/\.tsx$/, '.ts');
  const left = normalize(claim),
    right = normalize(candidate);
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 2) return false;
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[right.length]! <= Math.min(2, Math.floor(left.length / 8));
};

/**
 * Admits agent-reported paths that git currently shows as changed in the
 * reported service, using the same dirty-path read as the changed-files
 * endpoint. Unresolvable services, paths outside the service root and git
 * read failures fail closed.
 */
export const resolveReportedFileChanges = async (
  session: AgenticSession,
  reported: readonly ReportedChangedFile[],
  listChangedPaths: (repositoryRoot: string) => Promise<string[]> = listGitChangedFilePaths,
  corroborated: readonly (FileChangeProjection & { executionRoot?: string | undefined })[] = [],
  readTrackedPaths: (repositoryRoot: string) => Promise<string[]> = listTrackedPaths,
): Promise<ReportedFileChangeResolution> => {
  const roots = new Map(resolveRunServiceRoots(session).map((entry) => [entry.serviceId, entry]));
  const changedPathsByRoot = new Map<string, Promise<Set<string> | null>>();
  const admittedKeys = new Set<string>();
  const resolution: ReportedFileChangeResolution = { admitted: [], corrected: [], rejected: [] };

  for (const file of reported) {
    const owner = roots.get(file.serviceId);
    if (!owner) {
      resolution.rejected.push({ ...file, reason: 'unknown_service' });
      continue;
    }
    const resolved = path.isAbsolute(file.path)
      ? null
      : resolveRunFilePath(session, path.resolve(owner.root, file.path));
    if (!resolved || resolved.serviceId !== file.serviceId) {
      resolution.rejected.push({ ...file, reason: 'invalid_path' });
      continue;
    }
    const key = canonicalFileChangeKey(resolved.serviceId, resolved.repoRelativePath);
    if (admittedKeys.has(key)) continue;

    let changedPaths = changedPathsByRoot.get(resolved.repositoryRoot);
    if (!changedPaths) {
      changedPaths = listChangedPaths(resolved.repositoryRoot).then(
        (paths) => new Set(paths),
        () => null,
      );
      changedPathsByRoot.set(resolved.repositoryRoot, changedPaths);
    }
    const dirty = await changedPaths;
    if (dirty === null) {
      resolution.rejected.push({ ...file, reason: 'git_read_failed' });
    } else if (!dirty.has(resolved.repoRelativePath)) {
      let tracked: string[];
      try {
        tracked = await readTrackedPaths(resolved.repositoryRoot);
      } catch {
        resolution.rejected.push({ ...file, reason: 'git_read_failed' });
        continue;
      }
      if (tracked.includes(resolved.repoRelativePath)) {
        resolution.rejected.push({ ...file, reason: 'not_changed_in_git' });
        continue;
      }
      try {
        await fs.lstat(resolved.absolutePath);
        resolution.rejected.push({ ...file, reason: 'untracked_clean_path' });
        continue;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          resolution.rejected.push({ ...file, reason: 'git_read_failed' });
          continue;
        }
      }
      const candidates = [...dirty].filter((candidate) =>
        isConservativePathCorrection(resolved.repoRelativePath, candidate),
      );
      if (candidates.length !== 1) {
        resolution.rejected.push({
          ...file,
          reason: candidates.length > 1 ? 'ambiguous_correction' : 'absent_path',
        });
        continue;
      }
      const candidate = candidates[0]!;
      if (
        !corroborated.some(
          (evidence) =>
            evidence.serviceId === file.serviceId &&
            evidence.repoRelativePath === candidate &&
            evidence.executionRoot === resolved.repositoryRoot,
        )
      ) {
        resolution.rejected.push({
          ...file,
          reason: 'uncorroborated_correction',
          suggestion: candidate,
        });
        continue;
      }
      const corrected = resolveRunFilePath(session, path.resolve(owner.root, candidate));
      if (!corrected || corrected.serviceId !== file.serviceId) {
        resolution.rejected.push({ ...file, reason: 'invalid_path' });
        continue;
      }
      resolution.corrected.push({ claim: file, path: candidate });
      if (!admittedKeys.has(canonicalFileChangeKey(file.serviceId, candidate))) {
        resolution.admitted.push(corrected);
        admittedKeys.add(canonicalFileChangeKey(file.serviceId, candidate));
      }
    } else {
      admittedKeys.add(key);
      resolution.admitted.push(resolved);
    }
  }
  return resolution;
};

export const projectFileChanges = (
  facts: readonly CanonicalFileChangeFact[],
  turnId?: string,
): FileChangeProjection[] => {
  const keys = new Set<string>();
  const projection: FileChangeProjection[] = [];
  for (const fact of facts) {
    if (turnId !== undefined && fact.turnId !== turnId) continue;
    const key = canonicalFileChangeKey(fact.serviceId, fact.repoRelativePath);
    if (keys.has(key)) continue;
    keys.add(key);
    projection.push({ serviceId: fact.serviceId, repoRelativePath: fact.repoRelativePath });
  }
  return projection;
};

export const groupFileChangeProjectionsByService = (
  projections: readonly FileChangeProjection[],
): ServiceFileChangeProjection[] => {
  const byService = new Map<string, Set<string>>();
  for (const projection of projections) {
    const serviceFiles = byService.get(projection.serviceId) ?? new Set<string>();
    serviceFiles.add(projection.repoRelativePath);
    byService.set(projection.serviceId, serviceFiles);
  }
  return [...byService.entries()]
    .map(([serviceId, files]) => ({
      serviceId,
      filesChanged: [...files].sort(),
    }))
    .filter((entry) => entry.filesChanged.length > 0)
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));
};

export const latestFileChangeFacts = (
  facts: readonly CanonicalFileChangeFact[],
): CanonicalFileChangeFact[] => {
  const latest = new Map<string, CanonicalFileChangeFact>();
  for (const fact of facts) {
    latest.set(canonicalFileChangeKey(fact.serviceId, fact.repoRelativePath), fact);
  }
  return [...latest.values()];
};

const FILE_CHANGING_TOOLS = new Set([
  'write',
  'edit',
  'multiedit',
  'notebookedit',
  'write_file',
  'edit_file',
  'apply_patch',
  'patch',
]);

export const isFileChangingTool = (toolName: string): boolean =>
  FILE_CHANGING_TOOLS.has(toolName.trim().toLowerCase());

export const extractFilePathsFromToolInput = (
  toolName: string,
  input: Record<string, unknown>,
): string[] => {
  if (!isFileChangingTool(toolName)) return [];
  const candidates = [input['file_path'], input['filePath'], input['path'], input['file']];
  const paths = candidates.filter((value): value is string => typeof value === 'string');
  const edits = input['edits'];
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (typeof edit !== 'object' || edit === null) continue;
      const record = edit as Record<string, unknown>;
      const value = record['file_path'] ?? record['filePath'] ?? record['path'] ?? record['file'];
      if (typeof value === 'string') paths.push(value);
    }
  }
  return [...new Set(paths.map((value) => value.trim()).filter(Boolean))];
};
