import type {
  AgentSessionDto,
  DesignDocResponseDto,
  FullEntityContextDto,
  ProjectResponseDto,
  TaskResponseDto,
} from '../../shared/api/generated/api';
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
  role: 'user' | 'assistant';
  turn: number;
  content: string;
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
