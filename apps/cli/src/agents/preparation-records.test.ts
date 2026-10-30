import { describe, expect, it, vi } from 'vitest';
import type { GatherTrace } from '../jev/trace';
import { createRunStorePreparationRecords } from './preparation-records';
import { EvalPreparationRecords } from './run-eval/eval-preparation-records';

const trace = { runId: 'run', turnId: 'turn' } as Omit<GatherTrace, 'round'>;

describe('PreparationRecords', () => {
  it('writes a real Run’s gather trace through the run store', async () => {
    const stored = { ...trace, round: 1 } as GatherTrace;
    const appendRunGatherTrace = vi.fn().mockResolvedValue(stored);

    const result = await createRunStorePreparationRecords({
      appendRunGatherTrace,
    }).appendGatherTrace('run', trace);

    expect(appendRunGatherTrace).toHaveBeenCalledWith('run', trace);
    expect(result).toBe(stored);
  });

  it('numbers an eval attempt’s traces per turn and keeps them for inspection', async () => {
    const records = new EvalPreparationRecords();

    const first = await records.appendGatherTrace('target', trace);
    const second = await records.appendGatherTrace('target', trace);
    const other = await records.appendGatherTrace('target', { ...trace, turnId: 'other' });

    expect([first.round, second.round, other.round]).toEqual([1, 2, 1]);
    expect(records.gatherTraces).toEqual([first, second, other]);
  });
});
