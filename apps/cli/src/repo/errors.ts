type RepoErrorCode =
  | 'LOCK_TIMEOUT'
  | 'IO_FAILURE'
  | 'VALIDATION_FAILURE'
  | 'PATH_NOT_FOUND'
  | 'PATH_NOT_DIRECTORY'
  | 'PATH_NOT_READABLE'
  | 'NOT_A_REPOSITORY'
  | 'MAPPING_NOT_FOUND'
  | 'DISCOVERY_FAILURE';

class RepoStoreError extends Error {
  readonly code: RepoErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: RepoErrorCode, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
  }
}

export class RepoLockTimeoutError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LOCK_TIMEOUT', cause);
  }
}

export class RepoIoError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'IO_FAILURE', cause);
  }
}

export class RepoValidationError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_FAILURE', cause);
  }
}

export class RepoPathNotFoundError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PATH_NOT_FOUND', cause);
  }
}

export class RepoPathNotDirectoryError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PATH_NOT_DIRECTORY', cause);
  }
}

export class RepoPathNotReadableError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PATH_NOT_READABLE', cause);
  }
}

export class NotARepositoryError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'NOT_A_REPOSITORY', cause);
  }
}

export class RepoMappingNotFoundError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MAPPING_NOT_FOUND', cause);
  }
}

export class RepoDiscoveryError extends RepoStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DISCOVERY_FAILURE', cause);
  }
}
