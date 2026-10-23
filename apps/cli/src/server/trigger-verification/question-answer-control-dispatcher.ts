import type { RunRegistry } from '../../run/run-registry';
import type { RunStore } from '../../run-store/run-store';
import type { ServerLogger } from '../logger';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';

export interface QuestionAnswerControlInput {
  readonly conversationId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly agentType: 'claude' | 'codex' | 'opencode';
  readonly answers: Record<string, string>;
  readonly idempotencyToken: string;
  readonly userId: string;
  readonly nonce: string;
}

/** Routes a signed `question_answer` control to the Run holding the waiting question. */
export class QuestionAnswerControlDispatcher {
  public constructor(
    private readonly runStore: RunStore,
    private readonly runRegistry: RunRegistry,
    private readonly runReadRestoreCoordinator: RunReadRestoreCoordinator,
    private readonly logger: ServerLogger,
  ) {}

  public dispatch(input: QuestionAnswerControlInput): void {
    const runId = this.runStore.lookupByConversationId(input.conversationId);
    if (!runId) {
      this.logger.warn('trigger-verification.control.no_active_run', {
        kind: 'question_answer',
        conversationId: input.conversationId,
        requestId: input.requestId,
        nonce: input.nonce,
      });
      return;
    }

    void this.deliver(runId, input).catch((error: unknown) => {
      this.logger.error('trigger-verification.control.question_answer.dispatch_failed', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        nonce: input.nonce,
        error,
      });
    });
  }

  private async deliver(runId: string, input: QuestionAnswerControlInput): Promise<void> {
    if (input.agentType !== 'claude') {
      this.logger.warn('trigger-verification.control.question_answer.unsupported_agent_type', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        agentType: input.agentType,
        nonce: input.nonce,
      });
      return;
    }
    if (!this.runRegistry.get(runId)) {
      await this.runReadRestoreCoordinator.restore(runId);
      this.logger.info('trigger-verification.control.question_answer.run_restored', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        nonce: input.nonce,
      });
    }
    const result = this.runRegistry.submitQuestionAnswer(runId, {
      requestId: input.requestId,
      idempotencyToken: input.idempotencyToken,
      answers: input.answers,
    });
    if (result.outcome === 'delivered') {
      this.logger.info('trigger-verification.control.question_answer.delivered', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        nonce: input.nonce,
      });
      return;
    }
    this.logger.warn('trigger-verification.control.question_answer.not_delivered', {
      conversationId: input.conversationId,
      runId,
      requestId: input.requestId,
      outcome: result.outcome,
      ...('reason' in result ? { reason: result.reason } : {}),
      nonce: input.nonce,
    });
  }
}
