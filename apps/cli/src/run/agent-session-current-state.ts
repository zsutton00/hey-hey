import type {
  AgentSessionCurrentState,
  AgentSessionCurrentStateObservation,
} from '../shared/api/generated/api';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { ServerLogger } from '../server/logger';
import { PROVIDER_PHASE_TO_AGENT_SESSION_CURRENT_STATE, type ProviderPhase } from './types';

const createAgentSessionCurrentStateObservation = (input: {
  agentSessionId: string;
  currentState: AgentSessionCurrentState;
  observedAt?: string;
}): AgentSessionCurrentStateObservation => ({
  agentSessionId: input.agentSessionId,
  currentState: input.currentState,
  observedAt: input.observedAt ?? new Date().toISOString(),
});

const createProviderPhaseCurrentStateObservation = (input: {
  agentSessionId: string;
  providerPhase: ProviderPhase;
  observedAt?: string;
}): AgentSessionCurrentStateObservation =>
  createAgentSessionCurrentStateObservation({
    agentSessionId: input.agentSessionId,
    currentState: PROVIDER_PHASE_TO_AGENT_SESSION_CURRENT_STATE[input.providerPhase],
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
  });

export class AgentSessionCurrentStateOwner {
  private providerPhase: ProviderPhase | null = null;
  private pendingPlanReport: { reportId: string; turnId: string } | null = null;
  private pendingTerminalAssistantMessage: { messageId: string; turnId: string } | null = null;
  private persistedPlanAwaitingReview = false;
  private lastObservation: AgentSessionCurrentStateObservation | null = null;

  public constructor(
    private readonly runId: string,
    private readonly agentSessionId: string,
    private readonly eventPublisher: RunEventPublisher,
    private readonly logger: ServerLogger,
    /** Process-local signal raised after each effective-state publication. */
    private readonly onEffectiveStateChanged: () => void,
  ) {}

  public get currentProviderPhase(): ProviderPhase | null {
    return this.providerPhase;
  }

  /**
   * The effective state most recently published for this Run, including
   * PLAN_READY and AWAITING_APPROVAL that outlive turn settlement. Null until
   * the Run first publishes a state.
   */
  public get effectiveState(): AgentSessionCurrentStateObservation | null {
    return this.lastObservation;
  }

  public observeProviderPhase(phase: ProviderPhase): void {
    if (phase === 'starting') {
      if (this.persistedPlanAwaitingReview) {
        this.persistedPlanAwaitingReview = false;
        this.logger.info('local.run.current_state.plan_ready_replaced', {
          runId: this.runId,
          agentSessionId: this.agentSessionId,
          replacementState: 'STARTING',
        });
      }
      this.clearPendingPlanEvidence();
    }
    if (phase === 'starting' && this.providerPhase === 'starting') {
      this.logger.debug('local.run.current_state.starting_duplicate_skipped', {
        runId: this.runId,
        agentSessionId: this.agentSessionId,
      });
      return;
    }

    this.providerPhase = phase;
    this.publishEffectiveState();
  }

  public observePersistedPlanReady(reportId: string, turnId: string): void {
    this.pendingPlanReport = { reportId, turnId };
    this.logger.info('local.run.current_state.plan_ready_observed', {
      runId: this.runId,
      agentSessionId: this.agentSessionId,
      reportId,
      turnId,
    });
    this.publishPlanReadyWhenEvidenceComplete();
  }

  public observeFinalAssistantMessageCommitted(messageId: string, turnId: string): void {
    this.pendingTerminalAssistantMessage = { messageId, turnId };
    this.logger.info('local.run.current_state.terminal_assistant_message_observed', {
      runId: this.runId,
      agentSessionId: this.agentSessionId,
      messageId,
      turnId,
    });
    this.publishPlanReadyWhenEvidenceComplete();
  }

  public replay(): void {
    if (this.providerPhase !== null) {
      this.publishEffectiveState();
    }
  }

  public settleTurn(preserveAwaitingApproval = false): void {
    if (preserveAwaitingApproval) {
      this.providerPhase = 'awaiting_approval';
      this.publishEffectiveState();
      return;
    }
    if (this.persistedPlanAwaitingReview) {
      this.publishPlanReady();
    } else {
      this.clearPendingPlanEvidence();
      this.observeProviderPhase('idle');
    }
    this.providerPhase = null;
  }

  public cleanup(runtimeStateActive: boolean): void {
    if (runtimeStateActive && !this.persistedPlanAwaitingReview) {
      this.clearPendingPlanEvidence();
      this.observeProviderPhase('idle');
    }
    this.providerPhase = null;
  }

  private publishEffectiveState(): void {
    if (this.persistedPlanAwaitingReview && this.providerPhase !== 'awaiting_approval') {
      this.publishPlanReady();
      return;
    }
    if (this.providerPhase === null) return;

    this.publish(
      createProviderPhaseCurrentStateObservation({
        agentSessionId: this.agentSessionId,
        providerPhase: this.providerPhase,
      }),
    );
  }

  private publishPlanReady(): void {
    this.publish(
      createAgentSessionCurrentStateObservation({
        agentSessionId: this.agentSessionId,
        currentState: 'PLAN_READY',
      }),
    );
  }

  private publish(observation: AgentSessionCurrentStateObservation): void {
    this.lastObservation = observation;
    this.eventPublisher.emitAgentSessionCurrentStateObservation(observation);
    this.onEffectiveStateChanged();
  }

  private publishPlanReadyWhenEvidenceComplete(): void {
    const planReport = this.pendingPlanReport;
    const terminalAssistantMessage = this.pendingTerminalAssistantMessage;
    if (
      this.persistedPlanAwaitingReview ||
      planReport === null ||
      planReport.turnId !== terminalAssistantMessage?.turnId
    ) {
      this.logger.debug('local.run.current_state.plan_ready_waiting_for_evidence', {
        runId: this.runId,
        agentSessionId: this.agentSessionId,
        reportId: planReport?.reportId ?? null,
        reportTurnId: planReport?.turnId ?? null,
        messageId: terminalAssistantMessage?.messageId ?? null,
        messageTurnId: terminalAssistantMessage?.turnId ?? null,
      });
      return;
    }

    this.persistedPlanAwaitingReview = true;
    this.logger.info('local.run.current_state.plan_ready_evidence_complete', {
      runId: this.runId,
      agentSessionId: this.agentSessionId,
      reportId: planReport.reportId,
      messageId: terminalAssistantMessage.messageId,
      turnId: planReport.turnId,
    });
    this.publishPlanReady();
  }

  private clearPendingPlanEvidence(): void {
    this.pendingPlanReport = null;
    this.pendingTerminalAssistantMessage = null;
  }
}
