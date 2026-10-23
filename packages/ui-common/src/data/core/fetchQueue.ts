import logger from "../../utils/logger";
import type { QueryKey } from "./types";

/**
 * Per-query-key fixed-window fetch queue.
 *
 * This replaces leading-edge request dedupe. Instead of *suppressing* requests
 * that arrive shortly after a fetch, the queue *coalesces* them:
 *
 *   idle ─request─▶ windowing ─window elapses─▶ fetching
 *     ▲                │ ▲                         │
 *     │ no queued work │ │ requests fold in         │ request arrives
 *     └────────────────┘ └─────────────────────────┤   → queued slot
 *                  fetch done, queued slot set ─────┘
 *
 * Every cycle opens the same fixed window. This lets mount, focus, and
 * event-driven demand arriving close together share one authoritative read,
 * whether the key was idle or a fetch just completed.
 *
 * Guarantees:
 *  - A request enqueued at time T is only satisfied by a fetch whose network
 *    call starts strictly after T. A request that lands while a fetch is in
 *    flight is parked in the coalesced "queued" slot and served by the *next*
 *    cycle — never by the fetch that was already running.
 *  - At most one in-flight fetch per key.
 *  - The coalescing window is fixed and never reset, so a continuous burst still
 *    fires roughly every (window + fetch duration) and never starves.
 *
 * Every caller receives a promise that resolves with the result of the fetch
 * cycle that satisfies it, so callers awaiting a dispatch still get data back.
 */

type Deferred<R> = {
  promise: Promise<R>;
  resolve: (value: R) => void;
  reject: (reason: unknown) => void;
};

/** Provisional uniform coalescing window used by every collection fetch. */
export const FETCH_COALESCING_WINDOW_MS = 50;

function createDeferred<R>(): Deferred<R> {
  let resolve!: (value: R) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<R>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FetchQueueRunContext {
  enqueuedDuringInFlight: boolean;
}

type RunFetch<R> = (context: FetchQueueRunContext) => Promise<R>;

const createRunContext = (
  enqueuedDuringInFlight: boolean,
): FetchQueueRunContext => ({
  enqueuedDuringInFlight,
});

type QueueEntry<R> = {
  phase: "windowing" | "fetching";
  /** Callers awaiting the cycle currently being windowed / fetched. */
  cycle: Deferred<R>;
  /** Fetch closure for the current cycle (the window-opener's). */
  runFetch: RunFetch<R>;
  runContext: FetchQueueRunContext;
  windowTimer: ReturnType<typeof setTimeout> | null;
  /** Coalesced "next cycle", populated by requests that arrive mid-fetch. */
  queuedCycle: Deferred<R> | null;
  queuedRunFetch: RunFetch<R> | null;
  queuedRunContext: FetchQueueRunContext | null;
};

export interface FetchQueue<R> {
  /**
   * Schedules `runFetch` through the trailing window for `queryKey`. The
   * returned promise resolves with the result of the fetch cycle that
   * satisfies this request.
   */
  enqueue(queryKey: QueryKey, runFetch: RunFetch<R>): Promise<R>;
  /** Cancels every pending window and drops all state. Test-isolation helper. */
  reset(): void;
}

export function createFetchQueue<R>(windowMs: number): FetchQueue<R> {
  const entries = new Map<string, QueueEntry<R>>();
  const coalescingWindow = Math.max(0, windowMs);

  const openWindow = (
    keyString: string,
    entry: QueueEntry<R>,
    delayMs: number,
  ) => {
    entry.phase = "windowing";
    // Keep zero available to direct queue consumers and focused tests. Collection
    // fetches use FETCH_COALESCING_WINDOW_MS for every cycle.
    if (delayMs <= 0) {
      entry.windowTimer = null;
      queueMicrotask(() => {
        // reset(), or a later cycle, replaced this entry — abort.
        if (entries.get(keyString) !== entry) return;
        void runCycle(keyString, entry);
      });
      return;
    }
    entry.windowTimer = setTimeout(() => {
      entry.windowTimer = null;
      void runCycle(keyString, entry);
    }, delayMs);
  };

  const runCycle = async (keyString: string, entry: QueueEntry<R>) => {
    entry.phase = "fetching";
    // Captured before `advance()` may reassign `entry.cycle` to the queued slot.
    const settling = entry.cycle;

    const advance = () => {
      if (entry.queuedCycle) {
        // Promote the coalesced slot; delay it by the same fixed window so
        // further requests fold into one fetch.
        entry.cycle = entry.queuedCycle;
        entry.runFetch = entry.queuedRunFetch!;
        entry.runContext = entry.queuedRunContext!;
        entry.queuedCycle = null;
        entry.queuedRunFetch = null;
        entry.queuedRunContext = null;
        openWindow(keyString, entry, coalescingWindow);
      } else {
        entries.delete(keyString);
      }
    };

    try {
      const result = await entry.runFetch(entry.runContext);
      // Transition before settling so a synchronous re-enqueue from a `.then`
      // observes consistent queue state.
      advance();
      settling.resolve(result);
    } catch (error) {
      advance();
      settling.reject(error);
    }
  };

  return {
    enqueue(queryKey, runFetch) {
      const keyString = queryKey.toKey();
      const existing = entries.get(keyString);

      if (!existing) {
        const entry: QueueEntry<R> = {
          phase: "windowing",
          cycle: createDeferred<R>(),
          runFetch,
          runContext: createRunContext(false),
          windowTimer: null,
          queuedCycle: null,
          queuedRunFetch: null,
          queuedRunContext: null,
        };
        entries.set(keyString, entry);
        openWindow(keyString, entry, coalescingWindow);
        return entry.cycle.promise;
      }

      if (existing.phase === "windowing") {
        // Fold into the fetch that fires when the already-open window elapses.
        return existing.cycle.promise;
      }

      // phase === "fetching": park in the single coalesced queued slot so the
      // next cycle — whose network call starts after now — serves this request.
      if (!existing.queuedCycle) {
        existing.queuedCycle = createDeferred<R>();
        existing.queuedRunFetch = runFetch;
        existing.queuedRunContext = createRunContext(true);
        logger.info(
          "data_core",
          "[dedup] request parked mid-flight; follow-up cycle will fire",
          { queryKey: keyString },
        );
      }
      return existing.queuedCycle.promise;
    },

    reset() {
      for (const entry of entries.values()) {
        if (entry.windowTimer) clearTimeout(entry.windowTimer);
      }
      entries.clear();
    },
  };
}
