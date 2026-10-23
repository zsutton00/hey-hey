import type {
  ConversationPhase,
  ConversationPhaseObservation,
} from '../shared/api/generated/api';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { ServerLogger } from '../server/logger';
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

    if (phase === 'idle') {
      this.publish(phase);
      return;
    }

    if (this.reviewTurn && (this.phase === 'reviewing' || this.phase === 'awaiting_approval')) {
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
    this.publish('reviewing');
  }

  public resumeAfterApproval(): void {
    this.publish(this.reviewTurn ? 'reviewing' : 'thinking');
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

    this.publish('idle');
    this.phase = null;
    this.reviewTurn = false;
  }

  public cleanup(runtimeStateActive: boolean): void {
    if (runtimeStateActive || this.phase !== null) {
      this.publish('idle');
    }
    this.phase = null;
    this.reviewTurn = false;
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
