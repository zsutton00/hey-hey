import type { LocalPromptDesignDocInput } from '../../shared/agent-bridge-contract/generated/api';
import type {
  ContextRelatedEntityDto,
  AgentSessionEntryDto,
  ProposalResponseDto,
} from '../../shared/api/generated/api';

/**
 * Internal input passed to the prompt builder.
 * The design doc is always present.
 * Related entities, attached agent sessions, and proposals are fetched
 * during prepare() from the entity context endpoint and injected into
 * the prompt.
 */
export interface DesignDocRefinerPromptInput {
  designDoc: LocalPromptDesignDocInput;
  relatedEntities?: ContextRelatedEntityDto[];
  agentSessions?: AgentSessionEntryDto[];
  proposals?: ProposalResponseDto[];
}
