export const CREDENTIAL_ERROR_CODES = [
  'INVALID_CREDENTIAL',
  'REFRESH_FAILED',
  'RATE_LIMITED',
] as const;

export type CredentialErrorCode = (typeof CREDENTIAL_ERROR_CODES)[number];

export interface CredentialErrorDetails {
  statusCode?: number | undefined;
  attempt?: number | undefined;
  maxAttempts?: number | undefined;
  reason?: string | undefined;
}

export class CredentialError extends Error {
  readonly code: CredentialErrorCode;
  readonly retryable: boolean;
  readonly details: CredentialErrorDetails;

  constructor(code: CredentialErrorCode, message: string, details: CredentialErrorDetails = {}) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
    this.retryable = code !== 'INVALID_CREDENTIAL';
    this.details = details;
  }
}

export const isCredentialError = (error: unknown): error is CredentialError =>
  error instanceof CredentialError;

export const classifyRefreshStatus = (statusCode: number): CredentialErrorCode => {
  if (statusCode === 401 || statusCode === 403) {
    return 'INVALID_CREDENTIAL';
  }

  if (statusCode === 429) {
    return 'RATE_LIMITED';
  }

  return 'REFRESH_FAILED';
};
