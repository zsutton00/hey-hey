import type { CredentialPrompter } from '@hey-hey/ui-common/agents';

import type { MachineEnrollmentPollReadyDto } from '../shared/api/index';

/**
 * MachineEnrollmentCeremony — one Pair or Add-controller attempt as typed,
 * screen-friendly steps with typed input.
 *
 * The enrollment owners (pairing, controller authority, confirmation) drive
 * the attempt through `ports`; a presentation layer observes steps and answers
 * the local review through `respond`. Steps are display data only: device
 * secrets, nonces, signatures, protected storage and the activation decision
 * stay inside the owners. Exactly one `finished` step ends every ceremony,
 * after which input is refused and observers are released, so leaving a
 * ceremony cannot leave a second input path behind.
 */

/** Display-safe claimant details for local review. */
export interface MachineEnrollmentReview {
  readonly machineName: string;
  readonly osFamily: MachineEnrollmentPollReadyDto['osFamily'];
  readonly controllerLabel: string;
  readonly controllerCredentialFingerprint: string;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly expiresAt: string;
}

export type MachineEnrollmentOutcome =
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'terminal'
  | 'cancelled'
  | 'failed';

export type MachineEnrollmentCeremonyStep =
  /** The browser must complete the enrollment with this code. */
  | { readonly kind: 'browser-handoff'; readonly userCode: string }
  | { readonly kind: 'waiting-for-browser'; readonly expiresAt: string; readonly resumed: boolean }
  /** Waits for a `confirm` input. */
  | { readonly kind: 'local-review'; readonly review: MachineEnrollmentReview }
  | { readonly kind: 'activating' }
  /** A safe, human-readable explanation of why the attempt is not progressing. */
  | { readonly kind: 'problem'; readonly message: string }
  | { readonly kind: 'finished'; readonly outcome: MachineEnrollmentOutcome };

export interface MachineEnrollmentCeremonyInput {
  readonly kind: 'confirm';
  readonly approved: boolean;
}

/** What enrollment owners use to drive a ceremony. */
export interface MachineEnrollmentCeremonyPorts {
  readonly signal: AbortSignal;
  step(step: Exclude<MachineEnrollmentCeremonyStep, { kind: 'finished' }>): void;
  /** Resolves with the user's answer; rejects with `MachineEnrollmentCancelledError` on cancel. */
  requestConfirmation(review: MachineEnrollmentReview): Promise<boolean>;
}

export type MachineEnrollmentCeremonyObserver = (step: MachineEnrollmentCeremonyStep) => void;

export class MachineEnrollmentCancelledError extends Error {
  public constructor() {
    super('Machine enrollment was cancelled.');
    this.name = 'MachineEnrollmentCancelledError';
  }
}

export const toMachineEnrollmentReview = (
  ready: MachineEnrollmentPollReadyDto,
): MachineEnrollmentReview => ({
  machineName: ready.machineName,
  osFamily: ready.osFamily,
  controllerLabel: ready.controllerLabel,
  controllerCredentialFingerprint: ready.controllerCredentialFingerprint,
  backupEligible: ready.backupEligible,
  backupState: ready.backupState,
  expiresAt: ready.expiresAt,
});

