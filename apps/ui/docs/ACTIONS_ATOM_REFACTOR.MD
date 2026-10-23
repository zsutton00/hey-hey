# Actions Atom Refactor Plan

## Problem Statement

We have a fundamental architectural issue where state updates via `actionsAtom` and fetch operations in hooks are not synchronized. When `dispatch({ type: "MARK_STALE" })` is called followed immediately by `fetchData()`, the fetch doesn't see the stale marker because React hasn't re-rendered yet. This affects:

- `refetch` operations (marks stale, then fetches - but fetch doesn't see stale)
- Optimistic updates followed by confirmation fetches
- Error retry flows
- Batch cache invalidation

## Core Architectural Change

Move all fetch operations into the `actionsAtom` to ensure atomic state transitions. This makes all state changes and their dependent operations happen in the same synchronous context within Jotai's store.

## Implementation Plan

### Phase 1: Extract Utility Functions

Create small, testable utility functions in `src/data/core/fetchUtils.ts`:

```typescript
// src/data/core/fetchUtils.ts

import type { CollectionItem, FetcherResponse } from "./types";

/**
 * Wraps a single item response into a CollectionItem
 */
export function wrapSingleItem<T>(
  data: T,
  queryKey: string,
  now: string = new Date().toISOString()
): CollectionItem<T> {
  return {
    id: (data as any).id,
    updatedAt: (data as any).updatedAt || now,
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
 * Determines if a fetch should be skipped based on staleness and cache time
 */
export function shouldSkipFetchForQuery<T>(
  queryKey: string,
  state: CollectionState<T>,
  staleTimeConfig: StaleTimeConfig,
  staleTimeState: StaleTimeState
): { skip: boolean; currentItem?: CollectionItem<T> } {
  // Check if explicitly marked stale
  if (state.stale.has(queryKey)) {
    return { skip: false };
  }

  // Get current item if it exists
  const itemId = state.singleQueries.get(queryKey);
  const currentItem = itemId ? state.items.get(itemId) : undefined;

  // Check using existing shouldSkipFetch logic
  const skip = shouldSkipFetch(
    queryKey,
    currentItem,
    staleTimeConfig,
    staleTimeState
  );

  return { skip, currentItem };
}

/**
 * Checks if a query is currently loading
 */
export function isQueryLoading<T>(
  queryKey: string,
  state: CollectionState<T>
): boolean {
  return state.loading.has(queryKey);
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
```

### Phase 2: Create Async Action Handlers

Create separate handler functions for async actions in `src/data/core/asyncActions.ts`:

```typescript
// src/data/core/asyncActions.ts

import type { CollectionState, CollectionItem, FetcherFunction } from "./types";
import {
  wrapSingleItem,
  wrapArrayItems,
  shouldSkipFetchForQuery,
  isQueryLoading,
  createErrorState,
  createLoadingState,
  createSuccessState,
} from "./fetchUtils";

/**
 * Handles a regular fetch query (checks cache, respects stale time)
 */
export async function handleFetchQuery<T>(
  queryKey: string,
  state: CollectionState<T>,
  fetcher: FetcherFunction<T>,
  staleTimeConfig: StaleTimeConfig,
  staleTimeState: StaleTimeState,
  signal?: AbortSignal
): Promise<{
  data: T | T[] | null;
  stateUpdates: Array<{ type: string; payload: any }>;
}> {
  const stateUpdates: Array<{ type: string; payload: any }> = [];

  // Check if should skip
  const { skip, currentItem } = shouldSkipFetchForQuery(
    queryKey,
    state,
    staleTimeConfig,
    staleTimeState
  );

  if (skip && currentItem) {
    return { data: currentItem.data, stateUpdates };
  }

  // Check if already loading
  if (isQueryLoading(queryKey, state)) {
    return { data: null, stateUpdates };
  }

  // Mark as loading
  stateUpdates.push({
    type: "SET_LOADING",
    payload: { queryKey, isLoading: true },
  });

  try {
    // Check abort signal
    if (signal?.aborted) {
      throw new Error("Fetch aborted");
    }

    // Perform fetch
    const response = await fetcher(queryKey);

    if (signal?.aborted) {
      throw new Error("Fetch aborted");
    }

    // Process response
    const now = new Date().toISOString();
    if (response.isArray) {
      const wrappedItems = wrapArrayItems(response.data as T[], queryKey, now);
      stateUpdates.push({
        type: "SET_ITEMS",
        payload: { items: wrappedItems, queryKey },
      });
    } else {
      const wrappedItem = wrapSingleItem(response.data as T, queryKey, now);
      stateUpdates.push({
        type: "SET_ITEM",
        payload: { item: wrappedItem, queryKey },
      });
    }

    // Mark as successful
    stateUpdates.push({
      type: "SET_FETCH_SUCCESS",
      payload: { queryKey },
    });

    // Mark in global stale time state
    markQueryAsFetched(queryKey, staleTimeState);

    return { data: response.data, stateUpdates };
  } catch (error) {
    if (!signal?.aborted) {
      stateUpdates.push({
        type: "SET_FETCH_ERROR",
        payload: { queryKey, error },
      });
    }
    throw error;
  } finally {
    // Clean up loading state
    stateUpdates.push({
      type: "SET_LOADING",
      payload: { queryKey, isLoading: false },
    });
  }
}

/**
 * Handles a forced refetch (marks stale first, ignores cache)
 */
export async function handleRefetchQuery<T>(
  queryKey: string,
  state: CollectionState<T>,
  fetcher: FetcherFunction<T>,
  staleTimeConfig: StaleTimeConfig,
  staleTimeState: StaleTimeState,
  signal?: AbortSignal
): Promise<{
  data: T | T[] | null;
  stateUpdates: Array<{ type: string; payload: any }>;
}> {
  const stateUpdates: Array<{ type: string; payload: any }> = [];

  // First mark as stale
  stateUpdates.push({
    type: "MARK_STALE",
    payload: { queryKey },
  });

  // Check if already loading
  if (isQueryLoading(queryKey, state)) {
    return { data: null, stateUpdates };
  }

  // Mark as loading
  stateUpdates.push({
    type: "SET_LOADING",
    payload: { queryKey, isLoading: true },
  });

  try {
    // Check abort signal
    if (signal?.aborted) {
      throw new Error("Fetch aborted");
    }

    // Perform fetch (no cache check for refetch)
    const response = await fetcher(queryKey);

    if (signal?.aborted) {
      throw new Error("Fetch aborted");
    }

    // Process response
    const now = new Date().toISOString();
    if (response.isArray) {
      const wrappedItems = wrapArrayItems(response.data as T[], queryKey, now);
      stateUpdates.push({
        type: "SET_ITEMS",
        payload: { items: wrappedItems, queryKey },
      });
    } else {
      const wrappedItem = wrapSingleItem(response.data as T, queryKey, now);
      stateUpdates.push({
        type: "SET_ITEM",
        payload: { item: wrappedItem, queryKey },
      });
    }

    // Mark as successful
    stateUpdates.push({
      type: "SET_FETCH_SUCCESS",
      payload: { queryKey },
    });

    // Mark in global stale time state
    markQueryAsFetched(queryKey, staleTimeState);

    return { data: response.data, stateUpdates };
  } catch (error) {
    if (!signal?.aborted) {
      stateUpdates.push({
        type: "SET_FETCH_ERROR",
        payload: { queryKey, error },
      });
    }
    throw error;
  } finally {
    // Clean up loading state
    stateUpdates.push({
      type: "SET_LOADING",
      payload: { queryKey, isLoading: false },
    });
  }
}

/**
 * Handles batch refetch of multiple queries
 */
export async function handleBatchRefetch<T>(
  queryKeys: string[],
  state: CollectionState<T>,
  fetcher: FetcherFunction<T>,
  staleTimeConfig: StaleTimeConfig,
  staleTimeState: StaleTimeState,
  signal?: AbortSignal
): Promise<{
  results: Map<string, T | T[] | null>;
  stateUpdates: Array<{ type: string; payload: any }>;
}> {
  const results = new Map<string, T | T[] | null>();
  const allStateUpdates: Array<{ type: string; payload: any }> = [];

  // Mark all as stale first
  queryKeys.forEach((queryKey) => {
    allStateUpdates.push({
      type: "MARK_STALE",
      payload: { queryKey },
    });
  });

  // Fetch all in parallel
  const fetchPromises = queryKeys.map(async (queryKey) => {
    try {
      const result = await handleRefetchQuery(
        queryKey,
        state,
        fetcher,
        staleTimeConfig,
        staleTimeState,
        signal
      );
      results.set(queryKey, result.data);
      allStateUpdates.push(...result.stateUpdates);
    } catch (error) {
      results.set(queryKey, null);
      // Error handling already done in handleRefetchQuery
    }
  });

  await Promise.all(fetchPromises);

  return { results, stateUpdates: allStateUpdates };
}
```

### Phase 3: Update Actions Atom

Update the `actionsAtom` in `createCollection.ts` to handle async actions:

```typescript
// In createCollection.ts

import {
  handleFetchQuery,
  handleRefetchQuery,
  handleBatchRefetch,
} from "./asyncActions";

const actionsAtom = atom(
  null,
  async (get, set, action: CollectionAction<T>) => {
    const state = get(stateAtom);

    // Handle async actions
    if (
      action.type === "FETCH_QUERY" ||
      action.type === "REFETCH_QUERY" ||
      action.type === "BATCH_REFETCH"
    ) {
      let result;
      let stateUpdates: Array<{ type: string; payload: any }> = [];

      switch (action.type) {
        case "FETCH_QUERY":
          result = await handleFetchQuery(
            action.queryKey,
            state,
            fetcher,
            staleTimeConfig,
            staleTimeState,
            action.signal
          );
          stateUpdates = result.stateUpdates;
          break;

        case "REFETCH_QUERY":
          result = await handleRefetchQuery(
            action.queryKey,
            state,
            fetcher,
            staleTimeConfig,
            staleTimeState,
            action.signal
          );
          stateUpdates = result.stateUpdates;
          break;

        case "BATCH_REFETCH":
          const batchResult = await handleBatchRefetch(
            action.queryKeys,
            state,
            fetcher,
            staleTimeConfig,
            staleTimeState,
            action.signal
          );
          stateUpdates = batchResult.stateUpdates;
          result = batchResult;
          break;
      }

      // Apply all state updates
      let currentState = get(stateAtom);
      for (const update of stateUpdates) {
        currentState = applyStateUpdate(currentState, update);
        set(stateAtom, currentState);
      }

      return result?.data || result?.results || null;
    }

    // Handle synchronous actions (existing code)
    switch (action.type) {
      case "MARK_STALE": {
        const newStale = new Set(state.stale);
        newStale.add(action.queryKey);
        set(stateAtom, { ...state, stale: newStale });
        break;
      }

      case "SET_LOADING": {
        const updates = createLoadingState(
          state,
          action.queryKey,
          action.isLoading
        );
        set(stateAtom, { ...state, ...updates });
        break;
      }

      case "SET_FETCH_SUCCESS": {
        const updates = createSuccessState(state, action.queryKey);
        set(stateAtom, { ...state, ...updates });
        break;
      }

      case "SET_FETCH_ERROR": {
        const updates = createErrorState(state, action.queryKey, action.error);
        set(stateAtom, { ...state, ...updates });
        break;
      }

      // ... rest of existing synchronous actions
    }
  }
);

/**
 * Helper to apply state updates from async actions
 */
function applyStateUpdate<T>(
  state: CollectionState<T>,
  update: { type: string; payload: any }
): CollectionState<T> {
  switch (update.type) {
    case "SET_LOADING":
      return {
        ...state,
        ...createLoadingState(
          state,
          update.payload.queryKey,
          update.payload.isLoading
        ),
      };

    case "MARK_STALE":
      const newStale = new Set(state.stale);
      newStale.add(update.payload.queryKey);
      return { ...state, stale: newStale };

    case "SET_ITEMS":
      // Existing SET_ITEMS logic
      return applySetItems(
        state,
        update.payload.items,
        update.payload.queryKey
      );

    case "SET_ITEM":
      // Existing SET_ITEM logic
      return applySetItem(state, update.payload.item, update.payload.queryKey);

    case "SET_FETCH_SUCCESS":
      return {
        ...state,
        ...createSuccessState(state, update.payload.queryKey),
      };

    case "SET_FETCH_ERROR":
      return {
        ...state,
        ...createErrorState(
          state,
          update.payload.queryKey,
          update.payload.error
        ),
      };

    default:
      return state;
  }
}
```

### Phase 4: Update Type Definitions

Update types in `src/data/core/types.ts`:

```typescript
// Add to CollectionAction type
export type CollectionAction<T> =
  | { type: "MARK_STALE"; queryKey: string }
  | { type: "SET_ITEMS"; items: CollectionItem<T>[]; queryKey: string }
  | { type: "SET_ITEM"; item: CollectionItem<T>; queryKey: string }
  | { type: "SET_LOADING"; queryKey: string; isLoading: boolean }
  | { type: "SET_FETCHED"; queryKey: string }
  | { type: "SET_ERROR"; queryKey: string; error: Error | null }
  // New async actions
  | { type: "FETCH_QUERY"; queryKey: string; signal?: AbortSignal }
  | { type: "REFETCH_QUERY"; queryKey: string; signal?: AbortSignal }
  | { type: "BATCH_REFETCH"; queryKeys: string[]; signal?: AbortSignal }
  // New state update actions
  | { type: "SET_FETCH_SUCCESS"; queryKey: string }
  | { type: "SET_FETCH_ERROR"; queryKey: string; error: Error };
// ... rest of existing actions

// Update dispatch to handle async
export type DispatchFunction<T> = (
  action: CollectionAction<T>
) => void | Promise<T | T[] | null>;
```

### Phase 5: Simplify Hooks

Update `useQuery.ts` to use the new async actions:

```typescript
// src/data/core/useQuery.ts

export function useQuery<T>({
  queryKey,
  dispatch,
  state,
  enabled = true,
  refetchOnMount = true,
  refetchOnWindowFocus = false,
}: UseQueryOptions<T>): UseQueryReturn<T> {
  const abortControllerRef = useRef<AbortController | null>(null);

  // Simplified fetchData - just dispatch the action
  const fetchData = useCallback(async () => {
    if (!enabled) return null;

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      // Dispatch returns the fetched data
      const data = await dispatch({
        type: "FETCH_QUERY",
        queryKey,
        signal: abortControllerRef.current.signal,
      });
      return data;
    } catch (error) {
      if (error instanceof Error && error.message === "Fetch aborted") {
        return null;
      }
      throw error;
    }
  }, [dispatch, queryKey, enabled]);

  // Simplified refetch - dispatch knows to mark stale and fetch
  const refetch = useCallback(async () => {
    if (!enabled) return null;

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const data = await dispatch({
        type: "REFETCH_QUERY",
        queryKey,
        signal: abortControllerRef.current.signal,
      });
      return data;
    } catch (error) {
      if (error instanceof Error && error.message === "Fetch aborted") {
        return null;
      }
      throw error;
    }
  }, [dispatch, queryKey, enabled]);

  // Mark stale remains synchronous
  const markStale = useCallback(() => {
    dispatch({ type: "MARK_STALE", queryKey });
  }, [dispatch, queryKey]);

  // Initial fetch effect
  useEffect(() => {
    if (enabled && refetchOnMount) {
      fetchData();
    }

    return () => {
      // Cleanup: abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [enabled, refetchOnMount]); // Remove fetchData from deps to avoid loops

  // Window focus refetch
  useEffect(() => {
    if (!enabled || !refetchOnWindowFocus) return;

    const handleFocus = () => {
      if (state.stale.has(queryKey)) {
        fetchData();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [enabled, refetchOnWindowFocus, state.stale, queryKey]); // Remove fetchData from deps

  // Extract data from state
  const data = useMemo(() => {
    if (state.listQueries.has(queryKey)) {
      const ids = state.listQueries.get(queryKey)!;
      return ids.map((id) => state.items.get(id)?.data).filter(Boolean) as T[];
    } else if (state.singleQueries.has(queryKey)) {
      const id = state.singleQueries.get(queryKey)!;
      return state.items.get(id)?.data || null;
    }
    return null;
  }, [state.listQueries, state.singleQueries, state.items, queryKey]);

  return {
    data,
    isLoading: state.loading.has(queryKey),
    isFetched: state.fetched.has(queryKey),
    isStale: state.stale.has(queryKey),
    error: state.errors.get(queryKey) || null,
    refetch,
    markStale,
  };
}
```

### Phase 6: Testing Strategy

Create comprehensive tests for each utility function:

```typescript
// src/data/core/__tests__/fetchUtils.test.ts

describe("fetchUtils", () => {
  describe("wrapSingleItem", () => {
    it("should wrap a single item with metadata", () => {
      const data = { id: "1", name: "Test", updatedAt: "2024-01-01" };
      const wrapped = wrapSingleItem(data, "test-query");

      expect(wrapped).toEqual({
        id: "1",
        updatedAt: "2024-01-01",
        lastFetched: expect.any(String),
        data,
        queryKeys: ["test-query"],
        fetchedCount: 1,
      });
    });

    it("should use provided timestamp", () => {
      const data = { id: "1", name: "Test" };
      const now = "2024-01-15T10:00:00Z";
      const wrapped = wrapSingleItem(data, "test-query", now);

      expect(wrapped.lastFetched).toBe(now);
      expect(wrapped.updatedAt).toBe(now);
    });
  });

  describe("shouldSkipFetchForQuery", () => {
    it("should not skip if marked stale", () => {
      const state = {
        stale: new Set(["test-query"]),
        singleQueries: new Map(),
        items: new Map(),
        // ... other state
      };

      const result = shouldSkipFetchForQuery(
        "test-query",
        state,
        config,
        staleState
      );
      expect(result.skip).toBe(false);
    });

    it("should skip if data is fresh", () => {
      const now = new Date().toISOString();
      const item = {
        id: "1",
        lastFetched: now,
        data: { id: "1", name: "Test" },
        // ...
      };

      const state = {
        stale: new Set(),
        singleQueries: new Map([["test-query", "1"]]),
        items: new Map([["1", item]]),
        // ...
      };

      const result = shouldSkipFetchForQuery(
        "test-query",
        state,
        config,
        staleState
      );
      expect(result.skip).toBe(true);
      expect(result.currentItem).toBe(item);
    });
  });

  // ... more tests for each utility function
});
```

### Phase 7: Migration Path

1. **Phase 7.1: Add new async actions alongside existing code**

   - Implement all utility functions
   - Add async action handlers
   - Update actionsAtom to support both old and new patterns
   - No breaking changes yet

2. **Phase 7.2: Update hooks one by one**

   - Start with `useQuery` as the base
   - Update `useConversations`, `useConversation`, `useProjects`, `useInitiativeEditHistory` etc.
   - Each can be done independently
   - Run tests after each migration

3. **Phase 7.3: Remove old fetchQuery export**

   - Once all hooks are migrated
   - Remove the exported `fetchQuery` function
   - Keep it internal for the actions atom only

4. **Phase 7.4: Cleanup**
   - Remove unused code
   - Update documentation
   - Add migration notes

## Benefits of This Approach

1. **Atomic State Transitions**: All related state changes happen together
2. **No Race Conditions**: No split-brain between React renders and state updates
3. **Testable Units**: Each utility function can be tested in isolation
4. **Maintainable**: Small functions are easier to understand and modify
5. **Type Safe**: TypeScript can properly type the return values of dispatches
6. **Abort Handling**: Proper cancellation support throughout
7. **Batch Operations**: Easy to add batch operations like refetch all

## Potential Challenges

1. **Async Atom Complexity**: Debugging async atoms can be harder
2. **Error Boundaries**: Need proper error handling at hook level
3. **Migration Risk**: Need careful migration to avoid breaking existing code
4. **Testing Async Atoms**: Requires more sophisticated test setup

## Alternative Considerations

If this approach proves too complex, we could consider:

1. **Use Jotai's `atomWithRefresh`**: Built-in pattern for refreshable data
2. **Use separate atoms for fetch state**: Each query gets its own atom
3. **Use Tanstack Query**: If our needs grow beyond what's reasonable to maintain

## Success Criteria

- [ ] All fetch operations are atomic with their state updates
- [ ] No race conditions between mark stale and fetch
- [ ] All utility functions have >90% test coverage
- [ ] Hooks are simpler and have fewer dependencies
- [ ] TypeScript properly types all async operations
- [ ] Migration can be done incrementally without breaking changes

## Timeline Estimate

- Phase 1 (Utility Functions): 2-3 hours
- Phase 2 (Async Handlers): 2-3 hours
- Phase 3 (Update Actions Atom): 1-2 hours
- Phase 4 (Type Updates): 1 hour
- Phase 5 (Simplify Hooks): 2-3 hours
- Phase 6 (Testing): 3-4 hours
- Phase 7 (Migration): 4-6 hours

**Total: 15-22 hours**

## Next Steps

1. Review and approve this plan
2. Create feature branch `feature/actions-atom-refactor`
3. Implement Phase 1 (utility functions) with tests
4. Review and test Phase 1 in isolation
5. Continue with subsequent phases
6. Perform incremental migration of hooks
7. Final testing and cleanup
