type Brand<T, B extends string> = T & { readonly __brand: B };

export type ServiceId = Brand<string, 'ServiceId'>;
export type RepositoryPath = Brand<string, 'RepositoryPath'>;

export const REPO_STATE_VERSION = 1;

export const REPOSITORY_MARKERS = [
  'package.json',
  'go.mod',
  'pyproject.toml',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'Gemfile',
  'Cargo.toml',
  'requirements.txt',
] as const;

export type RepositoryMarker = (typeof REPOSITORY_MARKERS)[number];

export interface RepositoryCandidate {
  canonicalPath: RepositoryPath;
  confidence: number;
  hasGitRoot: boolean;
  markers: RepositoryMarker[];
}

export interface ResolvedRepositoryPath {
  canonicalPath: RepositoryPath;
  hasGitRoot: boolean;
  markers: RepositoryMarker[];
}

export interface ServiceRepoBinding {
  serviceId: ServiceId;
  repositoryPath: RepositoryPath;
  createdAt: string;
  updatedAt: string;
}

export interface RepoMappingStoreData {
  state_version: number;
  updatedAt: string;
  mappings: Array<{
    serviceId: string;
    repositoryPath: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface DiscoverRepositoriesOptions {
  cwd?: string;
  maxDepth?: number;
}

export interface ResolveRepositoryPathOptions {
  cwd?: string;
}

export interface RepoMappingStoreOptions {
  mappingPath?: string;
  lockPath?: string;
  now?: () => Date;
  randomId?: () => string;
  timeoutMs?: number;
  retryDelayMs?: number;
  staleLockMs?: number;
}

export const toServiceId = (value: string): ServiceId => value as ServiceId;
export const toRepositoryPath = (value: string): RepositoryPath => value as RepositoryPath;
