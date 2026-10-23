export type RunReadPreparationErrorCode =
  | 'RUN_NOT_FOUND'
  | 'RUN_ID_MISMATCH'
  | 'INVALID_RUN_CONTEXT'
  | 'SERVICE_NOT_FOUND'
  | 'INVALID_REPOSITORY_PATH'
  | 'INVALID_FILE_MEMBERSHIP'
  | 'READ_FAILED';

export class RunReadPreparationError extends Error {
  constructor(
    readonly code: RunReadPreparationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RunReadPreparationError';
  }
}
