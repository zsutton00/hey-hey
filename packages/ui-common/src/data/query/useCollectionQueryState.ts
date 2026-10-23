import {
  hashKey,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { invalidateWithFollowUpRead, refetchWithFollowUpRead } from "./invalidateWithFollowUpRead";
import type { DataCollectionHookReturn } from "../core/types";

export type CollectionQueryState<TData> = Omit<
  DataCollectionHookReturn<never>,
  "data" | "refetch"
> & {
  refetch: () => Promise<TData | null>;
};

export interface CollectionQueryStateOptions {
  /**
   * Oldest data the hook will present as current. Older data stays visible
   * but reports as stale and refreshing while one fresh read runs.
   */
  maxCacheAgeMs?: number;
}

function isExpired(
  dataUpdatedAt: number,
  maxCacheAgeMs: number | undefined,
  now: number
): boolean {
  return (
    typeof maxCacheAgeMs === "number" &&
    maxCacheAgeMs > 0 &&
    dataUpdatedAt > 0 &&
    now - dataUpdatedAt >= maxCacheAgeMs
  );
}

/**
 * Maps a TanStack query result onto the Data Layer hook surface so migrated
 * collections keep their existing return shapes.
 *
 * Read lifecycle: a disabled, pending or retrying read is never an error; only
 * a settled failure populates `error`. Data seeded from another cache entry
 * (`initialData`) counts as fetched, matching the old engine's "has local data"
 * rule, so consumers gated on `isReady` do not wait for a redundant read.
 *
 * Max cache age: data older than `maxCacheAgeMs` is invalidated once (only
 * this key, so the mounted query re-reads) and is reported as stale and
 * fetching until that read settles. The data itself stays visible.
 */
export function useCollectionQueryState<TData>(
  result: UseQueryResult<TData, Error>,
  queryKey: QueryKey,
  enabled: boolean,
  options: CollectionQueryStateOptions = {}
): CollectionQueryState<TData> {
  const { maxCacheAgeMs } = options;
  const queryClient = useQueryClient();
  const { refetch: refetchQuery, dataUpdatedAt } = result;
  // Factories return new arrays on render. Use the cache's canonical key so
  // fetch-state renders do not restart an already-running age refresh. Look
  // the entry up by hash: `find` scans and hashes every cached query, and this
  // runs on every render of every collection hook.
  const cachedQuery = queryClient.getQueryCache().get(hashKey(queryKey));
  const cacheKey = cachedQuery?.queryKey ?? queryKey;
  // Re-render when cached data crosses the max age while mounted.
  const [now, setNow] = useState(() => Date.now());
  const expired =
    enabled && isExpired(dataUpdatedAt, maxCacheAgeMs, Date.now());

  useEffect(() => {
    if (!enabled || maxCacheAgeMs === undefined || maxCacheAgeMs <= 0) return;
    if (dataUpdatedAt <= 0) return;
    const remainingMs = dataUpdatedAt + maxCacheAgeMs - Date.now();
    if (remainingMs <= 0) {
      if (cachedQuery?.state.isInvalidated) return;
      // Mark synchronously before scheduling the causal restart. Other
      // observers of this expired snapshot then join that same refresh.
      void queryClient.invalidateQueries({
        queryKey: cacheKey,
        exact: true,
        refetchType: "none",
      });
      void invalidateWithFollowUpRead(queryClient, {
        queryKey: cacheKey,
        exact: true,
      });
      return;
    }
    const timeoutId = setTimeout(() => setNow(Date.now()), remainingMs);
    return () => clearTimeout(timeoutId);
  }, [
    enabled,
    maxCacheAgeMs,
    dataUpdatedAt,
    queryClient,
    cachedQuery,
    cacheKey,
    now,
  ]);

  const refetch = useCallback(async (): Promise<TData | null> => {
    if (!enabled) return null;
    const next = await refetchWithFollowUpRead(queryClient, cacheKey, () =>
      refetchQuery({ cancelRefetch: false, throwOnError: true })
    );
    return next.data ?? null;
  }, [enabled, queryClient, cacheKey, refetchQuery]);

  const markStale = useCallback(() => {
    if (!enabled) return;
    void invalidateWithFollowUpRead(queryClient, {
      queryKey: cacheKey,
      exact: true,
    });
  }, [enabled, queryClient, cacheKey]);

  const isFetched =
    result.isFetched || (result.isSuccess && !result.isPlaceholderData);
  const error = result.isError ? result.error : null;

  return {
    isLoading: result.isLoading,
    isFetching: result.isFetching || (expired && !error),
    isFetched,
    isReady: isFetched && !error,
    error,
    isStale: result.isStale || expired,
    refetch,
    markStale,
  };
}
