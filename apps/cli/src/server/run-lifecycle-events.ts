import type { ReportInfluenceRuntime } from './reports/report-influence-runtime';

export type RunFinishedListener = (runId: string) => void;
export type RunRegisteredListener = (runId: string) => void;
export type RunRemovalCause = 'idle' | 'permanent';
export type RunRemovedListener = (runId: string, cause: RunRemovalCause) => void;
export type RunUpdatedListener = (runId: string) => void;

/**
 * Process-local lifecycle channel used to decouple Run construction from
 * consumers that own effects for an active Run.
 */
export class RunLifecycleEvents {
  private readonly runRegisteredListeners = new Set<RunRegisteredListener>();
  private readonly runRemovedListeners = new Set<RunRemovedListener>();
  private readonly runFinishedListeners = new Set<RunFinishedListener>();
  private readonly runUpdatedListeners = new Set<RunUpdatedListener>();

  public onRunRegistered(listener: RunRegisteredListener): () => void {
    this.runRegisteredListeners.add(listener);
    return () => this.runRegisteredListeners.delete(listener);
  }

  public publishRunRegistered(runId: string): void {
    for (const listener of this.runRegisteredListeners) {
      listener(runId);
    }
  }

  public onRunRemoved(listener: RunRemovedListener): () => void {
    this.runRemovedListeners.add(listener);
    return () => this.runRemovedListeners.delete(listener);
  }

  public publishRunRemoved(runId: string, cause: RunRemovalCause = 'permanent'): void {
    for (const listener of this.runRemovedListeners) {
      listener(runId, cause);
    }
  }

  /** A registered Run's locally readable state, activity or focal context changed. */
  public onRunUpdated(listener: RunUpdatedListener): () => void {
    this.runUpdatedListeners.add(listener);
    return () => this.runUpdatedListeners.delete(listener);
  }

  public publishRunUpdated(runId: string): void {
    for (const listener of this.runUpdatedListeners) {
      listener(runId);
    }
  }

  public onRunFinished(listener: RunFinishedListener): () => void {
    this.runFinishedListeners.add(listener);
    return () => this.runFinishedListeners.delete(listener);
  }

  public publishRunFinished(runId: string): void {
    for (const listener of this.runFinishedListeners) {
      listener(runId);
    }
  }
}

/** Applies the two domain effects caused by an active Run becoming terminal. */
export class RunCompletionEffects {
  public constructor(private readonly reportInfluenceRuntime: ReportInfluenceRuntime) {}

  public readonly handleRunFinished = (runId: string): void => {
    this.reportInfluenceRuntime.handleRunFinished(runId);
  };
}
