import fs from 'node:fs/promises';
import path from 'node:path';
import Fuse from 'fuse.js';
import { parseReferenceToken } from './parser';
import type {
  ReferenceSuggestion,
  ResolveReferenceCandidate,
  ResolveReferenceOptions,
  ResolveReferenceResult,
  SuggestReferencesResult,
} from './types';
import { toAbsolutePath, toRepoRelativePath } from './types';

const toPosix = (value: string): string => value.replaceAll('\\', '/');

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizeReferencePath = (value: string): string => {
  if (value.startsWith('~/')) {
    return path.join(process.env['HOME'] ?? '', value.slice(2));
  }
  return value;
};

const maybeRealpath = async (value: string): Promise<string> => {
  try {
    return await fs.realpath(value);
  } catch {
    return value;
  }
};

const validateLineRange = (
  lineRange: { startLine: number; endLine?: number } | undefined,
): string | null => {
  if (!lineRange) {
    return null;
  }

  if (lineRange.startLine <= 0) {
    return 'Line numbers must be positive.';
  }

  if (lineRange.endLine !== undefined && lineRange.endLine < lineRange.startLine) {
    return 'End line must be greater than or equal to start line.';
  }

  return null;
};

const toCandidate = (
  rootPath: string,
  relativePath: string,
  confidence: number,
): ResolveReferenceCandidate => {
  const absolutePath = path.resolve(rootPath, relativePath);
  return {
    relativePath: toRepoRelativePath(relativePath),
    absolutePath: toAbsolutePath(absolutePath),
    confidence,
  };
};

const buildSuggestions = async (
  rootPath: string,
  relativePaths: readonly string[],
  limit: number,
): Promise<ReferenceSuggestion[]> => {
  const capped = relativePaths.slice(0, limit);
  const readability = await Promise.all(
    capped.map(async (relativePath) => {
      const absolutePath = path.resolve(rootPath, relativePath);
      try {
        await fs.access(absolutePath, fs.constants.R_OK);
        return { relativePath, absolutePath, readable: true };
      } catch {
        return { relativePath, absolutePath, readable: false };
      }
    }),
  );

  return readability.map((entry, index) => ({
    mentionText: `@${entry.relativePath}`,
    relativePath: toRepoRelativePath(entry.relativePath),
    absolutePath: toAbsolutePath(entry.absolutePath),
    confidence: Math.max(0.1, 1 - index * 0.03),
    selectable: entry.readable,
  }));
};

