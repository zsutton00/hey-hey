import type { AgentSessionMetadata, AgentSessionStore } from './AgentSessionStore';
import type { AgentSessionId } from './types';

export class InMemoryAgentSessionStore<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
> implements AgentSessionStore<TSessionMetadata> {
  private readonly sessions = new Map<AgentSessionId, TSessionMetadata>();

  async persist(sessionId: AgentSessionId, metadata: TSessionMetadata): Promise<void> {
    this.sessions.set(sessionId, metadata);
  }

  async retrieve(sessionId: AgentSessionId): Promise<TSessionMetadata | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessionIds(): AgentSessionId[] {
    return Array.from(this.sessions.keys());
  }

  clear(): void {
    this.sessions.clear();
  }
}
