export type CredentialErrorCode =
  | 'PLATFORM_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'DEFAULT_COLLECTION_MISSING'
  | 'STORAGE_LOCKED'
  | 'STORAGE_FAILURE'
  | 'CORRUPTED_DATA'
  | 'SERIALIZATION_ERROR';

export class CredentialStoreError extends Error {
  readonly code: CredentialErrorCode;
  override readonly cause?: unknown;

  /** The cause's message is appended so the underlying failure survives `.message`-only surfacing. */
  constructor(message: string, code: CredentialErrorCode, cause?: unknown) {
    super(cause instanceof Error ? `${message}: ${cause.message}` : message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
  }
}

export class PlatformUnavailableError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PLATFORM_UNAVAILABLE', cause);
  }
}

export class PermissionDeniedError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PERMISSION_DENIED', cause);
  }
}

/** The Secret Service is running but has no usable default collection (Linux). */
export class DefaultCollectionMissingError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DEFAULT_COLLECTION_MISSING', cause);
  }
}

/** The default collection exists but stayed locked after the native unlock flow. */
export class StorageLockedError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_LOCKED', cause);
  }
}

export class StorageFailureError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_FAILURE', cause);
  }
}

export class CorruptedDataError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CORRUPTED_DATA', cause);
  }
}

export class SerializationError extends CredentialStoreError {
  constructor(message: string, cause?: unknown) {
    super(message, 'SERIALIZATION_ERROR', cause);
  }
}

export const isCredentialError = (error: unknown): error is CredentialStoreError =>
  error instanceof CredentialStoreError;
