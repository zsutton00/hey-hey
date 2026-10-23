import type { CollectionItem } from "./types";

export const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000;

export const resolveStaleTimeMs = (collectionDefault: number, queryOverride?: number): number =>
  queryOverride ?? collectionDefault;

export interface StaleTimeConfig {
  staleTimeMs: number;
}

/**
 * Core staleness check against a raw `lastFetched` timestamp. A missing
 * timestamp is treated as stale (never fetched).
 */
export const isTimestampStale = (
  lastFetched: string | undefined,
  staleTimeMs: number
): boolean => {
  if (!lastFetched) return true;

  const timeSinceLastFetch = Date.now() - new Date(lastFetched).getTime();
  return timeSinceLastFetch > staleTimeMs;
};

// Pure function - easily testable
export const isDataStale = <T>(
  item: CollectionItem<T> | undefined,
  staleTimeMs: number
): boolean => isTimestampStale(item?.lastFetched, staleTimeMs);

/**
 * Decides whether a fetch can be skipped for an already-cached item.
 *
 * This reflects genuine freshness only: a fetch is skipped when cached data
 * exists and has not aged past `staleTimeMs`. Dedupe timing is no longer
 * consulted here — coalescing of bursty requests is owned by the trailing-
 * window fetch queue, not by suppressing the fetch outright.
 */
export const shouldSkipFetch = <T>(
  currentItem: CollectionItem<T> | undefined,
  config: StaleTimeConfig
): boolean => !!currentItem && !isDataStale(currentItem, config.staleTimeMs);

/**
 * Freshness decision for a list query, keyed off the timestamp stamped when
 * the list was last fetched rather than a representative item. This lets an
 * empty list result be considered as fresh as a populated one — a list that
 * legitimately returned zero items still has a fetch time and must not refetch
 * on every render until it ages past `staleTimeMs`.
 */
export const shouldSkipFetchForTimestamp = (
  lastFetched: string | undefined,
  config: StaleTimeConfig
): boolean =>
  !!lastFetched && !isTimestampStale(lastFetched, config.staleTimeMs);
