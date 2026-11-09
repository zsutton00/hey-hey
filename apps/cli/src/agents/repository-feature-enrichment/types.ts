import type {
  RepositoryFeatureEnrichmentRequest,
  UserMessagePromptPayload,
} from '@hey-hey/contracts/agent-bridge';

/** A one-time handoff or an ordinary reply to the same conversation. */
export type RepositoryFeatureEnrichmentPromptPayload =
  | RepositoryFeatureEnrichmentRequest
  | Pick<UserMessagePromptPayload, 'userMessage'>;
