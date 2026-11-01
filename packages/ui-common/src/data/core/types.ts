export interface CollectionHookOptions<T> {
  enabled?: boolean;
  refetchOnMount?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnStale?: boolean; // Automatically refetch when data becomes stale
  staleTimeMs?: number; // Override collection default stale time
  /**
   * Re-read cached data once it reaches this age. The data stays visible but
   * reports as stale and fetching until the replacement read settles.
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