export class MachineEnrollmentCeremony {
  private readonly observers = new Set<MachineEnrollmentCeremonyObserver>();
  private readonly abort = new AbortController();
  private current: MachineEnrollmentCeremonyStep | null = null;
  private pendingConfirmation: {
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;
  private started = false;

  public readonly ports: MachineEnrollmentCeremonyPorts = {
    signal: this.abort.signal,
    step: (step) => this.publish(step),
    requestConfirmation: (review) => {
      if (this.abort.signal.aborted) return Promise.reject(new MachineEnrollmentCancelledError());
      return new Promise<boolean>((resolve, reject) => {
        this.pendingConfirmation = { resolve, reject };
        this.publish({ kind: 'local-review', review });
      });
    },
  };

  public get step(): MachineEnrollmentCeremonyStep | null {
    return this.current;
  }

  public get finished(): boolean {
    return this.current?.kind === 'finished';
  }

  public observe(observer: MachineEnrollmentCeremonyObserver): {
    step: MachineEnrollmentCeremonyStep | null;
    unsubscribe: () => void;
  } {
    if (!this.finished) this.observers.add(observer);
    return {
      step: this.current,
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  /** Answers the open local review. Returns false when no review is waiting. */
  public respond(input: MachineEnrollmentCeremonyInput): boolean {
    const pending = this.pendingConfirmation;
    if (!pending || this.current?.kind !== 'local-review') return false;
    this.pendingConfirmation = null;
    pending.resolve(input.approved);
    return true;
  }

  /**
   * Stops the attempt. Waiting and review end promptly; an activation already
   * sent to the server is allowed to finish so protected state stays whole.
   */
  public cancel(): void {
    if (this.finished || this.abort.signal.aborted) return;
    this.abort.abort();
    const pending = this.pendingConfirmation;
    this.pendingConfirmation = null;
    pending?.reject(new MachineEnrollmentCancelledError());
  }

  /** Runs one owner operation as this ceremony. A ceremony runs once. */
  public async run<R extends { outcome: MachineEnrollmentOutcome }>(
    operation: (ports: MachineEnrollmentCeremonyPorts) => Promise<R>,
    onError: (error: Error) => R,
  ): Promise<R | { outcome: 'cancelled' }> {
    if (this.started) throw new Error('A machine enrollment ceremony runs only once.');
    this.started = true;
    let result: R | { outcome: 'cancelled' };
    try {
      result = await operation(this.ports);
    } catch (error) {
      // A cancel that escapes the owner is still a cancel, not a failure.
      if (error instanceof MachineEnrollmentCancelledError) {
        result = { outcome: 'cancelled' };
      } else {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.publish({ kind: 'problem', message: failure.message });
        result = onError(failure);
      }
    }
    this.pendingConfirmation = null;
    this.publish({ kind: 'finished', outcome: result.outcome });
    this.observers.clear();
    return result;
  }

  private publish(step: MachineEnrollmentCeremonyStep): void {
    if (this.finished) return;
    this.current = step;
    for (const observer of [...this.observers]) {
      try {
        observer(step);
      } catch {
        // A failing presentation must not stall the enrollment owner.
      }
    }
  }
}

const CLAIM_READY_MESSAGE =
  'Pairing is ready for local confirmation. Review the details in your browser.';
const CONFIRM_PAIRING_PROMPT = 'Confirm pairing on this machine?';
const PAIRING_DECLINED_MESSAGE = 'Pairing declined. This machine was not activated.';
const PAIRING_COMPLETED_MESSAGE = 'Pairing complete. This machine is now active.';

export interface DirectEnrollmentOutput {
  log: (message: string) => void;
  logError: (message: string) => void;
  prompter: Pick<CredentialPrompter, 'confirm'>;
  /** Renders the browser handoff; omit when the caller already printed it. */
  describeHandoff?: (userCode: string) => string;
}

/**
 * Direct-command adapter: prints steps as terminal lines and answers the
 * local review with the terminal prompter. Only direct commands and startup
 * recovery use it; a screen supplies input through `respond` instead.
 */
export const attachDirectEnrollmentOutput = (
  ceremony: MachineEnrollmentCeremony,
  output: DirectEnrollmentOutput,
): (() => void) =>
  ceremony.observe((step) => {
    switch (step.kind) {
      case 'browser-handoff':
        if (output.describeHandoff) output.log(output.describeHandoff(step.userCode));
        return;
      case 'local-review':
        output.log(CLAIM_READY_MESSAGE);
        void output.prompter.confirm(CONFIRM_PAIRING_PROMPT, false).then(
          (approved) => ceremony.respond({ kind: 'confirm', approved }),
          (error: unknown) => {
            output.logError(
              `Machine enrollment confirmation cancelled: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            ceremony.respond({ kind: 'confirm', approved: false });
          },
        );
        return;
      case 'problem':
        output.logError(step.message);
        return;
      case 'finished':
        if (step.outcome === 'confirmed') output.log(PAIRING_COMPLETED_MESSAGE);
        if (step.outcome === 'declined') output.log(PAIRING_DECLINED_MESSAGE);
        return;
      case 'waiting-for-browser':
      case 'activating':
        return;
    }
  }).unsubscribe;
