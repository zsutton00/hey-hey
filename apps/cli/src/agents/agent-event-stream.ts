import type { NormalizedProviderFacts } from './providers/provider-event-normalization';

export interface AgentEventEnvelope {
  source: 'provider' | 'local';
  eventType: string;
  timestamp: string;
  sessionId: string | null;
  agentId: string | null;
  payload: Record<string, unknown>;
  providerFacts?: NormalizedProviderFacts;
}

export interface AgentOutputMessage {
  event: AgentEventEnvelope;
}

export type AgentOutputHandler = (message: AgentOutputMessage) => void;
