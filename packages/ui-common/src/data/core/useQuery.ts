import { useCallback, useEffect, useRef } from "react";
import { resolveStaleTimeMs } from "./staleTime";
import { captureInitiator } from "./initiatorContext";
import { useQueryMountPolicy } from "./queryMountPolicyContext";
import type {
  CollectionHookOptions,
  CollectionItem,
  CollectionState,
  DispatchFunction,
  QueryKey,
} from "./types";

export interface UseQueryOptions<T, C = unknown>
  extends CollectionHookOptions<T> {
  queryKey: QueryKey;
  dispatch: DispatchFunction<T, C>;
  state: CollectionState<T>;
}

export interface UseQueryReturn<T> {
  data: T | T[] | null;
  isLoading: boolean; // Only true during initial fetch (when never fetched before)
  isFetching: boolean; // True during any fetch operation (initial or background)
  isFetched: boolean;
  error: Error | null;
  isStale: boolean;
  isExpired: boolean;
  refetch: () => Promise<T | T[] | null>;
  markStale: () => void;
}

type ListDataCacheEntry<T> = {
  ids: string[];
  items: Array<CollectionItem<T> | null>;
  data: T[];
};

const listDataCache = new Map<string, ListDataCacheEntry<unknown>>();

// A single browser focus event is delivered to every mounted listener. A
// shared query can therefore have several hook instances attempt the same
// forced refetch before the collection queue gets a chance to coalesce them.
// Claiming the query once per event keeps that fan-out to one dispatch while
// still allowing a later focus event to enqueue the intentional follow-up.
const focusEventClaims = new WeakMap<Event, WeakSet<object>>();

// Unlike focus events, visibilitychange, resume and pageshow can describe the
// same return to the app. Keep the canonical query claimed until its recovery
// settles, including any time spent waiting behind an older request.
const pendingResumeClaims = new WeakSet<QueryKey>();

function claimFocusRefetch(event: Event, queryKey: QueryKey): boolean {
  let claims = focusEventClaims.get(event);
  if (!claims) {
    claims = new WeakSet();
    focusEventClaims.set(event, claims);
  }

  if (claims.has(queryKey)) {
    return false;
  }

  claims.add(queryKey);
  return true;
}

type MutableRef<T> = { current: T };

type RefetchMode = "manual" | "window-focus" | "app-resume" | "mount-policy";

function createQueryRequestController(
  queryKeyString: string,
  currentQueryKeyRef: MutableRef<string>,
  abortControllerRef: MutableRef<AbortController | null>
): AbortController {
  if (
    abortControllerRef.current &&
    queryKeyString !== currentQueryKeyRef.current
  ) {
    abortControllerRef.current.abort();
  }

  currentQueryKeyRef.current = queryKeyString;
  const controller = new AbortController();
  abortControllerRef.current = controller;
  return controller;
}

function getData<T>(state: CollectionState<T>, queryKeyString: string) {
  if (state.listQueries.hasByKeyString(queryKeyString)) {
    const ids = state.listQueries.getByKeyString(queryKeyString)!;

    const cachedEntry = listDataCache.get(queryKeyString) as
      | ListDataCacheEntry<T>
      | undefined;

    const items = ids.map((id) => state.items.getByStorageId(id) ?? null);

    const isCacheValid =
      cachedEntry &&
      cachedEntry.ids.length === ids.length &&
      cachedEntry.items.length === items.length &&
      cachedEntry.ids.every((cachedId, index) => cachedId === ids[index]) &&
      cachedEntry.items.every(
        (cachedItem, index) => cachedItem === items[index]
      );

    if (isCacheValid) {
      return cachedEntry.data;
    }

    const data = items.filter(Boolean).map((item) => item!.data) as T[];
    listDataCache.set(queryKeyString, {
      ids: [...ids],
      items,
      data,
    });
    return data;
  } else if (state.singleQueries.has(queryKeyString)) {
    listDataCache.delete(queryKeyString);
    const id = state.singleQueries.get(queryKeyString)!;
    return state.items.getByStorageId(id)?.data || null;
  }
  listDataCache.delete(queryKeyString);
  return null;
}

