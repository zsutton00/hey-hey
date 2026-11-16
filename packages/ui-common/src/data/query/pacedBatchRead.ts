/**
 * Paced, coalescing batch reads shared by latest-value datasets that are read
 * through a bounded per-project batch endpoint.
 */

export const BATCH_LIMIT = 100;
const DISPATCH_INTERVAL_MS = 1_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 30_000;

/** Trimmed, non-empty, de-duplicated ids in first-seen order. */
export const normalizeBatchIds = (ids: readonly string[]): string[] =>
  Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)));

export interface PacedBatchReadRequest {
  organizationId: string;
  projectId: string;
  ids: readonly string[];
}

export interface PacedBatchReadCoordinator {
  /** Resolves once a batch read started after this call covered every id. */
  request(input: PacedBatchReadRequest): Promise<void>;
}

export interface HydrationClock {
  now(): number;
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout>;
  random(): number;
}

const systemHydrationClock: HydrationClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  random: () => Math.random(),
};

interface BatchWaiter {
  requiredDispatch: number;
  pendingIds: Set<string>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface BatchScope {
  organizationId: string;
  projectId: string;
  pendingIds: Set<string>;
  dispatchGeneration: number;
  activeRequest: boolean;
  nextPermittedDispatchAt: number;
  consecutiveRateLimits: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  waiters: Set<BatchWaiter>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRetryAfterMs = (error: unknown, now: number): number | undefined => {
  if (
    !isRecord(error) ||
    !isRecord(error.response) ||
    !isRecord(error.response.headers)
  ) {
    return undefined;
  }

  const retryAfter =
    error.response.headers["retry-after"] ??
    error.response.headers["Retry-After"];
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    return Math.max(0, retryAfter * 1_000);
  }
  if (typeof retryAfter !== "string") return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now);
};

const isRateLimitError = (error: unknown): boolean =>
  isRecord(error) && isRecord(error.response) && error.response.status === 429;

const getBoundedJitteredBackoffMs = (
  consecutiveRateLimits: number,
  random: () => number,
): number => {
  const exponentialDelay = Math.min(
    MAX_RATE_LIMIT_BACKOFF_MS,
    DISPATCH_INTERVAL_MS * 2 ** (consecutiveRateLimits - 1),
  );
  const jitterFactor = 0.5 + random();
  return Math.min(
    MAX_RATE_LIMIT_BACKOFF_MS,
    Math.round(exponentialDelay * jitterFactor),
  );
};

const settleWaitersForIds = (
  scope: BatchScope,
  ids: ReadonlySet<string>,
  dispatchGeneration: number,
): void => {
  scope.waiters.forEach((waiter) => {
    if (waiter.requiredDispatch > dispatchGeneration) return;
    ids.forEach((id) => waiter.pendingIds.delete(id));
    if (waiter.pendingIds.size === 0) {
      scope.waiters.delete(waiter);
      waiter.resolve();
    }
  });
};

/**
 * Coordinates one batch endpoint across every consumer. Ids requested in the
 * same tick join one request per project scope; at most one request runs per
 * scope, and requests start at least one second apart, so at most one
 * trailing batch waits behind the active one. An HTTP 429 requeues its ids and
 * holds the whole scope until `Retry-After` or a bounded, jittered
 * exponential backoff has passed; waiters stay pending meanwhile rather than
 * failing. Any other failure rejects only waiters requiring IDs from that
 * batch; independent queued reads retain their pacing and continue.
 */
export const createPacedBatchReadCoordinator = <TEntry>(
  readBatch: (
    organizationId: string,
    projectId: string,
    ids: string[],
  ) => Promise<readonly TEntry[]>,
  applyEntries: (
    organizationId: string,
    projectId: string,
    entries: readonly TEntry[],
  ) => void,
  clock: HydrationClock = systemHydrationClock,
): PacedBatchReadCoordinator => {
  const scopes = new Map<string, BatchScope>();

  const getOrCreateScope = (
    organizationId: string,
    projectId: string,
  ): BatchScope => {
    const key = `${organizationId}\u0000${projectId}`;
    const existing = scopes.get(key);
    if (existing) return existing;

    const scope: BatchScope = {
      organizationId,
      projectId,
      pendingIds: new Set(),
      dispatchGeneration: 0,
      activeRequest: false,
      nextPermittedDispatchAt: 0,
      consecutiveRateLimits: 0,
      timer: undefined,
      waiters: new Set(),
    };
    scopes.set(key, scope);
    return scope;
  };

  const scheduleScope = (scope: BatchScope): void => {
    if (scope.activeRequest || scope.pendingIds.size === 0 || scope.timer) {
      return;
    }

    const delay = Math.max(0, scope.nextPermittedDispatchAt - clock.now());
    scope.timer = clock.setTimeout(() => {
      scope.timer = undefined;
      void readScope(scope);
    }, delay);
  };

  const readScope = async (scope: BatchScope): Promise<void> => {
    if (scope.activeRequest || scope.pendingIds.size === 0) return;

    const now = clock.now();
    if (now < scope.nextPermittedDispatchAt) {
      scheduleScope(scope);
      return;
    }

    const ids = [...scope.pendingIds].slice(0, BATCH_LIMIT);
    ids.forEach((id) => scope.pendingIds.delete(id));
    scope.activeRequest = true;
    const dispatchGeneration = ++scope.dispatchGeneration;
    scope.nextPermittedDispatchAt = now + DISPATCH_INTERVAL_MS;

    try {
      const entries = await readBatch(
        scope.organizationId,
        scope.projectId,
        ids,
      );
      applyEntries(scope.organizationId, scope.projectId, entries);
      scope.consecutiveRateLimits = 0;
      settleWaitersForIds(scope, new Set(ids), dispatchGeneration);
    } catch (error: unknown) {
      if (isRateLimitError(error)) {
        scope.consecutiveRateLimits += 1;
        ids.forEach((id) => scope.pendingIds.add(id));
        const retryAfterMs = getRetryAfterMs(error, now) ?? 0;
        const backoffMs = getBoundedJitteredBackoffMs(
          scope.consecutiveRateLimits,
          clock.random,
        );
        scope.nextPermittedDispatchAt = Math.max(
          scope.nextPermittedDispatchAt,
          now + retryAfterMs,
          now + backoffMs,
        );
      } else {
        scope.waiters.forEach((waiter) => {
          if (waiter.requiredDispatch > dispatchGeneration) return;
          if (!ids.some((id) => waiter.pendingIds.has(id))) {
            return;
          }
          scope.waiters.delete(waiter);
          waiter.reject(error);
        });
      }
    } finally {
      scope.activeRequest = false;
      scheduleScope(scope);
    }
  };

  return {
    request: ({ organizationId, projectId, ids: requestedIds }) => {
      const ids = normalizeBatchIds(requestedIds);
      if (ids.length === 0) return Promise.resolve();

      const scope = getOrCreateScope(organizationId, projectId);
      const promise = new Promise<void>((resolve, reject) => {
        scope.waiters.add({
          requiredDispatch: scope.dispatchGeneration + 1,
          pendingIds: new Set(ids),
          resolve,
          reject,
        });
      });

      // Active transport work predates this request and cannot satisfy it.
      ids.forEach((id) => scope.pendingIds.add(id));
      scheduleScope(scope);
      return promise;
    },
  };
};
