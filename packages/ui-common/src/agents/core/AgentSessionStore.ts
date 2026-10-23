import type { AgentSessionId } from "./types";

export interface AgentCredentialLifecycleMetadata {
  agentType: string;
  accountId: string;
  scopes: string[];
  expiresAt: number | null;
  lastRetrievedAt: number;
  lastRefreshedAt: number | null;
}

export interface AgentSessionMetadata {
  adapter: string;
  createdAt: number;
  updatedAt?: number;
  credentialLifecycle?: AgentCredentialLifecycleMetadata;
}

export interface AgentSessionStore<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata
> {
  persist(sessionId: AgentSessionId, metadata: TSessionMetadata): Promise<void>;
  retrieve(sessionId: AgentSessionId): Promise<TSessionMetadata | null>;
}
