import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  NotARepositoryError,
  RepoDiscoveryError,
  RepoPathNotDirectoryError,
  RepoPathNotFoundError,
  RepoPathNotReadableError,
} from './errors';
import type {
  DiscoverRepositoriesOptions,
  RepositoryPath,
  RepositoryCandidate,
  RepositoryMarker,
  ResolveRepositoryPathOptions,
  ResolvedRepositoryPath,
} from './types';
import { REPOSITORY_MARKERS, toRepositoryPath } from './types';

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo']);
const DEFAULT_DISCOVERY_DEPTH = 2;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === 'object' && error !== null && 'code' in error;

const isRepositoryMarker = (value: string): value is RepositoryMarker =>
  REPOSITORY_MARKERS.includes(value as RepositoryMarker);

const detectMarkers = async (directory: string): Promise<RepositoryMarker[]> => {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
      return [];
    }
    throw error;
  }

  return entries.filter(isRepositoryMarker);
};

const detectGitRoot = async (cwd: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 2_000,
    });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if (!isNodeError(error)) {
      return null;
    }

    if (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EACCES') {
      return null;
    }

    return null;
  }
};

export const resolveCanonicalDirectory = async (
  inputPath: string,
  options: ResolveRepositoryPathOptions = {},
): Promise<RepositoryPath> => {
  const cwd = options.cwd ?? process.cwd();
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      throw new RepoPathNotDirectoryError(`Selected path is not a directory: ${absolutePath}`);
    }
  } catch (error) {
    if (error instanceof RepoPathNotDirectoryError) {
      throw error;
    }
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new RepoPathNotFoundError(`Selected directory does not exist: ${absolutePath}`);
    }
    if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new RepoPathNotReadableError(
        `Selected directory is not readable and traversable: ${absolutePath}`,
      );
    }
    throw new RepoDiscoveryError(`Failed to inspect selected directory: ${absolutePath}`, error);
  }

  try {
    await fs.access(absolutePath, fs.constants.R_OK | fs.constants.X_OK);
  } catch (error) {
    throw new RepoPathNotReadableError(
      `Selected directory is not readable and traversable: ${absolutePath}`,
      error,
    );
  }

  try {
    return toRepositoryPath(await fs.realpath(absolutePath));
  } catch (error) {
    throw new RepoDiscoveryError(
      `Failed to resolve the canonical selected directory: ${absolutePath}`,
      error,
    );
  }
};

export const resolveRepositoryPath = async (
  inputPath: string,
  options: ResolveRepositoryPathOptions = {},
): Promise<ResolvedRepositoryPath> => {
  const canonicalInput = await resolveCanonicalDirectory(inputPath, options);

  const [gitRoot, localMarkers] = await Promise.all([
    detectGitRoot(canonicalInput),
    detectMarkers(canonicalInput),
  ]);

  const canonicalGitRoot = gitRoot ? await fs.realpath(gitRoot) : null;
  if (localMarkers.length > 0) {
    return {
      canonicalPath: toRepositoryPath(canonicalInput),
      hasGitRoot: canonicalGitRoot !== null,
      markers: localMarkers,
    };
  }

  const rootPath = canonicalGitRoot ?? canonicalInput;
  const rootMarkers = await detectMarkers(rootPath);

  if (!canonicalGitRoot && rootMarkers.length === 0) {
    throw new NotARepositoryError(
      `Path is not a repository (no git root or known language markers): ${canonicalInput}`,
    );
  }

  return {
    canonicalPath: toRepositoryPath(rootPath),
    hasGitRoot: canonicalGitRoot !== null,
    markers: rootMarkers,
  };
};

const clampConfidence = (value: number): number => Math.max(0, Math.min(0.99, value));

const scoreCandidate = (hasGitRoot: boolean, markers: RepositoryMarker[]): number => {
  const markerBoost = Math.min(markers.length, 3) * 0.08;
  return clampConfidence((hasGitRoot ? 0.75 : 0.35) + markerBoost);
};

const scanDirectories = async (root: string, maxDepth: number): Promise<string[]> => {
  const result: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    result.push(next.dir);

    if (next.depth >= maxDepth) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(next.dir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      queue.push({ dir: path.join(next.dir, entry.name), depth: next.depth + 1 });
    }
  }

  return result;
};

export const discoverRepositories = async (
  options: DiscoverRepositoriesOptions = {},
): Promise<RepositoryCandidate[]> => {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? DEFAULT_DISCOVERY_DEPTH;

  const canonicalCwd = await resolveCanonicalDirectory(cwd, { cwd });
  const directories = await scanDirectories(canonicalCwd, maxDepth);

  const candidates = new Map<string, { hasGitRoot: boolean; markers: Set<RepositoryMarker> }>();

  for (const directory of directories) {
    const [gitRoot, markers] = await Promise.all([
      detectGitRoot(directory),
      detectMarkers(directory),
    ]);

    if (markers.length > 0) {
      const existing = candidates.get(directory) ?? {
        hasGitRoot: false,
        markers: new Set<RepositoryMarker>(),
      };
      markers.forEach((marker) => existing.markers.add(marker));
      candidates.set(directory, existing);
    }

    if (!gitRoot) {
      continue;
    }

    const canonicalGitRoot = await fs.realpath(gitRoot);
    const isWithinDiscoveryRoot =
      canonicalGitRoot === canonicalCwd ||
      canonicalGitRoot.startsWith(`${canonicalCwd}${path.sep}`);

    if (!isWithinDiscoveryRoot) {
      continue;
    }

    if (canonicalGitRoot === directory) {
      const existing = candidates.get(canonicalGitRoot) ?? {
        hasGitRoot: true,
        markers: new Set<RepositoryMarker>(),
      };
      const rootMarkers = await detectMarkers(canonicalGitRoot);
      rootMarkers.forEach((marker) => existing.markers.add(marker));
      existing.hasGitRoot = true;
      candidates.set(canonicalGitRoot, existing);
    } else if (markers.length === 0) {
      const existing = candidates.get(canonicalGitRoot) ?? {
        hasGitRoot: true,
        markers: new Set<RepositoryMarker>(),
      };
      existing.hasGitRoot = true;
      candidates.set(canonicalGitRoot, existing);
    }
  }

  return [...candidates.entries()]
    .map(([canonicalPath, value]) => {
      const markers = [...value.markers].sort();
      return {
        canonicalPath: toRepositoryPath(canonicalPath),
        hasGitRoot: value.hasGitRoot,
        markers,
        confidence: scoreCandidate(value.hasGitRoot, markers),
      } satisfies RepositoryCandidate;
    })
    .sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.canonicalPath.localeCompare(b.canonicalPath);
    });
};
