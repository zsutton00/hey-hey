import type { PlatformUnavailableStartupError } from '../server/startup-readiness';
import { CommonCliScenarioView } from '../views/common-cli-scenario-view';

/** Presents platform connectivity guidance without owning retry or transport behavior. */
export class PlatformUnavailableStartupPresenter {
  private readonly view: CommonCliScenarioView;

  public constructor(output: Pick<Console, 'log'> = console) {
    this.view = new CommonCliScenarioView(output);
  }

  public async present(error: PlatformUnavailableStartupError): Promise<void> {
    await this.view.render({ scenario: error.scenario });
  }
}
