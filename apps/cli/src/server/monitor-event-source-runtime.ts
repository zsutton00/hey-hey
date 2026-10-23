import type { RunRegistry } from '../run/run-registry';
import { AgentOutputSourceBridge, type AgentOutputEvents } from './agent-output-events';
import { AgentSource } from './monitors/normalizer';

/** Owns the process-local bridge from active Run output into monitor provenance state. */
export class MonitorEventSourceRuntime {
  public readonly agentSource: AgentSource;

  private readonly unsubscribeAgentOutput: () => void;

  public constructor(runRegistry: RunRegistry, agentOutputEvents: AgentOutputEvents) {
    this.agentSource = new AgentSource(runRegistry);
    const bridge = new AgentOutputSourceBridge(this.agentSource);
    this.unsubscribeAgentOutput = agentOutputEvents.onAgentOutput(bridge.handle);
  }

  public dispose(): void {
    this.unsubscribeAgentOutput();
  }
}