function getQueryLastFetchedMs<T>(
  state: CollectionState<T>,
  queryKeyString: string
): number | null {
  if (state.singleQueries.has(queryKeyString)) {
    const id = state.singleQueries.get(queryKeyString)!;
    const item = state.items.getByStorageId(id);
    if (!item) {
      return null;
    }

    const lastFetchedMs = new Date(item.lastFetched).getTime();
    return Number.isFinite(lastFetchedMs) ? lastFetchedMs : null;
  }

  if (state.listQueries.hasByKeyString(queryKeyString)) {
    const listFetchTime = state.listFetchTimes?.get(queryKeyString);
    if (listFetchTime) {
      const listFetchTimeMs = new Date(listFetchTime).getTime();
      return Number.isFinite(listFetchTimeMs) ? listFetchTimeMs : null;
    }

    // Retain compatibility with state created before list-level timestamps
    // were introduced. New collections always record listFetchTimes, including
    // for successful empty results.
    const ids = state.listQueries.getByKeyString(queryKeyString) ?? [];
    const timestamps = ids
      .map((id) => state.items.getByStorageId(id)?.lastFetched)
      .filter((value): value is string => typeof value === "string")
      .map((value) => new Date(value).getTime())
      .filter(Number.isFinite);

    if (timestamps.length === 0) {
      return null;
    }

    return Math.min(...timestamps);
  }

  return null;
}

function isQueryExpired<T>(
  state: CollectionState<T>,
  queryKeyString: string,
  maxCacheAgeMs: number | undefined
): boolean {
  if (typeof maxCacheAgeMs !== "number" || maxCacheAgeMs <= 0) {
    return false;
  }

  const lastFetchedMs = getQueryLastFetchedMs(state, queryKeyString);
  return lastFetchedMs !== null && Date.now() - lastFetchedMs >= maxCacheAgeMs;
}

