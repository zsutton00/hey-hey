import { runPairCommand } from './pair';
import type { StartupReadinessOutcome } from '../server/startup-readiness';
import { CommonCliScenarioView } from '../views/common-cli-scenario-view';

type PairingRequiredOutcome = Extract<StartupReadinessOutcome, { kind: 'pairing-required' }>;

/** Owns the pairing side effect used by the pairing-required startup presentation. */
export class PairingRequiredStartupRecovery {
  private readonly view: CommonCliScenarioView;

  public constructor(output: Pick<Console, 'log'> = console) {
    this.view = new CommonCliScenarioView(output);
  }

  public recover(outcome: PairingRequiredOutcome): Promise<boolean> {
    return this.view.render({
      scenario: outcome.scenario,
      onPairNow: () => runPairCommand(),
    });
  }
}
