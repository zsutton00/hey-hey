import type { ServerLogger } from './logger';

/** The lifecycle surface the application runtime needs from one durable machine stack. */
export interface HostedMachine {
  /** Log label only; the runtime never branches on it. */
  readonly name: string;
  /**
   * An optional machine that fails to restore is logged and stays unavailable
   * on its own; start() still resolves and the next start() retries it.
   */
  readonly optional?: boolean;
  restore(): Promise<{ readonly snapshots: readonly unknown[] }>;
  startLiveProcessing(): void;
  stopClaiming(): void;
}

/** Adapts one machine stack's recovery and effect runner into a hosted machine. */
export const hostMachine = (
  name: string,
  recovery: { restore(): Promise<{ readonly snapshots: readonly unknown[] }> },
  effectRunner: { startLiveProcessing(): void; stopClaiming(): void },
  publication?: { replay(): Promise<void> },
): HostedMachine => ({
  name,
  restore: async () => {
    const restored = await recovery.restore();
    await publication?.replay();
    return restored;
  },
  startLiveProcessing: () => {
    effectRunner.startLiveProcessing();
  },
  stopClaiming: () => {
    effectRunner.stopClaiming();
  },
});

/**
 * Owns startup restoration and the shutdown claim fence for durable machines.
 * Each hosted machine restores before its own live processing starts; a machine
 * that fails leaves the others running and is retried by the next start().
 */
export class StateMachineApplicationRuntime {
  private startPromise: Promise<void> | null = null;
  private readonly started = new Set<HostedMachine>();
  private disposed = false;

  public constructor(
    private readonly machines: readonly HostedMachine[],
    private readonly logger: ServerLogger,
  ) {}

  public start(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('StateMachineApplicationRuntime has been disposed.'));
    }
    this.startPromise ??= this.startPending().then(
      () => {
        // An optional machine is still down; leave the next start() free to retry it.
        if (this.started.size < this.machines.length) this.startPromise = null;
      },
      (error: unknown) => {
        this.startPromise = null;
        throw error;
      },
    );
    return this.startPromise;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const machine of this.machines) {
      machine.stopClaiming();
    }
    this.logger.debug('state_machine.application.stopped');
  }

  private async startPending(): Promise<void> {
    const pending = this.machines.filter((machine) => !this.started.has(machine));
    this.logger.debug('state_machine.application.starting', {
      machines: pending.map((machine) => machine.name),
    });
    const results = await Promise.all(
      pending.map(async (machine) => {
        try {
          await this.startMachine(machine);
          return { status: 'fulfilled' as const };
        } catch (error: unknown) {
          return { status: 'rejected' as const, machine, error };
        }
      }),
    );
    if (this.disposed) {
      throw new Error('StateMachineApplicationRuntime has been disposed.');
    }
    const rejected = results.filter((result) => result.status === 'rejected');
    for (const { machine, error } of rejected) {
      if (!machine.optional) continue;
      this.logger.error('state_machine.application.machine_unavailable', {
        machine: machine.name,
        error,
      });
    }
    const failures = rejected.filter(({ machine }) => !machine.optional);
    if (failures.length === 1 && failures[0]) throw failures[0].error;
    if (failures.length > 1) {
      const failedMachineNames = failures.map(({ machine }) => machine.name);
      throw new AggregateError(
        failures.map(({ error }) => error),
        `Multiple state machines failed to start: ${failedMachineNames.join(', ')}.`,
      );
    }
    this.logger.info('state_machine.application.started', {
      machineCount: this.machines.length,
      unavailableMachines: rejected.map(({ machine }) => machine.name),
    });
  }

  private async startMachine(machine: HostedMachine): Promise<void> {
    const result = await machine.restore();
    // Claims were fenced mid-restore; starting now would reopen them.
    if (this.disposed) return;
    machine.startLiveProcessing();
    this.started.add(machine);
    this.logger.info('state_machine.application.machine_started', {
      machine: machine.name,
      restoredInstanceCount: result.snapshots.length,
    });
  }
}
