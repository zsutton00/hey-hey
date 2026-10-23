import { z } from 'zod';
import type {
  RepositoryGroundingCompletion,
  RepositoryGroundingRetryableFailure,
  RepositoryGroundingSuccess,
  RepositoryGroundingTerminalFailure,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  createAgentBridgeRuntimeValidator,
  formatRuntimeSchemaErrors,
  readOutcome,
} from '../../shared/agent-bridge-contract/runtime-schema-validator';
import type { RepositoryAnalysisCompletion } from './types';

interface RepositoryAnalysisParseError {
  ok: false;
  error: string;
}

export type RepositoryAnalysisParseResult<T> =
  | RepositoryAnalysisParseError
  | { ok: true; value: T };

const successValidator = createAgentBridgeRuntimeValidator<RepositoryGroundingSuccess>(
  'RepositoryGroundingSuccess',
);
const retryableFailureValidator =
  createAgentBridgeRuntimeValidator<RepositoryGroundingRetryableFailure>(
    'RepositoryGroundingRetryableFailure',
  );
const terminalFailureValidator =
  createAgentBridgeRuntimeValidator<RepositoryGroundingTerminalFailure>(
    'RepositoryGroundingTerminalFailure',
  );
const completionValidator = createAgentBridgeRuntimeValidator<RepositoryGroundingCompletion>(
  'RepositoryGroundingCompletion',
);

const outcomeValidators = {
  success: successValidator,
  retryable_failure: retryableFailureValidator,
  terminal_failure: terminalFailureValidator,
} as const;

const outcomes = Object.keys(outcomeValidators) as Array<keyof typeof outcomeValidators>;

export const repositoryGroundingSuccessSchema = z.custom<RepositoryGroundingSuccess>(
  (value) => successValidator(value),
  { message: 'Payload does not satisfy RepositoryGroundingSuccess.' },
);
const repositoryGroundingRetryableFailureSchema = z.custom<RepositoryGroundingRetryableFailure>(
  (value) => retryableFailureValidator(value),
  {
    message: 'Payload does not satisfy RepositoryGroundingRetryableFailure.',
  },
);
const repositoryGroundingTerminalFailureSchema = z.custom<RepositoryGroundingTerminalFailure>(
  (value) => terminalFailureValidator(value),
  {
    message: 'Payload does not satisfy RepositoryGroundingTerminalFailure.',
  },
);
const repositoryGroundingCompletionSchema = z.custom<RepositoryGroundingCompletion>(
  (value) => completionValidator(value),
  { message: 'Payload does not satisfy RepositoryGroundingCompletion.' },
);

export const parseRepositoryAnalysisCompletion = (
  value: unknown,
): RepositoryAnalysisParseResult<RepositoryAnalysisCompletion> => {
  const outcome = readOutcome(value, outcomes);
  if (!outcome) return { ok: false, error: '/outcome: must be a supported outcome' };
  const validator = outcomeValidators[outcome];
  if (!validator(value)) {
    return { ok: false, error: formatRuntimeSchemaErrors(validator.errors) };
  }
  return { ok: true, value };
};

const parseRepositoryGroundingCompletion = parseRepositoryAnalysisCompletion;
