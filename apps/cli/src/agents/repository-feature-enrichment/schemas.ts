import { z } from 'zod';
import type { RepositoryFeatureEnrichmentDecisionCompletion } from '../../shared/agent-bridge-contract/generated/api';
import {
  createAgentBridgeRuntimeValidator,
  formatRuntimeSchemaErrors,
  readOutcome,
} from '../../shared/agent-bridge-contract/runtime-schema-validator';
import type { RepositoryFeatureEnrichmentParseResult } from './types';

const repositoryFeatureEnrichmentCompletionValidator =
  createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentDecisionCompletion>(
    'RepositoryFeatureEnrichmentDecisionCompletion',
  );

const outcomeValidators = {
  questions: createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentDecisionCompletion>(
    'RepositoryFeatureEnrichmentQuestions',
  ),
  success: createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentDecisionCompletion>(
    'RepositoryFeatureEnrichmentSuccessDecision',
  ),
  retryable_failure:
    createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentDecisionCompletion>(
      'RepositoryFeatureEnrichmentRetryableFailure',
    ),
  terminal_failure:
    createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentDecisionCompletion>(
      'RepositoryFeatureEnrichmentTerminalFailure',
    ),
} as const;

const outcomes = Object.keys(outcomeValidators) as Array<keyof typeof outcomeValidators>;

/** Zod-compatible adapter retained for callers that consume this module's parser schema. */
const repositoryFeatureEnrichmentCompletionSchema =
  z.custom<RepositoryFeatureEnrichmentDecisionCompletion>(
    (value) => repositoryFeatureEnrichmentCompletionValidator(value),
    {
      message: 'Payload does not satisfy the generated OpenAPI contract.',
    },
  );

export function parseRepositoryFeatureEnrichmentCompletion(
  value: unknown,
): RepositoryFeatureEnrichmentParseResult {
  const outcome = readOutcome(value, outcomes);
  if (!outcome) return { ok: false, error: '/outcome: must be a supported outcome' };
  const validator = outcomeValidators[outcome];
  if (!validator(value))
    return {
      ok: false,
      error: formatRuntimeSchemaErrors(validator.errors),
    };
  return { ok: true, value };
}
