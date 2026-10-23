import type { CollectionState, QueryKey } from "./types";
import type { StaleTimeConfig } from "./staleTime";
import type { FetchQueue } from "./fetchQueue";
import {
  wrapSingleItem,
  wrapArrayItems,
  shouldSkipFetchForQuery,
} from "./fetchUtils";
import { initiatorRequestOptions } from "./requestInitiator";
import type { CreateCollectionOptions } from "./types";
import logger from "../../utils/logger";

// Define the fetcher function type based on CreateCollectionOptions
export type FetcherFunction<T> = CreateCollectionOptions<T>["fetcher"];

// Type for state updates returned by async handlers
export interface StateUpdate {
  type: string;
  payload: unknown;
}

// Return types for immediate dispatch
export type AsyncActionData<T> = T | T[] | null;
export type BatchActionData<T> = Map<string, T | T[] | null>;

// Dispatch function type
export type StateDispatch = (update: StateUpdate) => void;

const toKeyString = (queryKey: QueryKey) => queryKey.toKey();

/**
 * Runs one fetch cycle for a query: marks loading, calls the fetcher with a
 * FRESH state snapshot, dispatches the result, then clears loading.
 *
 * The snapshot is read via `getState()` at the moment the fetch fires (window
 * end), not when the request was enqueued — so a cursor-aware fetcher (e.g.
 * the conversation-messages `since=<cursor>` delta fetch) observes cache
 * mutated by any earlier fetch in the same burst.
 *
 * This is invoked by the trailing-window queue, never directly by the action
 * handlers, which guarantees at most one in-flight fetch per key.
 */
async function performFetch<T>(
  queryKey: QueryKey,
  getState: () => CollectionState<T>,
  fetcher: FetcherFunction<T>,
  dispatch: StateDispatch,
  initiator?: string
): Promise<AsyncActionData<T>> {
  const queryKeyString = toKeyString(queryKey);

  logger.info("data_fetcher", "[dedup] network request firing", {
    queryKey: queryKeyString,
    initiator,
  });

  dispatch({
    type: "SET_LOADING",
    payload: { queryKey, isLoading: true },
  });

  try {
    const response = await fetcher(
      queryKey,
      getState(),
      initiatorRequestOptions(initiator)
    );

    const now = new Date().toISOString();

    // If parsedItems provided, store only those (for nested data like
    // hierarchies). Otherwise store the response data normally.
    if (response.parsedItems && response.parsedItems.length > 0) {
      dispatch(
        (response.parsedItemsQueryKind ??
          (response.isArray ? "list" : "single")) === "list"
          ? {
              type: "SET_ITEMS",
              payload: { items: response.parsedItems, queryKey },
            }
          : {
              type: "SET_ITEM",
              payload: { item: response.parsedItems[0], queryKey },
            }
      );
    } else if (response.isArray) {
      dispatch({
        type: "SET_ITEMS",
        payload: {
          items: wrapArrayItems(response.data as T[], queryKeyString, now),
          queryKey,
        },
      });
    } else if (response.data === null) {
      dispatch({
        type: "CLEAR_QUERY",
        payload: { queryKey },
      });
    } else {
      dispatch({
        type: "SET_ITEM",
        payload: {
          item: wrapSingleItem(response.data as T, queryKeyString, now),
          queryKey,
        },
      });
    }

    dispatch({
      type: "SET_FETCH_SUCCESS",
      payload: { queryKey },
    });

    logger.info("data_fetcher", "[performFetch] success", {
      queryKey: queryKeyString,
    });

    return response.data;
  } catch (error) {
    dispatch({
      type: "SET_FETCH_ERROR",
      payload: { queryKey, error },
    });
    throw error;
  } finally {
    dispatch({
      type: "SET_LOADING",
      payload: { queryKey, isLoading: false },
    });
  }
}

/**
 * Handles a FETCH_QUERY action. Honours the cache/stale skip decision, then —
 * once a fetch is warranted — funnels it through the shared trailing-window
 * queue so a burst of callers coalesces into a single network call.
 */
