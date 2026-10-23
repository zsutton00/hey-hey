import type { LocalPromptProposalInput } from '../../shared/agent-bridge-contract/generated/api';
import type {
  ContextRelatedEntityDto,
  AgentSessionEntryDto,
  ProposalResponseDto,
} from '../../shared/api/generated/api';

export interface ProposalRefinerPromptInput {
  proposal: LocalPromptProposalInput;
  relatedEntities?: ContextRelatedEntityDto[];
  agentSessions?: AgentSessionEntryDto[];
  proposals?: ProposalResponseDto[];
}
