import type { GatherTrace } from '../jev/trace';
import type { RunStore } from '../run-store/run-store';

/**
 * The records a handler writes while preparing a Turn. Handlers record through
 * this port and never reach the run store, so a caller whose session is not in
 * the store (an eval attempt) can back it with its own evidence.
 */
export interface PreparationRecords {
  /** Records one context-gathering trace for the Run and returns it with its round. */
  appendGatherTrace(runId: string, trace: Omit<GatherTrace, 'round'>): Promise<GatherTrace>;
}

/** A real Run's records live in its run metadata. */
export const createRunStorePreparationRecords = (
  runStore: Pick<RunStore, 'appendRunGatherTrace'>,
): PreparationRecords => ({
  appendGatherTrace: (runId, trace) => runStore.appendRunGatherTrace(runId, trace),
});
