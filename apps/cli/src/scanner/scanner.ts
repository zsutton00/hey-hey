import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import createIgnore from 'ignore';
import type { Ignore } from 'ignore';
import { globSync } from 'tinyglobby';
import type {
  DetectedLanguage,
  FileClassification,
  FileScannerOptions,
  LanguageMarker,
  ScannedFileEntry,
  ScannerIndex,
  ScannerQuery,
  ScannerQueryResult,
  ScannerRepositoryRoot,
} from './types';
import {
  DETECTED_LANGUAGES,
  FILE_CLASSIFICATIONS,
  LANGUAGE_MARKERS,
  toScannerCacheKey,
  toScannerRootPath,
} from './types';

const DEFAULT_MAX_DEPTH = 6;
const HARD_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
]);
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);
const ENTRYPOINT_FILE_NAMES = new Set([
  'main.ts',
  'main.tsx',
  'main.js',
  'main.mjs',
  'index.ts',
  'index.js',
  'main.go',
  '__main__.py',
  'app.py',
  'src/main.rs',
]);
const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gemfile',
  'dockerfile',
  'makefile',
]);

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, DetectedLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.py': 'python',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
};

interface GitIgnoreMatcher {
  basePath: string;
  matcher: Ignore;
}

interface DirectoryState {
  absolutePath: string;
  depth: number;
  inheritedIgnores: readonly GitIgnoreMatcher[];
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === 'object' && error !== null && 'code' in error;

const toPosix = (value: string): string => value.split(path.sep).join(path.posix.sep);

const stableSort = (values: readonly string[]): string[] =>
  [...values].sort((a, b) => a.localeCompare(b));

const createCacheKey = (input: string): ReturnType<typeof toScannerCacheKey> =>
  toScannerCacheKey(crypto.createHash('sha1').update(input).digest('hex'));

const isLanguageMarker = (entryName: string): entryName is LanguageMarker =>
  entryName in LANGUAGE_MARKERS;

const readGitIgnorePatterns = async (directory: string): Promise<string[]> => {
  const ignorePath = path.join(directory, '.gitignore');

  try {
    const text = await fs.readFile(ignorePath, 'utf8');
    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith('#'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const shouldIgnoreRelativePath = (relativePath: string, matcher: Ignore): boolean =>
  matcher.ignores(toPosix(relativePath).replace(/^\.\//u, ''));

const shouldIgnorePath = (absolutePath: string, matchers: readonly GitIgnoreMatcher[]): boolean => {
  for (const matcher of matchers) {
    const relativePath = path.relative(matcher.basePath, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      continue;
    }

    if (shouldIgnoreRelativePath(relativePath, matcher.matcher)) {
      return true;
    }
  }

  return false;
};

const readDirectoryEntries = async (directory: string): Promise<Dirent[]> => {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'ENOENT')
    ) {
      return [];
    }
    throw error;
  }
};

const classifyFile = (relativePath: string): FileClassification => {
  const posixPath = toPosix(relativePath).toLowerCase();
  const fileName = path.basename(posixPath);
  const extension = path.extname(posixPath);

  if (
    posixPath.includes('/__tests__/') ||
    posixPath.includes('/test/') ||
    posixPath.includes('/tests/') ||
    fileName.includes('.test.') ||
    fileName.includes('.spec.')
  ) {
    return 'test';
  }

  if (
    posixPath.startsWith('docs/') ||
    posixPath.includes('/docs/') ||
    DOC_EXTENSIONS.has(extension)
  ) {
    return 'docs';
  }

  if (
    posixPath.startsWith('dist/') ||
    posixPath.startsWith('build/') ||
    posixPath.startsWith('target/') ||
    posixPath.includes('/dist/') ||
    posixPath.includes('/build/') ||
    posixPath.includes('/target/') ||
    fileName === 'dockerfile' ||
    fileName === 'makefile'
  ) {
    return 'build';
  }

  if (
    CONFIG_FILE_NAMES.has(fileName) ||
    fileName.startsWith('.') ||
    fileName.endsWith('.config.js') ||
    fileName.endsWith('.config.ts') ||
    extension === '.json' ||
    extension === '.yaml' ||
    extension === '.yml' ||
    extension === '.toml'
  ) {
    return 'config';
  }

  if (extension in LANGUAGE_BY_EXTENSION) {
    return 'source';
  }

  return 'other';
};

const detectLanguageForFile = (
  relativePath: string,
  nearestRepositoryLanguages: readonly DetectedLanguage[],
): DetectedLanguage => {
  const extension = path.extname(relativePath).toLowerCase();
  const byExtension = LANGUAGE_BY_EXTENSION[extension];
  if (byExtension) {
    return byExtension;
  }

  if (nearestRepositoryLanguages.length === 1) {
    return nearestRepositoryLanguages[0] ?? 'unknown';
  }

  return 'unknown';
};

const detectLanguagesFromMarkers = (markers: readonly LanguageMarker[]): DetectedLanguage[] => {
  const languageSet = new Set<DetectedLanguage>();
  for (const marker of markers) {
    for (const language of LANGUAGE_MARKERS[marker]) {
      languageSet.add(language);
    }
  }
  return stableSort([...languageSet]) as DetectedLanguage[];
};

const makeRepositoryRoot = async (directory: string): Promise<ScannerRepositoryRoot | null> => {
  const entries = await readDirectoryEntries(directory);
  const markerNames = entries.map((entry) => entry.name).filter(isLanguageMarker);
  const hasGitRoot = entries.some((entry) => entry.name === '.git');

  if (!hasGitRoot && markerNames.length === 0) {
    return null;
  }

  const markers = stableSort(markerNames) as LanguageMarker[];
  const languages = detectLanguagesFromMarkers(markers);

  return {
    path: directory,
    markers,
    hasGitRoot,
    languages,
  };
};

const nearestRepositoryLanguagesForPath = (
  absolutePath: string,
  repositoryRoots: readonly ScannerRepositoryRoot[],
): DetectedLanguage[] => {
  const matchingRoots = repositoryRoots
    .filter(
      (root) => absolutePath === root.path || absolutePath.startsWith(`${root.path}${path.sep}`),
    )
    .sort((a, b) => b.path.length - a.path.length);

  return matchingRoots[0]?.languages ?? [];
};

const findEntrypoints = (files: readonly ScannedFileEntry[]): string[] => {
  const candidates = files
    .filter((file) => {
      const normalized = toPosix(file.relativePath);
      const fileName = path.basename(normalized);
      return ENTRYPOINT_FILE_NAMES.has(fileName) || ENTRYPOINT_FILE_NAMES.has(normalized);
    })
    .map((file) => file.relativePath);

  return stableSort(candidates);
};

const isValidClassification = (value: string): value is FileClassification =>
  FILE_CLASSIFICATIONS.includes(value as FileClassification);

const isValidLanguage = (value: string): value is DetectedLanguage =>
  DETECTED_LANGUAGES.includes(value as DetectedLanguage);

const queryIndex = (index: ScannerIndex, query: ScannerQuery = {}): ScannerQueryResult => {
  const languageFilter = query.languages ? new Set(query.languages.filter(isValidLanguage)) : null;
  const classificationFilter = query.classifications
    ? new Set(query.classifications.filter(isValidClassification))
    : null;
  const globPatterns = query.globPatterns?.map((pattern) => toPosix(pattern)) ?? [];
  const globMatchedPaths =
    globPatterns.length > 0
      ? new Set(
          globSync(globPatterns, {
            cwd: index.rootPath,
            onlyFiles: true,
            dot: true,
          }).map((filePath) => toPosix(filePath)),
        )
      : null;

  let files = index.files.filter((file) => {
    if (languageFilter && !languageFilter.has(file.language)) {
      return false;
    }

    if (classificationFilter && !classificationFilter.has(file.classification)) {
      return false;
    }

    if (!globMatchedPaths) {
      return true;
    }

    const relativePath = toPosix(file.relativePath);
    return globMatchedPaths.has(relativePath);
  });

  if (query.limit !== undefined && query.limit > 0) {
    files = files.slice(0, query.limit);
  }

  return {
    generatedAt: index.generatedAt,
    cacheKey: index.cacheKey,
    files,
  };
};

const toRelativePath = (rootPath: string, absolutePath: string): string =>
  toPosix(path.relative(rootPath, absolutePath));

const assertScannerRoot = async (rootPath: string): Promise<string> => {
  const absolute = path.isAbsolute(rootPath) ? rootPath : path.resolve(process.cwd(), rootPath);
  const stat = await fs.stat(absolute);
  if (!stat.isDirectory()) {
    throw new Error(`Scanner root path is not a directory: ${absolute}`);
  }
  return fs.realpath(absolute);
};

const scan = async (options: FileScannerOptions): Promise<ScannerIndex> => {
  const rootPath = await assertScannerRoot(options.rootPath);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const includeDotfiles = options.includeDotfiles ?? false;

  const files: ScannedFileEntry[] = [];
  const topLevelDirectorySet = new Set<string>();
  const repositoryRoots = new Map<string, ScannerRepositoryRoot>();
  const visitedRealDirectories = new Set<string>();

  const rootIgnorePatterns = await readGitIgnorePatterns(rootPath);
  const rootMatchers: readonly GitIgnoreMatcher[] =
    rootIgnorePatterns.length > 0
      ? [
          {
            basePath: rootPath,
            matcher: createIgnore({ allowRelativePaths: true }).add(rootIgnorePatterns),
          },
        ]
      : [];

  const queue: DirectoryState[] = [
    { absolutePath: rootPath, depth: 0, inheritedIgnores: rootMatchers },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    let realDirectoryPath: string;
    try {
      realDirectoryPath = await fs.realpath(next.absolutePath);
    } catch {
      continue;
    }

    if (visitedRealDirectories.has(realDirectoryPath)) {
      continue;
    }
    visitedRealDirectories.add(realDirectoryPath);

    const repositoryRoot = await makeRepositoryRoot(realDirectoryPath);
    if (repositoryRoot) {
      repositoryRoots.set(repositoryRoot.path, repositoryRoot);
    }

    const localPatterns = await readGitIgnorePatterns(realDirectoryPath);
    const localMatcher: readonly GitIgnoreMatcher[] =
      localPatterns.length > 0
        ? [
            ...next.inheritedIgnores,
            {
              basePath: realDirectoryPath,
              matcher: createIgnore({ allowRelativePaths: true }).add(localPatterns),
            },
          ]
        : next.inheritedIgnores;

    const entries = await readDirectoryEntries(realDirectoryPath);

    for (const entry of entries) {
      if (!includeDotfiles && entry.name.startsWith('.')) {
        if (entry.name !== '.gitignore') {
          continue;
        }
      }

      const childPath = path.join(realDirectoryPath, entry.name);

      if (shouldIgnorePath(childPath, localMatcher)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (HARD_SKIP_DIRS.has(entry.name)) {
          continue;
        }

        if (next.depth < maxDepth) {
          queue.push({
            absolutePath: childPath,
            depth: next.depth + 1,
            inheritedIgnores: localMatcher,
          });
        }

        if (next.depth === 0) {
          topLevelDirectorySet.add(entry.name);
        }

        continue;
      }

      if (entry.isSymbolicLink()) {
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(childPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          if (next.depth < maxDepth) {
            queue.push({
              absolutePath: childPath,
              depth: next.depth + 1,
              inheritedIgnores: localMatcher,
            });
          }
          if (next.depth === 0) {
            topLevelDirectorySet.add(entry.name);
          }
          continue;
        }

        if (!stat.isFile()) {
          continue;
        }
      } else if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(childPath);
      const relativePath = toRelativePath(rootPath, childPath);
      const nearestLanguages = nearestRepositoryLanguagesForPath(childPath, [
        ...repositoryRoots.values(),
      ]);
      const language = detectLanguageForFile(relativePath, nearestLanguages);
      const classification = classifyFile(relativePath);
      const indexedAt = new Date().toISOString();

      files.push({
        absolutePath: childPath,
        relativePath,
        size: stat.size,
        modifiedTimeMs: stat.mtimeMs,
        language,
        classification,
        cacheKey: createCacheKey(`${relativePath}:${String(stat.size)}:${String(stat.mtimeMs)}`),
        indexedAt,
      });
    }
  }

  const sortedFiles = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const generatedAt = new Date().toISOString();
  const indexCacheKey = createCacheKey(
    JSON.stringify({
      generatedAt,
      files: sortedFiles.map((file) => [file.relativePath, file.cacheKey]),
    }),
  );

  return {
    rootPath: toScannerRootPath(rootPath),
    generatedAt,
    cacheKey: indexCacheKey,
    repositoryRoots: [...repositoryRoots.values()].sort((a, b) => a.path.localeCompare(b.path)),
    topLevelDirectories: stableSort([...topLevelDirectorySet]),
    candidateEntrypoints: findEntrypoints(sortedFiles),
    files: sortedFiles,
  };
};

export class FileScanner {
  private currentIndex: ScannerIndex | null = null;

  constructor(private readonly options: FileScannerOptions) {}

  async refreshIndex(): Promise<ScannerIndex> {
    this.currentIndex = await scan(this.options);
    return this.currentIndex;
  }

  getIndex(): ScannerIndex | null {
    return this.currentIndex;
  }

  queryFiles(query: ScannerQuery = {}): ScannerQueryResult {
    if (!this.currentIndex) {
      throw new Error('Scanner index has not been built. Call refreshIndex() first.');
    }
    return queryIndex(this.currentIndex, query);
  }

  getLanguageSummary(): Readonly<Record<DetectedLanguage, number>> {
    if (!this.currentIndex) {
      throw new Error('Scanner index has not been built. Call refreshIndex() first.');
    }

    const summary = DETECTED_LANGUAGES.reduce<Record<DetectedLanguage, number>>(
      (acc, language) => {
        acc[language] = 0;
        return acc;
      },
      {} as Record<DetectedLanguage, number>,
    );

    for (const file of this.currentIndex.files) {
      summary[file.language] += 1;
    }

    return summary;
  }

  getCandidateEntrypoints(): readonly string[] {
    if (!this.currentIndex) {
      throw new Error('Scanner index has not been built. Call refreshIndex() first.');
    }
    return this.currentIndex.candidateEntrypoints;
  }
}

export const scannerInternals = {
  classifyFile,
  detectLanguageForFile,
  shouldIgnoreRelativePath,
  queryIndex,
};
