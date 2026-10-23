import { runDefaultServer, terminalStreamFlags } from '../tui/interactive-terminal';
import { runPairCommand } from './pair';
import type { ServerCommandOptions } from './server';

/**
 * Owns the pair command's transition into the foreground local-server lifecycle.
 * The server owner is not constructed until pairing has fully succeeded.
 */
export class PairServerCommand {
  public async run(options: ServerCommandOptions = {}): Promise<boolean> {
    const paired = await runPairCommand();
    if (!paired) {
      return false;
    }

    return this.runServerAfterPairing(options);
  }

  /**
   * Enters the same foreground server lifecycle as the default command after
   * another command has completed the protected pairing/confirmation boundary:
   * the menu in an interactive terminal, line output otherwise.
   */
  public async runServerAfterPairing(options: ServerCommandOptions = {}): Promise<boolean> {
    return runDefaultServer(terminalStreamFlags(), options);
  }
}
