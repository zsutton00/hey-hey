import type { ServerLogger } from '../../server/logger';
import type { ActivityRecord } from './types';
import { fetchRecentActivity, type FetchActivityDeps } from './fetch-activity';

/**
 * The single snapshot a daily-session firing produces: the current activity
 * snapshot plus the number of signals that drove this firing. A firing is a
 * clean evaluation of current state, so there is no longer a targeted vs.
 * snapshot distinction — every firing fetches one activity snapshot.
 */
export interface DeltaResult {
  activity: ActivityRecord[];
  signalCount: number;
  computedAt: string;
}

export interface DeltaCalculatorDeps extends FetchActivityDeps {
  logger: ServerLogger;
}

/**
 * Compute the firing snapshot for a drained batch of signals. `signalCount` is
 * the size of the batch that tripped the gate; the activity snapshot is the
 * current correlated activity fetched fresh for this firing. Returns an empty
 * snapshot without a fetch when the batch is empty (a firing always carries at
 * least one signal, so this is a defensive guard).
 */
export async function calculateDelta(
  signalCount: number,
  deps: DeltaCalculatorDeps,
): Promise<DeltaResult> {
  const now = new Date().toISOString();

  if (signalCount <= 0) {
    return { activity: [], signalCount: 0, computedAt: now };
  }

  deps.logger.info('daily-session.delta-calculator.snapshot', { signalCount });

  const activity = await fetchRecentActivity(deps);

  return { activity, signalCount, computedAt: now };
}
