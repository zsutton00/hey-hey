import type { RepositoryFirstWorkCompletion } from '../../shared/agent-bridge-contract/generated/api';
import {
  createAgentBridgeRuntimeValidator,
  formatRuntimeSchemaErrors,
  readOutcome,
} from '../../shared/agent-bridge-contract/runtime-schema-validator';
import type { RepositoryFirstWorkParseResult } from './types';

const outcomeValidators = {
  questions: createAgentBridgeRuntimeValidator<RepositoryFirstWorkCompletion>(
    'RepositoryFirstWorkQuestions',
  ),
  success: createAgentBridgeRuntimeValidator<RepositoryFirstWorkCompletion>(
    'RepositoryFirstWorkSuccess',
  ),
  retryable_failure: createAgentBridgeRuntimeValidator<RepositoryFirstWorkCompletion>(
    'RepositoryFirstWorkRetryableFailure',
  ),
  terminal_failure: createAgentBridgeRuntimeValidator<RepositoryFirstWorkCompletion>(
    'RepositoryFirstWorkTerminalFailure',
  ),
} as const;

const outcomes = Object.keys(outcomeValidators) as Array<keyof typeof outcomeValidators>;

export function parseRepositoryFirstWorkCompletion(value: unknown): RepositoryFirstWorkParseResult {
  const outcome = readOutcome(value, outcomes);
  if (!outcome) return { ok: false, error: '/outcome: must be a supported outcome' };
  const validator = outcomeValidators[outcome];
  if (!validator(value)) return { ok: false, error: formatRuntimeSchemaErrors(validator.errors) };
  return { ok: true, value };
}
