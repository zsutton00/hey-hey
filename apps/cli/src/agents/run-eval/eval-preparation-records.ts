import type { GatherTrace } from '../../jev/trace';
import type { PreparationRecords } from '../preparation-records';

/**
 * Preparation records of one eval attempt. The attempt's session exists only on
 * the platform, so its records stay with the attempt, where they can be
 * inspected, and never reach the local run store.
 */
export class EvalPreparationRecords implements PreparationRecords {
  private readonly traces: GatherTrace[] = [];

  public get gatherTraces(): readonly GatherTrace[] {
    return this.traces;
  }

  public appendGatherTrace(
    _runId: string,
    trace: Omit<GatherTrace, 'round'>,
  ): Promise<GatherTrace> {
    const round = this.traces.filter(({ turnId }) => turnId === trace.turnId).length + 1;
    const stored: GatherTrace = { ...trace, round };
    this.traces.push(stored);
    return Promise.resolve(stored);
  }
}