export function useQuery<T, C = unknown>({
  queryKey,
  dispatch,
  state,
  enabled = true,
  refetchOnMount = true,
  refetchOnWindowFocus = false,
  refetchOnStale = true,
  preferStale = false,
  staleTimeMs,
  maxCacheAgeMs,
}: UseQueryOptions<T, C>): UseQueryReturn<T> {
  const mountPolicy = useQueryMountPolicy();
  const abortControllerRef = useRef<AbortController | null>(null);
  const forcedMountRefetchKeyRef = useRef<string | null>(null);
  const forcedMountRefetchPendingRef = useRef(false);
  const queryKeyString = queryKey.toKey();
  const currentQueryKeyRef = useRef<string>(queryKeyString);
  const stateRef = useRef(state);
  stateRef.current = state;

  const initiatorRef = useRef<string | undefined>(undefined);
  if (initiatorRef.current === undefined) {
    initiatorRef.current = captureInitiator();
  }

  // Simplified fetchData - just dispatch the action
  const fetchData = useCallback(async () => {
    if (!enabled) return null;

    const existingData = getData<T>(stateRef.current, queryKeyString);
    if (preferStale && existingData !== null) {
      return existingData;
    }

    const requestController = createQueryRequestController(
      queryKeyString,
      currentQueryKeyRef,
      abortControllerRef
    );
    try {
      const fetchAction =
        typeof staleTimeMs === "number"
          ? {
              type: "FETCH_QUERY" as const,
              queryKey,
              signal: requestController.signal,
              staleTimeMs,
              initiator: initiatorRef.current,
            }
          : {
              type: "FETCH_QUERY" as const,
              queryKey,
              signal: requestController.signal,
              initiator: initiatorRef.current,
            };

      // Dispatch returns the fetched data
      const data = (await dispatch(fetchAction)) as T | T[] | null;
      return data;
    } catch (error) {
      if (error instanceof Error && error.message === "Fetch aborted") {
        return null;
      }
      throw error;
    }
  }, [dispatch, enabled, preferStale, queryKey, queryKeyString, staleTimeMs]);

  // Forced refetches dispatch the action that marks the query stale and fetches
  // it. Manual refetch preserves preferStale, while focus, resume, and mount
  // policy recovery remain authoritative even when cached data is present.
  const executeRefetch = useCallback(
    async (mode: RefetchMode) => {
      if (!enabled) return null;

      const existingData = getData<T>(stateRef.current, queryKeyString);
      if (mode === "manual" && preferStale && existingData !== null) {
        return existingData;
      }

      const requestController = createQueryRequestController(
        queryKeyString,
        currentQueryKeyRef,
        abortControllerRef
      );

      try {
        const refetchAction =
          typeof staleTimeMs === "number"
            ? {
                type: "REFETCH_QUERY" as const,
                queryKey,
                signal: requestController.signal,
                staleTimeMs,
                initiator: initiatorRef.current,
              }
            : {
                type: "REFETCH_QUERY" as const,
                queryKey,
                signal: requestController.signal,
                initiator: initiatorRef.current,
              };

        const data = (await dispatch(refetchAction)) as T | T[] | null;
        return data;
      } catch (error) {
        if (error instanceof Error && error.message === "Fetch aborted") {
          return null;
        }
        throw error;
      }
    },
    [dispatch, enabled, preferStale, queryKey, queryKeyString, staleTimeMs]
  );

  const refetch = useCallback(() => executeRefetch("manual"), [executeRefetch]);

  // Mark stale remains synchronous
  const markStale = useCallback(() => {
    dispatch({ type: "MARK_STALE", queryKey });
  }, [dispatch, queryKey]);

  // Initial fetch effect
  useEffect(() => {
    if (!enabled) {
      forcedMountRefetchKeyRef.current = null;
      return;
    }

    if (mountPolicy === "always-refetch") {
      if (forcedMountRefetchKeyRef.current === queryKeyString) {
        return;
      }

      forcedMountRefetchKeyRef.current = queryKeyString;
      forcedMountRefetchPendingRef.current = true;
      void executeRefetch("mount-policy")
        .catch(() => {})
        .finally(() => {
          forcedMountRefetchPendingRef.current = false;
        });
      return;
    }

    if (refetchOnMount) {
      void fetchData().catch(() => {});
    }
  }, [
    enabled,
    executeRefetch,
    mountPolicy,
    fetchData,
    queryKeyString,
    refetchOnMount,
  ]);

  useEffect(() => {
    if (!enabled || typeof staleTimeMs !== "number" || staleTimeMs <= 0) {
      return;
    }

    if (state.stale.has(queryKeyString)) {
      return;
    }

    const lastFetchedMs = getQueryLastFetchedMs(state, queryKeyString);
    if (lastFetchedMs === null) {
      return;
    }

    const elapsedMs = Date.now() - lastFetchedMs;
    if (elapsedMs > staleTimeMs) {
      dispatch({ type: "MARK_STALE", queryKey });
      return;
    }

    const timeoutId = setTimeout(() => {
      dispatch({ type: "MARK_STALE", queryKey });
    }, staleTimeMs - elapsedMs + 1);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [dispatch, enabled, queryKey, queryKeyString, staleTimeMs, state]);

  useEffect(() => {
    if (!enabled || typeof maxCacheAgeMs !== "number" || maxCacheAgeMs <= 0) {
      return;
    }

    const lastFetchedMs = getQueryLastFetchedMs(state, queryKeyString);
    if (lastFetchedMs === null || state.stale.has(queryKeyString)) {
      return;
    }

    const elapsedMs = Date.now() - lastFetchedMs;
    if (elapsedMs >= maxCacheAgeMs) {
      dispatch({ type: "MARK_STALE", queryKey });
      return;
    }

    const timeoutId = setTimeout(() => {
      dispatch({ type: "MARK_STALE", queryKey });
    }, maxCacheAgeMs - elapsedMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [dispatch, enabled, maxCacheAgeMs, queryKey, queryKeyString, state]);

  const isExpired = isQueryExpired(state, queryKeyString, maxCacheAgeMs);
  const isStale = state.stale.has(queryKeyString) || isExpired;

  useEffect(() => {
    if (
      !enabled ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const handleResume = () => {
      if (
        document.visibilityState !== "visible" ||
        pendingResumeClaims.has(queryKey)
      ) {
        return;
      }
      const lastFetchedMs = getQueryLastFetchedMs(
        stateRef.current,
        queryKeyString
      );
      if (
        lastFetchedMs === null ||
        Date.now() - lastFetchedMs <=
          resolveStaleTimeMs(stateRef.current.staleTimeMs, staleTimeMs)
      ) {
        return;
      }

      pendingResumeClaims.add(queryKey);
      void executeRefetch("app-resume")
        .catch(() => {})
        .finally(() => pendingResumeClaims.delete(queryKey));
    };

    document.addEventListener("visibilitychange", handleResume);
    document.addEventListener("resume", handleResume);
    window.addEventListener("pageshow", handleResume);
    return () => {
      document.removeEventListener("visibilitychange", handleResume);
      document.removeEventListener("resume", handleResume);
      window.removeEventListener("pageshow", handleResume);
    };
  }, [enabled, executeRefetch, queryKey, queryKeyString, staleTimeMs]);

  // Window focus refetch
  useEffect(() => {
    if (!enabled || !refetchOnWindowFocus || typeof window === "undefined")
      return;

    const handleFocus = (event: Event) => {
      if (!claimFocusRefetch(event, queryKey)) {
        return;
      }

      void executeRefetch("window-focus").catch(() => {});
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [enabled, executeRefetch, queryKey, refetchOnWindowFocus]);

  // Automatic stale data refetch
  useEffect(() => {
    if (forcedMountRefetchPendingRef.current) {
      return;
    }

    // Re-run whenever the stale set is rebuilt — every MARK_STALE makes a new
    // Set, so this also fires on a re-mark of an already-stale query. The
    // trailing-window fetch queue then coalesces the follow-up fetch (parking
    // it in the queued slot when a fetch is already in flight), so an event
    // delivered mid-fetch still yields a subsequent fetch. Keying off the
    // `isStale` boolean alone missed re-marks and dropped those events.
    void state.stale;

    const skipReason = !enabled
      ? "disabled"
      : !refetchOnStale
      ? "refetch_on_stale_disabled"
      : preferStale
      ? "prefer_stale"
      : !isStale
      ? "not_stale"
      : null;

    if (skipReason) {
      return;
    }

    void fetchData().catch(() => {});
  }, [
    enabled,
    refetchOnStale,
    isStale,
    state.stale,
    fetchData,
    queryKeyString,
    preferStale,
  ]);

  // Extract data from state
  const cachedData = getData<T>(state, queryKeyString);
  const keepExpiredCacheDuringForcedMountRefetch =
    forcedMountRefetchPendingRef.current && isExpired && cachedData !== null;
  const data =
    isExpired && !keepExpiredCacheDuringForcedMountRefetch ? null : cachedData;
  const hasLocalData = data !== null;
  const computedIsFetched = state.fetched.has(queryKeyString) || hasLocalData;

  return {
    data,
    isLoading:
      (state.loading.has(queryKeyString) && !computedIsFetched) ||
      (isExpired &&
        !keepExpiredCacheDuringForcedMountRefetch &&
        !state.errors.has(queryKeyString)),
    isFetching: state.loading.has(queryKeyString),
    isFetched: computedIsFetched,
    isStale,
    isExpired,
    error: state.errors.get(queryKeyString) || null,
    refetch,
    markStale,
  };
}
