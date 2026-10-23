import type { AgentOutputEvents } from './agent-output-events';
import type { PlatformWebSocketManager } from './platform-ws';
import type { RunLifecycleEvents } from './run-lifecycle-events';
import type { LocalAgentOutputEvent } from '../run/types';
import type { Run } from '../run/run';
import type {
  AgentSessionContextSizeObservation,
  AgentSessionCurrentStateObservation,
  ConversationPhaseObservation,
} from '../shared/api/generated/api';
import type { ServerLogger } from './logger';

export interface RunEventPublisherDependencies {
  platformWebSocketManager: PlatformWebSocketManager;
  agentOutputEvents: AgentOutputEvents;
  runLifecycleEvents: RunLifecycleEvents;
  logger: ServerLogger;
}

/**
 * Who produced an output event the Run accepted. Published only after the
 * Run's producer attribution admitted the event, so stale producers never
 * reach run-output listeners.
 */
export interface RunOutputAttribution {
  readonly run: Run;
  /** The Run's active Turn when the event was admitted. */
  readonly turnId: string | null;
  /** Subagent Turn whose callback produced the event; null for the Run's own provider session. */
  readonly subagentTurnId: string | null;
}

export type RunOutputListener = (
  event: LocalAgentOutputEvent,
  attribution: RunOutputAttribution,
) => void;

/** Owns process-local Run events and the platform state emissions they drive. */
export class RunEventPublisher {
  private readonly runOutputListeners = new Set<RunOutputListener>();

  public constructor(private readonly dependencies: RunEventPublisherDependencies) {}

  /**
   * Observes attributed provider output before downstream Run normalization.
   * Listeners are read-only observers: one throwing never reaches the Run or
   * the other listeners.
   */
  public onRunOutput(listener: RunOutputListener): () => void {
    this.runOutputListeners.add(listener);
    return () => {
      this.runOutputListeners.delete(listener);
    };
  }

  private notifyRunOutput(event: LocalAgentOutputEvent, attribution: RunOutputAttribution): void {
    for (const listener of [...this.runOutputListeners]) {
      try {
        listener(event, attribution);
      } catch (error) {
        this.dependencies.logger.warn('run.output_listener_failed', {
          runId: event.runId,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  public publishAgentOutput(event: LocalAgentOutputEvent, attribution: RunOutputAttribution): void {
    const { runId, ...envelope } = event;
    this.dependencies.agentOutputEvents.publish({ kind: 'agent_output', runId, envelope });
    this.notifyRunOutput(event, attribution);

    if (event.eventType === 'run_completed' || event.eventType === 'task_complete') {
      this.dependencies.runLifecycleEvents.publishRunFinished(runId);
    }
  }

  public emitAgentSessionCurrentStateObservation(
    observation: AgentSessionCurrentStateObservation,
  ): void {
    const logPayload = {
      agentSessionId: observation.agentSessionId,
      currentState: observation.currentState,
      observedAt: observation.observedAt,
    };
    this.dependencies.logger.trace('run.platform.current_state_observation', logPayload);
    this.dependencies.platformWebSocketManager.emitAgentSessionCurrentStateObservation(observation);
  }

  public emitAgentSessionContextSizeObservation(
    observation: AgentSessionContextSizeObservation,
  ): void {
    this.dependencies.logger.trace('run.platform.context_size_observation', {
      agentSessionId: observation.agentSessionId,
      runId: observation.runId,
      providerSessionId: observation.providerSessionId,
      totalTokens: observation.totalTokens,
    });
    this.dependencies.platformWebSocketManager.emitAgentSessionContextSizeObservation(observation);
  }

  public emitConversationPhaseObservation(observation: ConversationPhaseObservation): void {
    this.dependencies.logger.trace('run.platform.conversation_phase_observation', {
      conversationId: observation.conversationId,
      phase: observation.phase,
      observedAt: observation.observedAt,
    });
    this.dependencies.platformWebSocketManager.emitConversationPhaseObservation(observation);
  }

  public emitProviderIdentity(input: {
    conversationId: string;
    agentSessionId: string;
    providerSessionId: string;
    providerConversationId: string | null;
  }): void {
    this.dependencies.logger.debug('run.platform.provider_identity', input);
    this.dependencies.platformWebSocketManager.emitProviderIdentity(input);
  }
}
