import { z } from 'zod';
import type { CredentialPrompter } from '../agent-runtime/credentials/cli/interactivePrompt';
import { LocalPasskeyRepairState } from '../shared/api/index';

const REPAIR_URL = 'http://localhost:3000/api/v1/auth/local/repair';
const POLL_INTERVAL_MS = 2_000;

// The API wraps every success in the standard ApiResponse envelope; only `data` is ours to validate.
const repairStatusResponseSchema = z.object({
  data: z.strictObject({ state: z.nativeEnum(LocalPasskeyRepairState) }),
});

/** Whatever else is reading the terminal while pairing waits for the browser. */
export interface TerminalReader {
  pause(): void;
  resume(): void;
}

/**
 * While pairing waits for the browser, the setup page may ask for a Repair
 * because the passkey this computer was set up with can't be used. Nothing is
 * revoked until the person says yes here, at the terminal that ran
 * `heyhey local`; the answer is reported with the installation secret.
 */
export class LocalPasskeyRepair {
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private lastFailure: string | null = null;

  constructor(
    private readonly installationSecret: string,
    private readonly prompter: Pick<CredentialPrompter, 'confirm'>,
    private readonly terminal: TerminalReader,
    private readonly log: (message: string) => void = console.log,
    private readonly logError: (message: string) => void = console.error,
  ) {}

  /**
   * Starts following the setup page this run opens. A request left unanswered
   * by an earlier run is dismissed first, so the person is only ever asked
   * about a Repair they just pressed.
   */
  async watch(): Promise<void> {
    if (this.timer) {
      return;
    }

    try {
      const earlier = await this.send('GET', '/request');
      if (earlier === LocalPasskeyRepairState.Requested) {
        await this.send('POST', '/decision', { approved: false });
        this.log('Dismissed an unanswered repair request from an earlier run.');
      }
    } catch (error: unknown) {
      this.reportFailure(error);
    }

    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  /** One look at the installation: asks at the terminal when a Repair is waiting. */
  async check(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const state = await this.send('GET', '/request');
      this.lastFailure = null;
      if (state === LocalPasskeyRepairState.Requested) {
        await this.askAndDecide();
      }
    } catch (error: unknown) {
      this.reportFailure(error);
    } finally {
      this.checking = false;
    }
  }

  private async askAndDecide(): Promise<void> {
    this.terminal.pause();
    try {
      this.log(
        [
          '',
          'The setup page asked to repair this computer.',
          "The passkey this computer was set up with can't be used in that browser.",
          'Repair turns off the old passkey for this computer and lets you create a new one.',
          'Your projects and work are kept.',
        ].join('\n'),
      );
      const approved = await this.prompter.confirm('Repair this computer now?');
      const state = await this.send('POST', '/decision', { approved });
      this.log(
        state === LocalPasskeyRepairState.Completed
          ? 'Repaired. Go back to the browser to create your new passkey.'
          : 'Nothing was changed. You can try your existing passkey again in the browser.',
      );
    } finally {
      this.terminal.resume();
    }
  }

  private async send(
    method: 'GET' | 'POST',
    path: '/request' | '/decision',
    body?: { approved: boolean },
  ): Promise<LocalPasskeyRepairState> {
    const response = await fetch(`${REPAIR_URL}${path}`, {
      method,
      headers: {
        'X-HeyHey-Local-Secret': this.installationSecret,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} returned HTTP ${String(response.status)}: ${text}`);
    }

    return repairStatusResponseSchema.parse(JSON.parse(text)).data.state;
  }

  /** Polling repeats, so the same failure is reported once, with its cause. */
  private reportFailure(error: unknown): void {
    const failure = error instanceof Error ? error.message : String(error);
    if (failure === this.lastFailure) {
      return;
    }

    this.lastFailure = failure;
    this.logError(`Local passkey repair could not be checked: ${failure}`);
  }
}
