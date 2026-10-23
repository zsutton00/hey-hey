declare const AGENT_SESSION_ID_BRAND: unique symbol;

export type AgentSessionId = string & {
  readonly [AGENT_SESSION_ID_BRAND]: true;
};

export const toAgentSessionId = (value: string): AgentSessionId =>
  value as AgentSessionId;