export async function handleFetchQuery<T>(
  queryKey: QueryKey,
  getState: () => CollectionState<T>,
  fetcher: FetcherFunction<T>,
  staleTimeConfig: StaleTimeConfig,
  fetchQueue: FetchQueue<AsyncActionData<T>>,
  dispatch: StateDispatch,
  signal?: AbortSignal,
  staleTimeMs?: number,
  initiator?: string
): Promise<AsyncActionData<T>> {
  // Caller already gone before we could enqueue — don't schedule the work.
  if (signal?.aborted) {
    return null;
  }

  const { skip, data } = shouldSkipFetchForQuery(
    queryKey,
    getState(),
    staleTimeConfig,
    staleTimeMs
  );

  if (skip) {
    // Cached data is still fresh — return it without touching the network.
    return data ?? null;
  }

  // Reflect the pending fetch immediately. The queue defers the network call
  // (coalescing same-tick callers and bursts), but consumers should see the
  // loading state the moment a fetch is warranted.
  dispatch({
    type: "SET_LOADING",
    payload: { queryKey, isLoading: true },
  });

  return fetchQueue.enqueue(queryKey, ({ enqueuedDuringInFlight }) => {
    // Re-check at fire time: if a prior cycle in this burst already landed and
    // populated fresh data, skip the network call rather than double-fetching.
    //
    // A cycle parked while an older fetch was already in flight is different:
    // the older response may clear staleness before this closure fires, but it
    // cannot satisfy the invalidation that arrived after it started.
    if (!enqueuedDuringInFlight) {
      const { skip, data } = shouldSkipFetchForQuery(
        queryKey,
        getState(),
        staleTimeConfig,
        staleTimeMs
      );
      if (skip) {
        logger.info(
          "data_fetcher",
          "[dedup] queued cycle short-circuited — data fresh at fire time",
          { queryKey: queryKey.toKey() }
        );
        return Promise.resolve(data ?? null);
      }
    }
    return performFetch(queryKey, getState, fetcher, dispatch, initiator);
  });
}

/**
 * Handles a REFETCH_QUERY action. Marks the query stale, then enqueues the
 * identical "fetch latest" instruction. There is no existing request to
 * cancel — the trailing-window queue coalesces concurrent refetches for a key.
 */
export async function handleRefetchQuery<T>(
  queryKey: QueryKey,
  getState: () => CollectionState<T>,
  fetcher: FetcherFunction<T>,
  fetchQueue: FetchQueue<AsyncActionData<T>>,
  dispatch: StateDispatch,
  signal?: AbortSignal,
  initiator?: string
): Promise<AsyncActionData<T>> {
  // Mark stale first - IMMEDIATE DISPATCH
  dispatch({
    type: "MARK_STALE",
    payload: { queryKey },
  });

  if (signal?.aborted) {
    return null;
  }

  // Reflect the pending fetch immediately (see handleFetchQuery).
  dispatch({
    type: "SET_LOADING",
    payload: { queryKey, isLoading: true },
  });

  return fetchQueue.enqueue(queryKey, () =>
    performFetch(queryKey, getState, fetcher, dispatch, initiator)
  );
}

/**
 * Handles batch refetch of multiple queries. Each key is routed through the
 * shared queue, so concurrent batch refetches for the same key coalesce.
 */
export async function handleBatchRefetch<T>(
  queryKeys: QueryKey[],
  getState: () => CollectionState<T>,
  fetcher: FetcherFunction<T>,
  fetchQueue: FetchQueue<AsyncActionData<T>>,
  dispatch: StateDispatch,
  signal?: AbortSignal,
  initiator?: string
): Promise<BatchActionData<T>> {
  const results: BatchActionData<T> = new Map();

  await Promise.all(
    queryKeys.map(async (queryKey) => {
      const queryKeyString = toKeyString(queryKey);
      try {
        const result = await handleRefetchQuery(
          queryKey,
          getState,
          fetcher,
          fetchQueue,
          dispatch,
          signal,
          initiator
        );
        results.set(queryKeyString, result);
      } catch {
        // Error state already dispatched inside performFetch.
        results.set(queryKeyString, null);
      }
    })
  );

  return results;
}
