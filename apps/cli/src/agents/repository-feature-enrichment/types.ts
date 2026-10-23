import type {
  RepositoryFeatureEnrichmentDecisionCompletion,
  RepositoryFeatureEnrichmentRequest,
  RepositoryFeatureEnrichmentSuccess,
  RepositoryFeatureEnrichmentSuccessDecision,
} from '../../shared/agent-bridge-contract/generated/api';

export type RepositoryFeatureEnrichmentPromptPayload = RepositoryFeatureEnrichmentRequest;
type RepositoryFeatureEnrichmentResult = RepositoryFeatureEnrichmentDecisionCompletion;
export type RepositoryFeatureEnrichmentSuccessDecisionResult =
  RepositoryFeatureEnrichmentSuccessDecision;
export type RepositoryFeatureEnrichmentSuccessResult = RepositoryFeatureEnrichmentSuccess;

export type RepositoryFeatureEnrichmentParseResult =
  | { ok: true; value: RepositoryFeatureEnrichmentResult }
  | { ok: false; error: string };
