import type { RunRegistry } from '../run/run-registry';

/** Replays active Run phases after the platform WebSocket reconnects. */
export class RunPhaseReplayer {
  public constructor(private readonly runRegistry: RunRegistry) {}

  public readonly handleReconnect = (): void => {
    for (const run of this.runRegistry.list()) {
      run.emitCurrentStateIfActive();
    }
  };
}
