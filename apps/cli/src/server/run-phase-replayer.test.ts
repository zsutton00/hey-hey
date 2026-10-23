import { describe, expect, it, vi } from 'vitest';
import { createTestRun } from '../run/run.test-support';
import { createTestRunRegistryWiring } from './__tests__/helpers/test-run-registry';
import { RunPhaseReplayer } from './run-phase-replayer';

describe('RunPhaseReplayer', () => {
  it('asks each registered Run to replay its active phase', () => {
    const first = createTestRun({ runId: 'first-run' });
    const second = createTestRun({ runId: 'second-run' });
    vi.spyOn(first, 'emitCurrentStateIfActive').mockImplementation(() => undefined);
    vi.spyOn(second, 'emitCurrentStateIfActive').mockImplementation(() => undefined);
    const { runRegistry } = createTestRunRegistryWiring();
    vi.spyOn(runRegistry, 'list').mockReturnValue([first, second]);
    const replayer = new RunPhaseReplayer(runRegistry);

    replayer.handleReconnect();

    expect(first.emitCurrentStateIfActive).toHaveBeenCalledOnce();
    expect(second.emitCurrentStateIfActive).toHaveBeenCalledOnce();
  });
});
