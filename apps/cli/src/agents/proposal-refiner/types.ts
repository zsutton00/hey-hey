import type { LocalPromptProposalInput } from '@hey-hey/contracts/agent-bridge';
import type {
  ContextRelatedEntityDto,
  AgentSessionEntryDto,
  ProposalResponseDto,
} from '@hey-hey/contracts/api/models';

export interface ProposalRefinerPromptInput {
  proposal: LocalPromptProposalInput;
  relatedEntities?: ContextRelatedEntityDto[];
  agentSessions?: AgentSessionEntryDto[];
  proposals?: ProposalResponseDto[];
}
