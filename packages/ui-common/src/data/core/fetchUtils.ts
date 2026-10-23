import type { CollectionItem, CollectionState, QueryKey } from "./types";
import type { StaleTimeConfig } from "./staleTime";
import { resolveStaleTimeMs, shouldSkipFetch, shouldSkipFetchForTimestamp } from "./staleTime";
import logger from "../../utils/logger";

/**
 * Wraps a single item response into a CollectionItem
 */
export function wrapSingleItem<T>(
  data: T,
  queryKey: string,
  now: string = new Date().toISOString()
): CollectionItem<T> {
  const typedData = (data ?? {}) as {
    id?: string;
    updatedAt?: string;
  };

  return {
    id: typedData.id ?? queryKey,
    updatedAt: typedData.updatedAt || now,
    lastFetched: now,
    data,
    queryKeys: [queryKey],
    fetchedCount: 1,
  };
}

/**
 * Wraps an array response into CollectionItems
 */
export function wrapArrayItems<T>(
  data: T[],
  queryKey: string,
  now: string = new Date().toISOString()
): CollectionItem<T>[] {
  return data.map((item) => wrapSingleItem(item, queryKey, now));
}

/**
 * Determines if a fetch should be skipped because cached data is still fresh.
 * Returns the cached data (single item or array) when skip is true.
 *
 * This only reflects genuine staleness/freshness — request coalescing for
 * bursty fetches is handled separately by the trailing-window fetch queue.
 */
export function shouldSkipFetchForQuery<T>(
  queryKey: QueryKey,
  state: CollectionState<T>,
  staleTimeConfig: StaleTimeConfig,
  staleTimeMs?: number
): { skip: boolean; data?: T | T[] } {
  const queryKeyString = queryKey.toKey();
  // Check if explicitly marked stale
  if (state.stale.has(queryKeyString)) {
    return { skip: false };
  }

  const effectiveStaleTimeConfig = {
    staleTimeMs: resolveStaleTimeMs(staleTimeConfig.staleTimeMs, staleTimeMs),
  };

  // Check single queries
  const singleItemId = state.singleQueries.get(queryKeyString);
  if (singleItemId) {
    const item = state.items.getByStorageId(singleItemId);
    const skip = shouldSkipFetch(item, effectiveStaleTimeConfig);
    logger.info(
      "data_core",
      `[shouldSkipFetchForQuery] Single query ${queryKeyString} is ${
        skip ? "fresh" : "stale"
      }, effective staleTimeMs: ${effectiveStaleTimeConfig.staleTimeMs}`
    );
    if (skip) {
      return { skip: true, data: item?.data };
    }
    return { skip: false };
  }

  // Check list queries. Freshness comes from the timestamp stamped on the
  // query when it was last fetched — not from a representative item — so a list
  // that legitimately returned zero items is treated as fresh and does not
  // refetch on every render until it ages past staleTimeMs.
  if (state.listQueries.hasByKeyString(queryKeyString)) {
    const listIds = state.listQueries.getByKeyString(queryKeyString) ?? [];
    const fetchedAt = state.listFetchTimes?.get(queryKeyString);
    const skip = shouldSkipFetchForTimestamp(
      fetchedAt,
      effectiveStaleTimeConfig
    );
    logger.info(
      "data_core",
      `[shouldSkipFetchForQuery] List query ${queryKeyString} has ${
        listIds.length
      } items, list is ${skip ? "fresh" : "stale"}, effective staleTimeMs: ${
        effectiveStaleTimeConfig.staleTimeMs
      }`
    );
    if (skip) {
      const items = listIds
        .map((id) => state.items.getByStorageId(id)?.data)
        .filter(Boolean) as T[];
      return { skip: true, data: items };
    }
    return { skip: false };
  }

  // No cached data found
  return { skip: false };
}

/**
 * Creates error state update
 */
export function createErrorState<T>(
  state: CollectionState<T>,
  queryKey: string,
  error: Error
): Partial<CollectionState<T>> {
  const newLoading = new Set(state.loading);
  newLoading.delete(queryKey);

  const newErrors = new Map(state.errors);
  newErrors.set(queryKey, error);

  const newFetched = new Set(state.fetched);
  newFetched.add(queryKey);

  return {
    loading: newLoading,
    errors: newErrors,
    fetched: newFetched,
  };
}

/**
 * Creates loading state update
 */
export function createLoadingState<T>(
  state: CollectionState<T>,
  queryKey: string,
  isLoading: boolean
): Partial<CollectionState<T>> {
  const newLoading = new Set(state.loading);

  if (isLoading) {
    newLoading.add(queryKey);
  } else {
    newLoading.delete(queryKey);
  }

  return { loading: newLoading };
}

/**
 * Creates success state update after fetch
 */
export function createSuccessState<T>(
  state: CollectionState<T>,
  queryKey: string
): Partial<CollectionState<T>> {
  const newLoading = new Set(state.loading);
  newLoading.delete(queryKey);

  const newFetched = new Set(state.fetched);
  newFetched.add(queryKey);

  const newStale = new Set(state.stale);
  newStale.delete(queryKey);

  const newErrors = new Map(state.errors);
  newErrors.delete(queryKey);

  return {
    loading: newLoading,
    fetched: newFetched,
    stale: newStale,
    errors: newErrors,
  };
}
