import type {
  ConversationPhase,
  ConversationPhaseObservation,
} from '@hey-hey/contracts/api/models';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { ServerLogger } from '../server/logger';
import type { ApprovalReleaseReason } from './agent-session-current-state';
import type { ProviderPhase } from './types';

export const createConversationPhaseObservation = (input: {
  conversationId: string;
  phase: ConversationPhase;
  observedAt?: string;
}): ConversationPhaseObservation => ({
  conversationId: input.conversationId,
  phase: input.phase,
  observedAt: input.observedAt ?? new Date().toISOString(),
});

/** Owns the conversation-scoped phase without widening Agent Session state. */
export class ConversationPhaseOwner {
  private phase: ConversationPhase | null = null;
  private reviewTurn = false;

  public constructor(
    private readonly runId: string,
    private readonly conversationId: string,
    private readonly eventPublisher: RunEventPublisher,
    private readonly logger: ServerLogger,
  ) {}

  public get currentPhase(): ConversationPhase | null {
    return this.phase;
  }

  public observeProviderPhase(phase: ProviderPhase): void {
    if (phase === 'awaiting_approval') {
      this.publish(phase);
      return;
    }

    if (this.phase === 'awaiting_approval') {
      if (phase === 'idle' || phase === 'starting') {
        this.logRelease(phase === 'idle' ? 'turn_settled' : 'new_turn', phase);
        this.publish(phase);
        return;
      }
      this.logger.debug('local.run.conversation_phase.provider_phase_ignored_during_approval', {
        runId: this.runId,
        conversationId: this.conversationId,
        providerPhase: phase,
      });
      return;
    }

    if (phase === 'idle') {
      this.publish(phase);
      return;
    }

    if (this.reviewTurn && this.phase === 'reviewing') {
      this.logger.debug('local.run.conversation_phase.provider_phase_preserved', {
        runId: this.runId,
        conversationId: this.conversationId,
        reviewTurn: true,
        providerPhase: phase,
        currentPhase: this.phase,
      });
      return;
    }

    this.publish(phase);
  }

  public observeReviewing(): void {
    this.reviewTurn = true;
    if (this.phase === 'awaiting_approval') {
      this.logger.debug('local.run.conversation_phase.provider_phase_ignored_during_approval', {
        runId: this.runId,
        conversationId: this.conversationId,
        providerPhase: 'reviewing',
      });
      return;
    }
    this.publish('reviewing');
  }

  /** Ends the approval hold and publishes the resumed phase without waiting for the provider. */
  public resolveApproval(reason: 'decision_delivered' | 'question_answered'): void {
    const nextPhase = this.reviewTurn ? 'reviewing' : 'thinking';
    if (this.phase === 'awaiting_approval') {
      this.logRelease(reason, nextPhase);
    }
    this.publish(nextPhase);
  }

  public replay(): void {
    if (this.phase !== null) {
      this.publish(this.phase);
    }
  }

  public settleTurn(preserveAwaitingApproval = false): void {
    if (preserveAwaitingApproval && this.phase === 'awaiting_approval') {
      this.replay();
      return;
    }

    if (this.phase === 'awaiting_approval') {
      this.logRelease('turn_settled', 'idle');
    }
    this.publish('idle');
    this.phase = null;
    this.reviewTurn = false;
  }

  public cleanup(runtimeStateActive: boolean): void {
    if (this.phase === 'awaiting_approval') {
      this.logRelease('cleanup', 'idle');
    }
    if (runtimeStateActive || this.phase !== null) {
      this.publish('idle');
    }
    this.phase = null;
    this.reviewTurn = false;
  }

  private logRelease(
    reason: ApprovalReleaseReason,
    nextPhase: ProviderPhase | ConversationPhase,
  ): void {
    this.logger.info('local.run.conversation_phase.awaiting_approval_released', {
      runId: this.runId,
      conversationId: this.conversationId,
      reason,
      nextPhase,
    });
  }

  private publish(phase: ConversationPhase): void {
    this.phase = phase;
    this.logger.debug('local.run.conversation_phase.observed', {
      runId: this.runId,
      conversationId: this.conversationId,
      phase,
      reviewTurn: this.reviewTurn,
    });
    this.eventPublisher.emitConversationPhaseObservation(
      createConversationPhaseObservation({
        conversationId: this.conversationId,
        phase,
      }),
    );
  }
}
