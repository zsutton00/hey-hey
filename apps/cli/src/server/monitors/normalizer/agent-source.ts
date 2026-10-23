import type { RunRegistry } from '../../../run/run-registry';
import { normalizeSettledTurn, normalizePlatformEvent, normalizeReportEmission } from './normalize';
import type { CanonicalMonitorEvent, RawAgentInboundEvent, RawPlatformInboundEvent } from './types';

/**
 * Resolves the conversation a run belongs to. Backed by the run registry/store
 * at wire time; injected so this module stays free of server imports.
 */
export class AgentSource {
  public constructor(private readonly runRegistry: RunRegistry) {}

  /**
   * Ingest one of the CLI's own emissions. Settled Turns and report emissions
   * are normalized directly as self-origin events; generic output has no event.
   */
  public ingest(agentEvent: RawAgentInboundEvent): CanonicalMonitorEvent | undefined {
    if (agentEvent.kind === 'settled_turn') {
      return normalizeSettledTurn(agentEvent);
    }
    const conversationId = this.runRegistry.get(agentEvent.runId)?.conversationId;
    if (agentEvent.kind === 'report_emission') {
      if (conversationId === undefined) return undefined;
      return normalizeReportEmission(agentEvent, conversationId);
    }
    return undefined;
  }

  public normalizePlatformEvent(event: RawPlatformInboundEvent): CanonicalMonitorEvent {
    return normalizePlatformEvent(event);
  }
}
