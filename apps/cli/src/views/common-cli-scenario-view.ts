import { createInteractivePrompter, type CredentialPrompter } from '@hey-hey/ui-common/agents';
import { renderAsciiLogBox } from '../shared/logging/ascii-log-box';

export interface PairingRequiredScenario {
  kind: 'pairing-required';
  heading: string;
  body: string;
  primaryAction: {
    kind: 'pair-now';
    label: 'Pair Now';
  };
}

export interface PlatformUnavailableScenario {
  kind: 'platform-unavailable';
  heading: string;
  body: string;
}

type CommonCliScenario = PairingRequiredScenario | PlatformUnavailableScenario;

export type CommonCliScenarioViewProps =
  | {
      scenario: PairingRequiredScenario;
      onPairNow: () => Promise<boolean>;
    }
  | {
      scenario: PlatformUnavailableScenario;
    };

const renderCommonCliScenarioFrame = (scenario: CommonCliScenario): string => {
  return renderAsciiLogBox(scenario.heading, ['', scenario.body]);
};

/** Renders typed CLI scenario content and delegates actions to the owning lifecycle. */
export class CommonCliScenarioView {
  public constructor(
    private readonly output: Pick<Console, 'log'> = console,
    private readonly prompter: Pick<CredentialPrompter, 'confirm'> = createInteractivePrompter(),
  ) {}

  public async render(props: CommonCliScenarioViewProps): Promise<boolean> {
    this.output.log(renderCommonCliScenarioFrame(props.scenario));
    if (!('onPairNow' in props)) return false;

    const selected = await this.prompter.confirm(`${props.scenario.primaryAction.label}?`, false);
    return selected ? props.onPairNow() : false;
  }
}
