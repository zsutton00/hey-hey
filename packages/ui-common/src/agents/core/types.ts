declare const AGENT_SESSION_ID_BRAND: unique symbol;
declare const AGENT_RUN_ID_BRAND: unique symbol;

export type AgentSessionId = string & {
  readonly [AGENT_SESSION_ID_BRAND]: true;
};

export type AgentRunId = string & {
  readonly [AGENT_RUN_ID_BRAND]: true;
};

export type AgentMessageType =
  | "system"
  | "assistant"
  | "user"
  | "tool"
  | "result"
  | "error";

export type AgentContentKind = "text" | "tool" | "result" | "error";

export interface AgentContentItem {
  kind: AgentContentKind;
  payload: unknown;
}

export interface AgentMessage {
  type: AgentMessageType;
  subtype?: string;
  sessionId: AgentSessionId | null;
  content: AgentContentItem[];
  timestamp: number;
  raw?: unknown;
}

export const toAgentSessionId = (value: string): AgentSessionId =>
  value as AgentSessionId;

export const toAgentRunId = (value: string): AgentRunId => value as AgentRunId;
