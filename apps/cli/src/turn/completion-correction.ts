import type { CompletionValidationFailure } from '../agents/prompt-type-handler';
import type { AssistantCompleteEvent } from '../run/types';
import type { ServerLogger } from '../server/logger';

const MAX_COMPLETION_CORRECTION_ATTEMPTS = 2;

/**
 * One Turn owns its rejected final answer. A rejection keeps the trigger open
 * until the agent corrects it in the same provider session or the bounded
 * attempts run out; only exhaustion publishes the handler's failure outcome.
 */
export class CompletionCorrection {
  private rejection: {
    event: AssistantCompleteEvent;
    failure: CompletionValidationFailure;
  } | null = null;
  private attempts = 0;
  private correcting = false;
  private exhausted = false;

  public constructor(
    public readonly turnId: string,
    private readonly logger: ServerLogger,
  ) {}

  public get isCorrecting(): boolean {
    return this.correcting;
  }
  public get isExhausted(): boolean {
    return this.exhausted;
  }
  public get hasPendingRejection(): boolean {
    return this.rejection !== null;
  }
  public get attemptCount(): number {
    return this.attempts;
  }

  public reject(event: AssistantCompleteEvent, failure: CompletionValidationFailure): void {
    this.rejection = { event, failure };
    this.log('rejected', failure);
  }
  public accept(): void {
    if (this.rejection === null) return;
    this.rejection = null;
    this.log('accepted');
  }
  public beginCorrection(): string | null {
    if (
      this.rejection === null ||
      this.exhausted ||
      this.attempts >= MAX_COMPLETION_CORRECTION_ATTEMPTS
    )
      return null;
    this.attempts += 1;
    this.correcting = true;
    this.log('correction_started', this.rejection.failure);
    const { failure } = this.rejection;
    const issues = failure.issues?.length ? `\nIssues:\n- ${failure.issues.join('\n- ')}` : '';
    return `Your final answer was rejected and nothing has been published yet. Keep your research; do not repeat it. Return the complete final answer again in the required format, fixing only the errors below. Do not invent values you did not establish.\nError: ${failure.message}${issues}`;
  }
  public endCorrection(): void {
    this.correcting = false;
    this.log('correction_ended');
  }
  /** Returns the last rejected answer exactly once so the Turn publishes one failure. */
  public exhaust(): AssistantCompleteEvent | null {
    if (this.exhausted || this.rejection === null) return null;
    this.exhausted = true;
    this.log('correction_exhausted', this.rejection.failure);
    return this.rejection.event;
  }
  private log(action: string, failure?: CompletionValidationFailure): void {
    this.logger.debug('runtime.turn.completion_correction.transition', {
      turnId: this.turnId,
      action,
      attempts: this.attempts,
      ...(failure ? { code: failure.code, message: failure.message, issues: failure.issues } : {}),
    });
  }
}
