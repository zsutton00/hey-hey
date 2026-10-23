import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineReadinessSnapshot } from '../auth/machine-controller-authority';
import { classifyStartupReadiness } from '../server/startup-readiness';
import { CommonCliScenarioView } from '../views/common-cli-scenario-view';
import { runPairCommand } from './pair';
import { PairingRequiredStartupRecovery } from './pairing-required-startup-recovery';

vi.mock('./pair', () => ({ runPairCommand: vi.fn() }));

const snapshot: MachineReadinessSnapshot = {
  state: 'machine-revoked',
  machineId: null,
  machine: null,
  localControllers: [],
  serverControllers: [],
  serverExecutionReadiness: null,
};

describe('PairingRequiredStartupRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supplies the existing pairing ceremony as the view action', async () => {
    vi.mocked(runPairCommand).mockResolvedValue(true);
    const render = vi
      .spyOn(CommonCliScenarioView.prototype, 'render')
      .mockImplementation(async (props) => ('onPairNow' in props ? props.onPairNow() : false));
    const outcome = classifyStartupReadiness(snapshot, 'pair again');
    if (outcome.kind !== 'pairing-required') throw new Error('Expected pairing recovery.');

    const recovered = await new PairingRequiredStartupRecovery().recover(outcome);

    expect(recovered).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    const props = render.mock.calls[0]?.[0];
    expect(props?.scenario).toBe(outcome.scenario);
    expect(runPairCommand).toHaveBeenCalledTimes(1);
  });
});
