import type { ServerLogger } from './logger';

/** Delivers platform work to a CLI service; the service never learns how the work arrived. */
export interface DispatchSource<T> {
  subscribe(onWork: (work: T) => Promise<void>): { dispose(): void };
}

export interface PollingDispatchSourceOptions<T> {
  intervalMs: number;
  /** Fetches one unit of work; `null` means there is nothing to deliver this tick. */
  poll: () => Promise<T | null>;
  logger: ServerLogger;
  /** Logged when a poll or its delivery fails; the next tick tries again. */
  failureEvent: string;
}

/** Polls immediately on subscribe and then every `intervalMs`, never overlapping two polls. */
export class PollingDispatchSource<T> implements DispatchSource<T> {
  public constructor(private readonly options: PollingDispatchSourceOptions<T>) {}

  public subscribe(onWork: (work: T) => Promise<void>): { dispose(): void } {
    const { intervalMs, poll, logger, failureEvent } = this.options;
    let disposed = false;
    let polling = false;
    const tick = async (): Promise<void> => {
      if (polling || disposed) return;
      polling = true;
      try {
        const work = await poll();
        if (work !== null) await onWork(work);
      } catch (error) {
        logger.warn(failureEvent, {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void tick(), intervalMs);
    timer.unref();
    void tick();
    return {
      dispose: () => {
        disposed = true;
        clearInterval(timer);
      },
    };
  }
}
