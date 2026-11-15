import type { ImplementReportPayload } from '@hey-hey/contracts/api/models';
import type { ServerLogger } from '../server/logger';

export type ImplementReportDecision = NonNullable<ImplementReportPayload['decisions']>[number];

/** What only the agent knows about its work: a handoff summary and notable decisions. */
export interface HeldImplementReport {
  summary: string;
  decisions: ImplementReportDecision[];
}

/**
 * Holds the agent's latest IMPLEMENT summary and decisions for the Turn until
 * the CLI emits one report per changed Service at turn end.
 */
export class TurnChangeRecord {
  private held: HeldImplementReport | null = null;

  public constructor(
    public readonly turnId: string,
    private readonly logger: ServerLogger,
  ) {}

  /** A later IMPLEMENT submission in the same Turn replaces the held values. */
  public hold(report: HeldImplementReport): void {
    this.held = { summary: report.summary, decisions: [...report.decisions] };
    this.logger.debug('runtime.turn.change_record.implement_held', {
      turnId: this.turnId,
      decisionCount: report.decisions.length,
    });
  }

  public heldReport(): HeldImplementReport | null {
    return this.held;
  }
}
