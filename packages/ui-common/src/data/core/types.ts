import type { AxiosRequestConfig } from "axios";
import type { CollectionMap } from "./CollectionMap";
import type { ListQueryMap } from "./ListQueryMap";
import type {
  DataVariantQueryKeyField,
  QueryKey as QueryKeyObject,
  QueryKeyField,
  QueryKeyValue,
} from "./QueryKey";

export interface CollectionItem<T = unknown> {
  id: string;
  updatedAt: string; // When the actual data was last modified
  lastFetched: string; // When we last fetched this item from API
  data: T; // The actual DTO/business data
  queryKeys: string[]; // Which queries have loaded this item
  fetchedCount: number;
}

export type StorageId = string;

export interface CollectionState<T> {
  staleTimeMs: number;
  items: CollectionMap<T>;
  listQueries: ListQueryMap; // queryKey -> item IDs
  // queryKey -> ISO timestamp of when the list query was last fetched. Records
  // list freshness directly so an empty result is as fresh as a populated one,
  // instead of inferring freshness from a representative item (which a zero-item
  // list lacks). Optional for backward compat with externally-built state; real
  // collection state always populates it via initializeState + SET_ITEMS.
  listFetchTimes?: Map<string, string>;
  singleQueries: Map<string, string>; // queryKey -> item ID
  stale: Set<string>;
  loading: Set<string>; // Currently fetching (initial + background)
  fetched: Set<string>; // Have attempted to fetch at least once
  errors: Map<string, Error>;
  optimisticUpdates: Map<
    string,
    { previous: CollectionItem<T>; timestamp: number }
  >;
  // fetchTimestamps removed - now stored in individual CollectionItem.lastFetched
}

type QueryKeyFields = Record<
  string,
  DataVariantQueryKeyField<QueryKeyValue> | QueryKeyField<QueryKeyValue>
>;
export type QueryKey = QueryKeyObject<QueryKeyFields>;

export type CollectionAction<T, C = unknown> =
  | { type: "MARK_STALE"; queryKey: QueryKey }
  | { type: "MARK_STALE_BY_KEY_STRINGS"; queryKeyStrings: string[] }
  | { type: "MARK_ALL_STALE" }
  | { type: "MARK_ITEM_STALE"; itemId: string }
  | { type: "MARK_ITEMS_STALE"; itemIds: string[] }
  | { type: "CLEAR_QUERY_FROM_ITEMS"; queryKey: QueryKey }
  | { type: "SET_ITEMS"; items: CollectionItem<T>[]; queryKey: QueryKey }
  | { type: "SET_ITEM"; item: CollectionItem<T>; queryKey: QueryKey }
  | { type: "NEW_ITEM"; context: C; item?: CollectionItem<T> }
  | { type: "ADD_ITEM"; item: CollectionItem<T> }
  | { type: "SET_LOADING"; queryKey: QueryKey; isLoading: boolean }
  | { type: "SET_FETCHED"; queryKey: QueryKey }
  | { type: "SET_ERROR"; queryKey: QueryKey; error: Error | null }
  | {
      type: "OPTIMISTIC_UPDATE";
      id: string;
      updater: (item: CollectionItem<T>) => CollectionItem<T>;
    }
  | { type: "ROLLBACK_OPTIMISTIC"; id: string }
  | { type: "COMMIT_OPTIMISTIC"; id: string }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "CLEAR_QUERY"; queryKey: QueryKey }
  | { type: "MIGRATE_STATE" }
  | {
      type: "MIGRATE_ITEM_QUERY_KEYS";
      itemId: string;
      migratedItem: CollectionItem<T>;
    }
  // New async actions
  | {
      type: "FETCH_QUERY";
      queryKey: QueryKey;
      signal?: AbortSignal;
      staleTimeMs?: number;
      initiator?: string;
    }
  | {
      type: "REFETCH_QUERY";
      queryKey: QueryKey;
      signal?: AbortSignal;
      staleTimeMs?: number;
      initiator?: string;
    }
  | {
      type: "BATCH_REFETCH";
      queryKeys: QueryKey[];
      signal?: AbortSignal;
      staleTimeMs?: number;
      initiator?: string;
    }
  // New state update actions
  | { type: "SET_FETCH_SUCCESS"; queryKey: QueryKey }
  | { type: "SET_FETCH_ERROR"; queryKey: QueryKey; error: Error };

// Update dispatch to handle async
export type DispatchFunction<T, C = unknown> = (
  action: CollectionAction<T, C>
) => void | Promise<T | T[] | null>;

export interface FetcherResponse<T> {
  data: T | T[] | null;
  isArray: boolean;

  /**
   * Optional parsed items to store for queryKey tracking.
   * Used when response contains nested data that should be individually tracked.
   *
   * Example: TaskHierarchyResponseDto contains parent/task/children,
   * parsedItems extracts those as individual TaskResponseDto items.
   */
  parsedItems?: CollectionItem<T>[];

  /**
   * Overrides the response body's cardinality when parsedItems represent a
   * different query shape. For example, a hierarchy endpoint returns one
   * response object but expands it into a list of cache items.
   */
  parsedItemsQueryKind?: "single" | "list";
}

export interface CreateCollectionOptions<T, C = unknown> {
  name: string;
  /**
   * The fetcher receives a snapshot of collection state alongside the queryKey
   * so it can run cursor-aware refetches (e.g. `since=<cachedLatest>` for an
   * append-only list query) without orchestrators needing to live outside the
   * collection. Forward requestOptions to every HTTP call (including retries
   * and recovery reads) to retain the render caller across async boundaries.
   */
  fetcher: (
    queryKey: QueryKey,
    state: CollectionState<T>,
    requestOptions: AxiosRequestConfig
  ) => Promise<FetcherResponse<T>>;
  staleTimeMs?: number; // NEW: How long data stays "fresh"
  listScopes?: (context: C) => QueryKey[];
}

export interface CollectionHookOptions<T> {
  enabled?: boolean;
  refetchOnMount?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnStale?: boolean; // Automatically refetch when data becomes stale
  staleTimeMs?: number; // Override collection default stale time
  /**
   * Do not expose cached data after this age while its replacement is loading.
   * Unlike staleTimeMs, this is a presentation freshness boundary: callers see
   * an explicit loading state instead of an expired successful result.
   */
  maxCacheAgeMs?: number;
  sort?: [keyof T, "asc" | "desc"];
  /**
   * When true, only fetch if no data exists for the query key.
   * Useful when live updates will populate state (e.g., websockets).
   */
  preferStale?: boolean;
}

export interface MutationCallbacks<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

// Generic data hook return type based on useProjects pattern
export interface DataHookReturn<T> {
  data: T | null;
  isLoading: boolean; // Only true during initial fetch (when never fetched before)
  isFetching: boolean; // True during any fetch operation (initial or background)
  isFetched: boolean;
  isReady: boolean; // Safe to show data/empty states (isFetched && !error)
  error: Error | null;
  isStale: boolean;
  refetch: () => Promise<T | null>;
  markStale: () => void;
}

// For collection hooks that return arrays
export interface DataCollectionHookReturn<T> {
  data: T[];
  isLoading: boolean; // Only true during initial fetch (when never fetched before)
  isFetching: boolean; // True during any fetch operation (initial or background)
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  isStale: boolean;
  refetch: () => Promise<T[] | null>;
  markStale: () => void;
}
