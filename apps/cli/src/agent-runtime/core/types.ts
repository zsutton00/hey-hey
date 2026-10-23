import type { AgentSessionId } from '../../../../../packages/ui-common/src/agents/core/identity';
export {
  toAgentSessionId,
  type AgentSessionId,
} from '../../../../../packages/ui-common/src/agents/core/identity';
declare const AGENT_RUN_ID_BRAND: unique symbol;

export type AgentRunId = string & {
  readonly [AGENT_RUN_ID_BRAND]: true;
};

export type AgentMessageType = 'system' | 'assistant' | 'user' | 'tool' | 'result' | 'error';

export type AgentContentKind = 'text' | 'tool' | 'result' | 'error';

export interface AgentContentItem {
  kind: AgentContentKind;
  payload: unknown;
}

export interface AgentMessage {
  type: AgentMessageType;
  subtype?: string | undefined;
  sessionId: AgentSessionId | null;
  content: AgentContentItem[];
  timestamp: number;
  raw?: unknown | undefined;
}

export const toAgentRunId = (value: string): AgentRunId => value as AgentRunId;