export const resolveReference = async (
  refString: string,
  options: ResolveReferenceOptions = {},
): Promise<ResolveReferenceResult> => {
  const parsed = parseReferenceToken(refString.trim());
  if (!parsed) {
    return {
      status: 'error',
      code: 'INVALID_REFERENCE',
      message: 'File references must start with @ and include a path.',
      suggestions: ['Use @path/to/file', 'Use @path/to/file:10-20 for line ranges'],
    };
  }

  const lineError = validateLineRange(parsed.lineRange);
  if (lineError) {
    return {
      status: 'error',
      code: 'INVALID_LINE_RANGE',
      message: lineError,
      suggestions: ['Use @file:10 or @file:10-20'],
    };
  }

  const rootPath = await maybeRealpath(
    path.resolve(options.repositoryPath ?? options.workspaceRoot ?? options.cwd ?? process.cwd()),
  );
  const normalizedPathText = normalizeReferencePath(parsed.pathText);
  const inputIsAbsolute = path.isAbsolute(normalizedPathText);
  const unresolvedAbsolutePath = inputIsAbsolute
    ? path.normalize(normalizedPathText)
    : path.resolve(rootPath, normalizedPathText);
  const canonicalAbsolutePath = await maybeRealpath(unresolvedAbsolutePath);

  if (!isWithinRoot(canonicalAbsolutePath, rootPath)) {
    if (!options.allowCrossRepo) {
      return {
        status: 'error',
        code: 'CROSS_REPO_BLOCKED',
        message: `Reference points outside mapped repository: ${canonicalAbsolutePath}`,
        suggestions: [
          'Pick a file within the mapped service repository',
          'Confirm cross-repo access',
        ],
      };
    }

    if (options.confirmCrossRepo) {
      const accepted = await options.confirmCrossRepo(canonicalAbsolutePath);
      if (!accepted) {
        return {
          status: 'error',
          code: 'CROSS_REPO_DENIED',
          message: 'Cross-repo access was denied by the user.',
          suggestions: ['Choose a file from the mapped repository'],
        };
      }
    }
  }

  try {
    const stats = await fs.stat(canonicalAbsolutePath);
    await fs.access(canonicalAbsolutePath, fs.constants.R_OK);

    const relativePath = toPosix(path.relative(rootPath, canonicalAbsolutePath));
    return {
      status: 'resolved',
      value: {
        input: refString,
        relativePath: toRepoRelativePath(relativePath),
        absolutePath: toAbsolutePath(canonicalAbsolutePath),
        ...(parsed.lineRange !== undefined ? { lineRange: parsed.lineRange } : {}),
        isDirectory: stats.isDirectory(),
      },
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
      return {
        status: 'error',
        code: 'NOT_READABLE',
        message: `Reference is not readable: ${canonicalAbsolutePath}`,
        suggestions: ['Check file permissions', 'Choose another file'],
      };
    }
  }

  const index = options.indexedFiles ?? [];
  if (index.length === 0) {
    return {
      status: 'error',
      code: 'NOT_FOUND',
      message: `Reference not found: ${parsed.pathText}`,
      suggestions: ['Use @ and select from suggestions', 'Check filename spelling'],
    };
  }

  const queryText = toPosix(parsed.pathText).replace(/^\.\//u, '');
  const normalizedIndex = index.map((entry) => toPosix(entry));
  const exactSuffix = normalizedIndex.filter(
    (entry) => entry === queryText || entry.endsWith(`/${queryText}`),
  );

  if (exactSuffix.length > 0) {
    return {
      status: 'candidates',
      candidates: exactSuffix
        .slice(0, 8)
        .map((relativePath, idx) =>
          toCandidate(rootPath, relativePath, Math.max(0.45, 0.95 - idx * 0.08)),
        ),
    };
  }

  const fuse = new Fuse(
    normalizedIndex.map((relativePath) => ({ relativePath })),
    {
      keys: ['relativePath'],
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 1,
    },
  );

  const candidates = fuse
    .search(queryText, { limit: 8 })
    .map((result) =>
      toCandidate(rootPath, result.item.relativePath, Number((1 - (result.score ?? 1)).toFixed(3))),
    );

  if (candidates.length > 0) {
    return {
      status: 'candidates',
      candidates,
    };
  }

  return {
    status: 'error',
    code: 'NOT_FOUND',
    message: `Reference not found: ${parsed.pathText}`,
    suggestions: ['Use @ and choose from suggestions', 'Try a more specific path'],
  };
};

export const suggestReferences = async (
  partialReference: string,
  options: ResolveReferenceOptions = {},
): Promise<SuggestReferencesResult> => {
  const rootPath = await maybeRealpath(
    path.resolve(options.repositoryPath ?? options.workspaceRoot ?? options.cwd ?? process.cwd()),
  );
  const indexedFiles = (options.indexedFiles ?? []).map((entry) => toPosix(entry));
  const query = partialReference.replace(/^@/u, '').trim();

  const uniqueFiles = [...new Set(indexedFiles)].sort((a, b) => a.localeCompare(b));
  if (uniqueFiles.length === 0) {
    return { suggestions: [], hasSelectableSuggestions: false };
  }

  const prefixMatches = query.length
    ? uniqueFiles.filter((entry) => entry.includes(query)).slice(0, 50)
    : uniqueFiles.slice(0, 50);

  const source =
    prefixMatches.length > 0
      ? prefixMatches
      : new Fuse(
          uniqueFiles.map((relativePath) => ({ relativePath })),
          {
            keys: ['relativePath'],
            threshold: 0.38,
            ignoreLocation: true,
            minMatchCharLength: 1,
          },
        )
          .search(query, { limit: 50 })
          .map((result) => result.item.relativePath);

  const suggestions = await buildSuggestions(rootPath, source, 20);
  return {
    suggestions,
    hasSelectableSuggestions: suggestions.some((entry) => entry.selectable),
  };
};
