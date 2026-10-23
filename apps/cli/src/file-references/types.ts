type Brand<T, B extends string> = T & { readonly __brand: B };

type ReferenceText = Brand<string, 'ReferenceText'>;
export type RepoRelativePath = Brand<string, 'RepoRelativePath'>;
export type AbsolutePath = Brand<string, 'AbsolutePath'>;

interface ReferenceLineRange {
  startLine: number;
  endLine?: number;
}

export interface ParsedFileReference {
  raw: string;
  pathText: string;
  lineRange?: ReferenceLineRange;
  isGlob: boolean;
}

type ResolveReferenceErrorCode =
  | 'INVALID_REFERENCE'
  | 'NOT_FOUND'
  | 'NOT_READABLE'
  | 'CROSS_REPO_BLOCKED'
  | 'CROSS_REPO_DENIED'
  | 'INVALID_LINE_RANGE';

export interface ResolveReferenceCandidate {
  relativePath: RepoRelativePath;
  absolutePath: AbsolutePath;
  confidence: number;
}

interface ResolvedFileReference {
  input: string;
  relativePath: RepoRelativePath;
  absolutePath: AbsolutePath;
  lineRange?: ReferenceLineRange;
  isDirectory: boolean;
}

export type ResolveReferenceResult =
  | { status: 'resolved'; value: ResolvedFileReference }
  | { status: 'candidates'; candidates: ResolveReferenceCandidate[] }
  | {
      status: 'error';
      code: ResolveReferenceErrorCode;
      message: string;
      suggestions: string[];
    };

export interface ResolveReferenceOptions {
  sessionId?: string;
  workspaceRoot?: string;
  repositoryPath?: string;
  allowCrossRepo?: boolean;
  confirmCrossRepo?: (candidatePath: string) => Promise<boolean>;
  indexedFiles?: readonly string[];
  cwd?: string;
}

export interface ReferenceSuggestion {
  mentionText: string;
  relativePath: RepoRelativePath;
  absolutePath: AbsolutePath;
  confidence: number;
  selectable: boolean;
}

export interface SuggestReferencesResult {
  suggestions: ReferenceSuggestion[];
  hasSelectableSuggestions: boolean;
}

const toReferenceText = (value: string): ReferenceText => value as ReferenceText;
export const toRepoRelativePath = (value: string): RepoRelativePath => value as RepoRelativePath;
export const toAbsolutePath = (value: string): AbsolutePath => value as AbsolutePath;
