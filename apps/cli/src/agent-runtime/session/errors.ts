export type SessionErrorCode =
  | 'LOCK_TIMEOUT'
  | 'IO_FAILURE'
  | 'CORRUPTED_SESSION'
  | 'VALIDATION_FAILURE'
  | 'SESSION_NOT_FOUND';

export class SessionStoreError extends Error {
  readonly code: SessionErrorCode;
  override readonly cause?: unknown | undefined;

  constructor(message: string, code: SessionErrorCode, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
  }
}

export class LockTimeoutError extends SessionStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LOCK_TIMEOUT', cause);
  }
}

export class SessionIoError extends SessionStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'IO_FAILURE', cause);
  }
}

export class CorruptedSessionError extends SessionStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CORRUPTED_SESSION', cause);
  }
}

export class SessionValidationError extends SessionStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_FAILURE', cause);
  }
}

export class SessionNotFoundError extends SessionStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'SESSION_NOT_FOUND', cause);
  }
}
