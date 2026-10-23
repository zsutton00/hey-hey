import type { RunStore } from '../../run-store';
import type { AgenticSession } from '../../session/types';
import type { LocalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { LocalImplementPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';

/** Persists approval settings once, before starting the Implement provider session. */
export class ImplementRuntimeOwner {
  public constructor(private readonly runStore: RunStore) {}

  public async apply(
    session: AgenticSession,
    input: LocalRunPromptRequest,
  ): Promise<AgenticSession> {
    if (input.promptType !== 'implement') return session;
    const payload = input.payload as LocalImplementPromptPayload | undefined;
    if (!payload?.runtime) return session;
    return this.runStore.updateRunImplementRuntime(session.agentic_session_id, payload.runtime);
  }
}
