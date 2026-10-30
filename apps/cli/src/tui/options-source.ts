/**
 * Presents the per-machine options file as a snapshot/update source for the
 * Options screen. The store owns persistence; this only holds the last value
 * read or written so the screen shows a change straight away.
 */

import type { MachineOptions, MachineOptionsStore } from '../options/machine-options-store';

export interface OptionsSnapshot {
  /** Null until the saved choice has been read. */
  readonly intentFirst: boolean | null;
  /** Null until the saved choice has been read. */
  readonly remoteToolCallViewing: boolean | null;
  /** Null until the saved choice has been read. */
  readonly jevEnabled: boolean | null;
  /** Whether the user's environment defines a Jev key; the saved choice is kept either way. */
  readonly jevKeyDefined: boolean;
}

export type OptionsObserver = (snapshot: OptionsSnapshot) => void;

export type OptionsStore = Pick<MachineOptionsStore, 'read' | 'update'>;

export class OptionsSource {
  private readonly observers = new Set<OptionsObserver>();
  private options: MachineOptions | null = null;
  private started = false;

  public constructor(
    private readonly store: OptionsStore,
    private readonly jevKeyDefined: boolean,
    private readonly report: (event: string, details: Record<string, unknown>) => void,
  ) {}

  public observe(observer: OptionsObserver): {
    snapshot: OptionsSnapshot;
    unsubscribe: () => void;
  } {
    this.observers.add(observer);
    if (!this.started) this.start();
    return {
      snapshot: this.snapshot(),
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  /** Saves the choice, then publishes it; a failed write rejects and changes nothing shown. */
  public async setIntentFirst(intentFirst: boolean): Promise<void> {
    await this.save({ intentFirst });
  }

  public async setRemoteToolCallViewing(remoteToolCallViewing: boolean): Promise<void> {
    await this.save({ remoteToolCallViewing });
  }

  public async setJevEnabled(jevEnabled: boolean): Promise<void> {
    await this.save({ jevEnabled });
  }

  private async save(patch: Partial<MachineOptions>): Promise<void> {
    this.options = await this.store.update(patch);
    this.publish();
  }

  private start(): void {
    this.started = true;
    void this.store.read().then(
      (options) => {
        // A write that finished while reading is newer than the read.
        if (this.options !== null) return;
        this.options = options;
        this.publish();
      },
      (error: unknown) => {
        this.report('presentation.options_read_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private snapshot(): OptionsSnapshot {
    return Object.freeze({
      intentFirst: this.options?.intentFirst ?? null,
      remoteToolCallViewing: this.options?.remoteToolCallViewing ?? null,
      jevEnabled: this.options?.jevEnabled ?? null,
      jevKeyDefined: this.jevKeyDefined,
    });
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const observer of [...this.observers]) observer(snapshot);
  }
}
