import type {
  AgentSessionDto,
  DesignDocResponseDto,
  FullEntityContextDto,
  ProjectResponseDto,
  TaskResponseDto,
} from '@hey-hey/contracts/api/models';
import type { RunEntityReference } from '../../shared/agent-bridge-contract/contract';

export type CurrentEntityDto =
  | ProjectResponseDto
  | DesignDocResponseDto
  | TaskResponseDto
  | AgentSessionDto;

export interface ExistingLoadedEntityPromptContext {
  kind: 'entity';
  focalEntity: RunEntityReference;
  entity: CurrentEntityDto;
  context: FullEntityContextDto;
}

export interface AgentSessionTranscriptEntry {
  role: 'user' | 'assistant' | 'uncertainty';
  turn: number;
  content?: string;
  uncertainty?: {
    severity: 'low' | 'medium' | 'high';
    category: 'lack_of_evidence' | 'conflict' | 'ambiguity' | 'not_implemented' | 'question';
    statement: string;
  };
}

interface AgentSessionPromptContext {
  kind: 'agent_session';
  focalEntity: RunEntityReference;
  entity: AgentSessionDto;
  context: FullEntityContextDto;
  agentSession: AgentSessionDto;
  conversationId: string;
  transcript: readonly AgentSessionTranscriptEntry[];
}

export type LoadedEntityPromptContext =
  | ExistingLoadedEntityPromptContext
  | AgentSessionPromptContext;
