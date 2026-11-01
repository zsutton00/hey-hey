import type {
  RepositoryFeatureEnrichmentRequest,
  UserMessagePromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';

/** A one-time handoff or an ordinary reply to the same conversation. */
export type RepositoryFeatureEnrichmentPromptPayload =
  | RepositoryFeatureEnrichmentRequest
  | Pick<UserMessagePromptPayload, 'userMessage'>;
