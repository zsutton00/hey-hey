type Brand<T, B extends string> = T & { readonly __brand: B };

export type ScannerRootPath = Brand<string, 'ScannerRootPath'>;
export type ScannerCacheKey = Brand<string, 'ScannerCacheKey'>;

export const FILE_CLASSIFICATIONS = ['source', 'test', 'config', 'build', 'docs', 'other'] as const;
export type FileClassification = (typeof FILE_CLASSIFICATIONS)[number];

export const DETECTED_LANGUAGES = [
  'typescript',
  'javascript',
  'go',
  'python',
  'rust',
  'java',
  'ruby',
  'unknown',
] as const;
export type DetectedLanguage = (typeof DETECTED_LANGUAGES)[number];

export const LANGUAGE_MARKERS = {
  'package.json': ['typescript', 'javascript'],
  'go.mod': ['go'],
  'pyproject.toml': ['python'],
  'requirements.txt': ['python'],
  'Cargo.toml': ['rust'],
  'pom.xml': ['java'],
  'build.gradle': ['java'],
  'build.gradle.kts': ['java'],
  Gemfile: ['ruby'],
} as const satisfies Record<string, readonly DetectedLanguage[]>;

export type LanguageMarker = keyof typeof LANGUAGE_MARKERS;

export interface ScannerRepositoryRoot {
  path: string;
  markers: LanguageMarker[];
  hasGitRoot: boolean;
  languages: DetectedLanguage[];
}

export interface ScannedFileEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
  modifiedTimeMs: number;
  language: DetectedLanguage;
  classification: FileClassification;
  cacheKey: ScannerCacheKey;
  indexedAt: string;
}

export interface ScannerIndex {
  rootPath: ScannerRootPath;
  generatedAt: string;
  cacheKey: ScannerCacheKey;
  repositoryRoots: ScannerRepositoryRoot[];
  topLevelDirectories: string[];
  candidateEntrypoints: string[];
  files: ScannedFileEntry[];
}

export interface ScannerQuery {
  languages?: readonly DetectedLanguage[];
  classifications?: readonly FileClassification[];
  globPatterns?: readonly string[];
  limit?: number;
}

export interface ScannerQueryResult {
  generatedAt: string;
  cacheKey: ScannerCacheKey;
  files: ScannedFileEntry[];
}

export interface FileScannerOptions {
  rootPath: string;
  maxDepth?: number;
  includeDotfiles?: boolean;
}

export const toScannerRootPath = (value: string): ScannerRootPath => value as ScannerRootPath;
export const toScannerCacheKey = (value: string): ScannerCacheKey => value as ScannerCacheKey;
