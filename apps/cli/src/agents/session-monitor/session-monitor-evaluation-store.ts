import type { ServerLogger } from '../../server/logger';

export interface SessionMonitorEvaluationContext {
  readonly targetSessionId: string;
  readonly targetConversationId: string;
  readonly turnId: string;
  readonly completedAssistantContent: string | null;
  readonly reports: ReadonlyArray<{ readonly reportId: string; readonly reportType: string }>;
  readonly workflow: {
    readonly state: 'agent-pending' | 'live-non-agent' | 'terminal';
    readonly promptType: string | null;
    readonly nodeId: string | null;
    readonly triggerMessageId: string | null;
  };
  readonly availableActions: ReadonlyArray<string>;
}

export type SessionMonitorTurnEvaluationResult =
  | { status: 'HANDLED'; outcome: 'CONTINUED' | 'DEFERRED' }
  | { status: 'RELEASED'; reason: string }
  | { status: 'FAILED'; reason: string };

interface PendingEvaluation {
  readonly context: Readonly<SessionMonitorEvaluationContext>;
  readonly resolve: (result: SessionMonitorTurnEvaluationResult) => void;
}

/** Owns the one required evaluation context and result handoff for each monitor Run. */
export class SessionMonitorEvaluationStore {
  private readonly active = new Map<string, PendingEvaluation>();

  public constructor(private readonly logger: ServerLogger) {}

  public begin(
    monitorRunId: string,
    context: Readonly<SessionMonitorEvaluationContext>,
  ): Promise<SessionMonitorTurnEvaluationResult> {
    if (this.active.has(monitorRunId)) {
      throw new Error('Session Monitor evaluation already active for this Run.');
    }
    return new Promise((resolve) => {
      this.active.set(monitorRunId, { context, resolve });
      this.logger.debug('session_monitor.evaluation_store.bound', { monitorRunId });
    });
  }

  public requireContext(monitorRunId: string): Readonly<SessionMonitorEvaluationContext> {
    const pending = this.active.get(monitorRunId);
    if (!pending) throw new Error('Session Monitor evaluation context is unavailable.');
    return pending.context;
  }

  public resolve(monitorRunId: string, result: SessionMonitorTurnEvaluationResult): void {
    const pending = this.active.get(monitorRunId);
    if (!pending) return;
    this.active.delete(monitorRunId);
    pending.resolve(result);
  }

  public fail(monitorRunId: string, reason: string): void {
    this.resolve(monitorRunId, { status: 'FAILED', reason });
  }
}
