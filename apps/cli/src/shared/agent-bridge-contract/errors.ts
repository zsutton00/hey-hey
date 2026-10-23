import { AgentSessionRunnerErrorCode } from '../../agents/providers/session-runner';
import type { LocalAgentRunnerErrorCode } from './contract';

export type LocalAgentApiErrorCode =
  | 'INVALID_REQUEST'
  | 'RUN_NOT_FOUND'
  | 'REPO_REQUIRED'
  | 'TASK_CONTEXT_NOT_FOUND'
  | 'TASK_CONTEXT_INVALID'
  | 'ATTACHMENT_NOT_FOUND'
  | 'STAGED_BROWSER_TAB_NOT_FOUND'
  | LocalAgentRunnerErrorCode
  | 'INTERNAL';

export class LocalAgentApiError extends Error {
  readonly code: LocalAgentApiErrorCode | AgentSessionRunnerErrorCode;
  readonly statusCode: number;

  constructor(
    code: LocalAgentApiErrorCode | AgentSessionRunnerErrorCode,
    message: string,
    statusCode: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'LocalAgentApiError';
    this.code = code;
    this.statusCode = statusCode;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

const mapRunnerErrorStatus = (
  code: LocalAgentRunnerErrorCode | AgentSessionRunnerErrorCode,
): number => {
  switch (code) {
    case 'SESSION_NOT_FOUND':
      return 404;
    case 'REPO_BINDING_MISSING':
    case 'NO_ACTIVE_SESSION':
      return 409;
    case 'NOT_SUPPORTED':
      return 501;
    case 'INVALID_CREDENTIAL':
    case 'REFRESH_FAILED':
    case 'RATE_LIMITED':
    case 'MISSING_CREDENTIAL':
    case 'PROVIDER_SESSION_ID_MISSING':
      return 400;
    case 'RUN_FAILED':
      return 500;
    default:
      return 500;
  }
};

const isLocalRunnerErrorCode = (value: unknown): value is LocalAgentRunnerErrorCode => {
  return (
    value === 'INVALID_CREDENTIAL' ||
    value === 'REFRESH_FAILED' ||
    value === 'RATE_LIMITED' ||
    value === 'MISSING_CREDENTIAL' ||
    value === 'SESSION_NOT_FOUND' ||
    value === 'REPO_BINDING_MISSING' ||
    value === 'PROVIDER_SESSION_ID_MISSING' ||
    value === 'NO_ACTIVE_SESSION' ||
    value === 'NOT_SUPPORTED' ||
    value === 'RUN_FAILED'
  );
};

const toLocalAgentApiError = (error: unknown): LocalAgentApiError => {
  if (error instanceof LocalAgentApiError) {
    return error;
  }

  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (isLocalRunnerErrorCode(code)) {
      return new LocalAgentApiError(code, error.message, mapRunnerErrorStatus(code), error);
    }

    return new LocalAgentApiError('INTERNAL', error.message, 500, error);
  }

  return new LocalAgentApiError('INTERNAL', 'Unexpected local server error.', 500, error);
};
