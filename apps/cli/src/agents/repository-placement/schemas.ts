import { z } from 'zod';
import type {
  RepositoryPlacementCompletion,
  RepositoryPlacementRetryableFailure,
  RepositoryPlacementSuccess,
  RepositoryPlacementTerminalFailure,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  createAgentBridgeRuntimeValidator,
  formatRuntimeSchemaErrors,
  readOutcome,
} from '../../shared/agent-bridge-contract/runtime-schema-validator';

export type RepositoryPlacementParseResult =
  | { ok: true; value: RepositoryPlacementCompletion }
  | { ok: false; error: string };

const successValidator = createAgentBridgeRuntimeValidator<RepositoryPlacementSuccess>(
  'RepositoryPlacementCompletion/oneOf/0',
);
const retryableFailureValidator =
  createAgentBridgeRuntimeValidator<RepositoryPlacementRetryableFailure>(
    'RepositoryPlacementCompletion/oneOf/1',
  );
const terminalFailureValidator =
  createAgentBridgeRuntimeValidator<RepositoryPlacementTerminalFailure>(
    'RepositoryPlacementCompletion/oneOf/2',
  );
const completionValidator = createAgentBridgeRuntimeValidator<RepositoryPlacementCompletion>(
  'RepositoryPlacementCompletion',
);

const outcomeValidators = {
  success: successValidator,
  retryable_failure: retryableFailureValidator,
  terminal_failure: terminalFailureValidator,
} as const;

const outcomes = Object.keys(outcomeValidators) as Array<keyof typeof outcomeValidators>;

const repositoryPlacementCompletionSchema = z.custom<RepositoryPlacementCompletion>(
  (value) => completionValidator(value),
  { message: 'Payload does not satisfy RepositoryPlacementCompletion.' },
);

export const parseRepositoryPlacementCompletion = (
  value: unknown,
): RepositoryPlacementParseResult => {
  const outcome = readOutcome(value, outcomes);
  if (!outcome) return { ok: false, error: '/outcome: must be a supported outcome' };
  const validator = outcomeValidators[outcome];
  if (!validator(value)) return { ok: false, error: formatRuntimeSchemaErrors(validator.errors) };
  return { ok: true, value };
};
