import type { LocalPromptTaskInput } from '@hey-hey/contracts/agent-bridge';
import type {
  ContextRelatedEntityDto,
  AgentSessionEntryDto,
  ProposalResponseDto,
} from '@hey-hey/contracts/api/models';

/**
 * Internal input passed to the prompt builder.
 * The feature (a task with taskType FEATURE) is always present.
 * Related entities, attached agent sessions, and proposals are fetched
 * during prepare() from the entity context endpoint and injected into
 * the prompt.
 */
export interface FeatureRefinerPromptInput {
  feature: LocalPromptTaskInput;
  relatedEntities?: ContextRelatedEntityDto[];
  agentSessions?: AgentSessionEntryDto[];
  proposals?: ProposalResponseDto[];
}
