import type { AgentSource } from './monitors/normalizer';
import type { RawAgentOutputEvent } from './monitors/normalizer/types';

export type AgentOutputListener = (event: RawAgentOutputEvent) => void;

/** Process-local event channel separating Run output from monitor source ownership. */
export class AgentOutputEvents {
  private readonly listeners = new Set<AgentOutputListener>();

  public onAgentOutput(listener: AgentOutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public publish(event: RawAgentOutputEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Navigates agent-output lifecycle events into the monitor normalizer owner. */
export class AgentOutputSourceBridge {
  public constructor(private readonly agentSource: AgentSource) {}

  public readonly handle = (event: RawAgentOutputEvent): void => {
    this.agentSource.ingest(event);
  };
}
