# Fix Collection Query System: Loading States and Stale Logic

## Problem Statement

The current collection query system has two critical flaws that cause infinite re-render loops:

### Flaw 1: Loading State Cycles Even When No Fetch Occurs

- Each `useInitiative` hook instance manages its own loading state
- Even when data is cached and fresh, hooks cycle through `loading: true → false`
- Multiple hooks for the same query create cascading loading state changes
- This triggers React re-renders even when no API call is made

### Flaw 2: Stale Logic is Hook-Specific, Not Shared

- Stale time logic is duplicated in each hook (`useInitiative`, `useInitiativeEditHistory`, etc.)
- Each hook has its own `hasInitialFetchRef` and stale checking logic
- Logic cannot be shared across different data-fetching hooks
- Results in inconsistent behavior and code duplication

## Root Cause Analysis

The fundamental issue is **architectural**:

- **Collection state** (data cache, loading states) should be global per query
- **Hook instances** should be thin wrappers that subscribe to collection state
- **Stale time logic** should be centralized and reusable across all hooks

Currently, we have **hook-centric** design where each hook manages its own state, when we need **collection-centric** design where the collection manages shared state.

## Solution Architecture

### 1. Move Collections to Core Layer

**Rationale**: Collections are core data management infrastructure, not UI-specific hooks.

**Changes**:

- Move `src/data/collections/createCollection.ts` → `src/data/core/createCollection.ts`
- Make helper functions independently testable
- Separate concerns: core logic vs React integration

### 2. Centralize Loading State Management

**Goal**: Loading states should be global per query, not per hook instance.

**Core Principles**:

- Only set `loading: true` when actually making an API call
- If data exists and is fresh, loading should be `false` immediately
- Multiple hooks for the same query share the same loading state
- Loading state changes should be minimal and predictable

**Important**: "Same query" means **identical queryKey string**:
- ✅ `initiative:org1:init1` and `initiative:org1:init1` → same query, shared loading state
- ❌ `initiative:org1:init1` and `initiative:org1:init2` → different queries, separate loading states

### 3. Centralize Stale Time Logic

**Goal**: Shared, testable stale time logic that all hooks can use.

**Core Principles**:

- Stale checking happens at collection level, not hook level
- Global "has fetched" tracking per query key (not per component)
- Consistent stale time behavior across all data-fetching hooks
- Easily testable and configurable

## Implementation Plan

### Phase 1: Core Infrastructure Setup

#### 1.1 Create Core Collections Directory

```
src/data/
├── core/
│   ├── __tests__/
│   │   ├── createCollection.test.ts
│   │   ├── staleTime.test.ts
│   │   └── loadingStates.test.ts
│   ├── createCollection.ts
│   ├── staleTime.ts
│   ├── loadingStates.ts
│   ├── types.ts
│   └── index.ts
```

#### 1.2 Create Base useQuery Hook

**Create `src/data/core/useQuery.ts`**:

```typescript
import { useCallback, useEffect, useRef } from 'react';
import type { CollectionHookOptions, CollectionAction, CollectionState } from './types';

interface UseQueryOptions<T> extends CollectionHookOptions {
  queryKey: string;
  fetchFn: (queryKey: string, dispatch: (action: CollectionAction<T>) => void, signal?: AbortSignal) => Promise<T | null>;
  dispatch: (action: CollectionAction<T>) => void;
  state: CollectionState<T>;
}

interface UseQueryReturn<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  isStale: boolean;
  refetch: () => Promise<T | null>;
  markStale: () => void;
}

export function useQuery<T>({
  queryKey,
  fetchFn,
  dispatch,
  state,
  enabled = true,
  refetchOnMount = true,
  refetchOnWindowFocus = false,
}: UseQueryOptions<T>): UseQueryReturn<T> {
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Fetch function with proper abort controller management
  const fetchData = useCallback(async () => {
    if (!enabled) return null;

    // Only create new AbortController if we don't have one
    // Don't abort existing requests - let collection handle deduplication
    if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController();
    }

    try {
      const data = await fetchFn(queryKey, dispatch, abortControllerRef.current.signal);
      return data;
    } catch (error) {
      if (error instanceof Error && error.message === "Fetch aborted") {
        return null; // Don't throw for aborted requests
      }
      throw error;
    }
  }, [queryKey, fetchFn, dispatch, enabled]);

  // Main fetch effect - runs on mount and dependency changes
  useEffect(() => {
    if (!enabled) return;

    fetchData();

    return () => {
      // Only abort when effect cleans up (unmount or dependency change)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [enabled, queryKey, fetchData]);

  // Window focus refetching
  useEffect(() => {
    if (!refetchOnWindowFocus || !enabled) return;

    const handleFocus = () => {
      if (isMountedRef.current) {
        fetchData();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refetchOnWindowFocus, enabled, fetchData]);

  // Mount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Data unwrapping from CollectionItem<T>
  const data = useMemo(() => {
    const itemId = state.singleQueries.get(queryKey);
    if (itemId) {
      const wrappedItem = state.items.get(itemId);
      return wrappedItem?.data || null;
    }
    return null;
  }, [state.items, state.singleQueries, queryKey]);

  // Utility functions
  const refetch = useCallback(async () => {
    dispatch({ type: "MARK_STALE", queryKey });
    return fetchData();
  }, [dispatch, queryKey, fetchData]);

  const markStale = useCallback(() => {
    dispatch({ type: "MARK_STALE", queryKey });
  }, [dispatch, queryKey]);

  return {
    data,
    isLoading: state.loading.has(queryKey),
    error: state.errors.get(queryKey) || null,
    isStale: state.stale.has(queryKey),
    refetch,
    markStale,
  };
}
```

#### 1.3 Extract Helper Functions

**Create `src/data/core/staleTime.ts`**:

```typescript
import type { CollectionItem } from "./types";

export interface StaleTimeConfig {
  staleTimeMs: number;
  dedupeTime: number;
}

export interface StaleTimeState {
  hasGloballyFetched: Map<string, boolean>;
  lastFetchTimes: Map<string, number>;
}

// Pure function - easily testable
export const isDataStale = <T>(
  item: CollectionItem<T> | undefined,
  staleTimeMs: number
): boolean => {
  if (!item) return true;

  const now = Date.now();
  const lastFetchTime = new Date(item.lastFetched).getTime();
  const timeSinceLastFetch = now - lastFetchTime;

  return timeSinceLastFetch > staleTimeMs;
};

// Pure function - easily testable
export const shouldSkipFetch = <T>(
  queryKey: string,
  currentItem: CollectionItem<T> | undefined,
  config: StaleTimeConfig,
  state: StaleTimeState
): boolean => {
  // Check if data exists and is fresh
  if (currentItem && !isDataStale(currentItem, config.staleTimeMs)) {
    return true; // Skip fetch, data is fresh
  }

  // Check deduplication (recent fetch attempt)
  const lastFetchTime = state.lastFetchTimes.get(queryKey) || 0;
  const now = Date.now();
  if (now - lastFetchTime < config.dedupeTime) {
    return true; // Skip fetch, too recent
  }

  return false; // Proceed with fetch
};

// Pure function - easily testable
export const markQueryAsFetched = (
  queryKey: string,
  state: StaleTimeState
): void => {
  state.hasGloballyFetched.set(queryKey, true);
  state.lastFetchTimes.set(queryKey, Date.now());
};
```

**Create `src/data/core/loadingStates.ts`**:

```typescript
// Pure function - easily testable
export const shouldSetLoading = <T>(
  queryKey: string,
  currentLoadingState: boolean,
  willActuallyFetch: boolean
): boolean => {
  // Only set loading to true if we're actually going to fetch
  if (willActuallyFetch && !currentLoadingState) {
    return true;
  }

  // Don't change loading state unnecessarily
  return currentLoadingState;
};

// Centralized loading state logic
export const manageLoadingState = <T>(
  queryKey: string,
  currentLoadingState: boolean,
  willFetch: boolean,
  dispatch: (action: any) => void
): void => {
  const shouldLoad = shouldSetLoading(queryKey, currentLoadingState, willFetch);

  if (shouldLoad !== currentLoadingState) {
    dispatch({
      type: "SET_LOADING",
      queryKey,
      isLoading: shouldLoad,
    });
  }
};
```

### Phase 2: Update createCollection.ts

#### 2.1 Move to Core and Import Helpers

**File**: `src/data/core/createCollection.ts`

```typescript
import { isDataStale, shouldSkipFetch, markQueryAsFetched } from "./staleTime";
import { manageLoadingState } from "./loadingStates";
import type {
  CollectionItem,
  CollectionState,
  CreateCollectionOptions,
} from "./types";

export function createCollection<T>(options: CreateCollectionOptions<T>) {
  const {
    name,
    fetcher,
    keySerializer = defaultKeySerializer,
    dedupeTime = 1000,
    staleTimeMs = 30000,
  } = options;

  // Global state for stale time management
  const staleTimeState = {
    hasGloballyFetched: new Map<string, boolean>(),
    lastFetchTimes: new Map<string, number>(),
  };

  const staleTimeConfig = { staleTimeMs, dedupeTime };

  // ... existing state atom setup ...

  // Updated fetch function with centralized logic
  const fetchQuery = async (
    queryKey: string,
    dispatch: (action: CollectionAction<T>) => void,
    signal?: AbortSignal
  ) => {
    const state = get(stateAtom);
    const itemId = state.singleQueries.get(queryKey);
    const currentItem = itemId ? state.items.get(itemId) : undefined;

    // CRITICAL: Check if we should skip fetch BEFORE setting loading
    const skipFetch = shouldSkipFetch(
      queryKey,
      currentItem,
      staleTimeConfig,
      staleTimeState
    );

    if (skipFetch) {
      console.log(
        "DEBUG_RERENDER: Skipping fetch, data is fresh",
        JSON.stringify({
          queryKey,
          reason: currentItem ? "fresh_data" : "recent_fetch",
          lastFetched: currentItem?.lastFetched,
          staleTimeMs,
        })
      );
      return currentItem?.data || null;
    }

    // Only set loading to true if we're actually going to fetch
    manageLoadingState(queryKey, state.loading.has(queryKey), true, dispatch);

    try {
      const response = await fetcher(queryKey);

      if (signal?.aborted) {
        throw new Error("Fetch aborted");
      }

      // Mark as fetched for future stale time checks
      markQueryAsFetched(queryKey, staleTimeState);

      // ... existing response handling ...

      return response.data;
    } catch (error) {
      // ... existing error handling ...
    } finally {
      // Always clean up loading state
      manageLoadingState(
        queryKey,
        state.loading.has(queryKey),
        false,
        dispatch
      );
    }
  };

  return {
    name,
    stateAtom,
    actionsAtom,
    fetchQuery,
    staleTimeMs,
    isStale: (item: CollectionItem<T> | undefined, customStaleTime?: number) =>
      isDataStale(item, customStaleTime ?? staleTimeMs),
    // Expose stale time state for debugging
    _staleTimeState: staleTimeState,
  };
}
```

### Phase 3: Simplify Hook Logic

#### 3.1 Update useInitiative with Base Hook

**Goal**: Use the base `useQuery` hook and add initiative-specific functionality.

**Changes**:

```typescript
import { useQuery } from '../core/useQuery';
import { useAtomValue, useSetAtom } from 'jotai';
import { 
  fetchInitiativeQuery,
  initiativeActionsAtom, 
  initiativeStateAtom,
  initiativeStaleTimeMs 
} from '../collections/initiatives';

export function useInitiative(
  orgId: string,
  initiativeId: string,
  options: CollectionHookOptions = {}
): UseInitiativeReturn {
  const queryKey = `initiative:${orgId}:${initiativeId}`;
  const state = useAtomValue(initiativeStateAtom);
  const dispatch = useSetAtom(initiativeActionsAtom);

  // Use base hook for all the common query logic
  const baseQuery = useQuery({
    queryKey,
    fetchFn: fetchInitiativeQuery,
    dispatch,
    state,
    enabled: !!orgId && !!initiativeId && (options.enabled ?? true),
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
  });

  // Add initiative-specific mutation logic
  const update = useCallback(
    async (
      updates: UpdateInitiativeDto,
      callbacks?: MutationCallbacks<InitiativeResponseDto>
    ): Promise<InitiativeResponseDto> => {
      if (!baseQuery.data) {
        throw new Error("Cannot update: no initiative data available");
      }

      // Optimistic update logic
      dispatch({
        type: "OPTIMISTIC_UPDATE",
        id: initiativeId,
        updater: (item) => ({
          ...item,
          ...updates,
          updatedAt: new Date().toISOString(),
        }),
      });

      try {
        const response = await platformClient.updateInitiative(orgId, initiativeId, updates);
        const updatedData = response.data.data;
        
        if (updatedData) {
          dispatch({ type: "COMMIT_OPTIMISTIC", id: initiativeId });
          
          const now = new Date().toISOString();
          dispatch({
            type: "SET_ITEM",
            item: {
              id: updatedData.id,
              updatedAt: updatedData.updatedAt || now,
              lastFetched: now,
              data: updatedData,
            },
            queryKey,
          });

          callbacks?.onSuccess?.(updatedData);
        }
        return updatedData;
      } catch (error) {
        dispatch({ type: "ROLLBACK_OPTIMISTIC", id: initiativeId });
        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [baseQuery.data, dispatch, orgId, initiativeId, queryKey]
  );

  return {
    data: baseQuery.data,
    isLoading: baseQuery.isLoading,
    error: baseQuery.error,
    isStale: baseQuery.isStale,
    update,
    refetch: baseQuery.refetch,
    markStale: baseQuery.markStale,
  };
}
```

**Key Benefits of This Approach**:

1. **Eliminates duplicate abort logic** - Base hook handles AbortController properly
2. **Reduces code duplication** - All query hooks can use the same pattern  
3. **Centralizes abort strategy** - Only abort on cleanup, not on every call
4. **Maintains hook-specific functionality** - Each hook adds its own mutations and business logic

### Phase 4: Testing Strategy

#### 4.1 Unit Tests for Core Functions

**Test `src/data/core/staleTime.ts`**:

```typescript
describe("isDataStale", () => {
  it("returns true when item is undefined", () => {
    expect(isDataStale(undefined, 30000)).toBe(true);
  });

  it("returns false when data is fresh", () => {
    const item = {
      id: "1",
      lastFetched: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { id: "1", name: "test" },
    };
    expect(isDataStale(item, 30000)).toBe(false);
  });

  it("returns true when data is stale", () => {
    const oldTime = new Date(Date.now() - 60000).toISOString();
    const item = {
      id: "1",
      lastFetched: oldTime,
      updatedAt: oldTime,
      data: { id: "1", name: "test" },
    };
    expect(isDataStale(item, 30000)).toBe(true);
  });
});

describe("shouldSkipFetch", () => {
  // Test various combinations of fresh/stale data and deduplication
});
```

#### 4.2 Integration Tests

**Test loading state behavior**:

```typescript
describe("Collection Loading States", () => {
  it("should not set loading for fresh data", async () => {
    // Setup collection with fresh data
    // Call fetchQuery
    // Verify loading state never changes
  });

  it("should set loading only when actually fetching", async () => {
    // Setup collection with stale data
    // Call fetchQuery
    // Verify loading: true → false cycle happens only once
  });

  it("should share loading state between multiple hooks", async () => {
    // Create two hooks for same query
    // Verify they see the same loading state
  });
});
```

### Phase 5: Migration and Validation

#### 5.1 Update Import Paths

- Update all imports from `src/data/collections/` to `src/data/core/`
- Update React hooks to import from `src/data/hooks/` (wrapper layer)
- Ensure clean separation between core logic and React integration

#### 5.2 Validation Criteria

- ✅ Single hook call: loads data normally with appropriate loading states
- ✅ Duplicate hook calls within stale time: second call gets immediate data with `loading: false`
- ✅ No loading state cycling between hook instances
- ✅ Fresh data returns immediately without any loading state changes
- ✅ All existing functionality preserved (mutations, optimistic updates, etc.)

#### 5.3 Performance Testing

- Measure network requests (should be minimal/eliminated for fresh data)
- Monitor React re-render counts (should be significantly reduced)
- Test with multiple simultaneous hook instances

### Phase 6: Apply to All Collection Hooks

Once `useInitiative` is fixed and validated:

#### 6.1 Update Other Hooks

Apply the same base hook pattern to other collection hooks:

```typescript
// useInitiativeEditHistory becomes:
export function useInitiativeEditHistory(options) {
  const baseQuery = useQuery({
    queryKey: `edit-history:${orgId}:${initiativeId}`,
    fetchFn: fetchEditHistoryQuery, 
    dispatch,
    state,
    ...options
  });
  
  // Add any edit-history-specific logic
  return baseQuery;
}

// Any other collection hook follows the same pattern
```

#### 6.2 AbortController Best Practices

**Key Principles for All Hooks**:

1. **Don't abort on every fetchData call** - This creates cascading aborted requests
2. **Only abort on cleanup** - When effect unmounts or dependencies change  
3. **Let collection handle deduplication** - Don't preemptively cancel requests
4. **Reuse AbortController when possible** - Create new one only when needed

**Anti-Pattern** (current problematic approach):
```typescript
// ❌ DON'T DO THIS - causes cascading aborts
const fetchData = useCallback(async () => {
  if (abortControllerRef.current) {
    abortControllerRef.current.abort(); // Too aggressive!
  }
  abortControllerRef.current = new AbortController();
  // ...
});
```

**Correct Pattern** (implemented in base hook):
```typescript  
// ✅ DO THIS - minimal, targeted abort strategy
useEffect(() => {
  fetchData();
  
  return () => {
    // Only abort when effect cleans up
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };
}, [queryKey, fetchData]); // Abort when queryKey changes
```

#### 6.3 Migration Guide for Future Hooks

**Template for New Collection Hooks**:
1. Use `useQuery` base hook for all query logic
2. Add hook-specific mutations and business logic
3. Follow the abort controller best practices
4. Ensure consistent queryKey patterns

## Expected Benefits

### Immediate Benefits

1. **Eliminates infinite re-renders** - No more loading state cycling
2. **Better performance** - Reduced unnecessary API requests and React renders
3. **Consistent behavior** - Shared stale time logic across all hooks
4. **Easier debugging** - Centralized, predictable loading states

### Architectural Benefits

1. **Testable core logic** - Pure functions that can be unit tested independently
2. **Separation of concerns** - Core data logic separated from React integration
3. **Reusable patterns** - Stale time and loading logic can be applied to any collection
4. **Maintainable codebase** - Clear boundaries and well-defined responsibilities

### Foundation for Future Work

1. **Page-level data fetching** - Clean foundation for moving `useInitiativeRefinementData` up
2. **Additional collections** - Easy to add new collections with consistent behavior
3. **Advanced caching strategies** - Framework for implementing cache invalidation, background refetch, etc.
4. **Developer experience** - Predictable, well-documented patterns for data fetching

## Success Metrics

### Functional

- No infinite re-render loops in InitiativeEditPage
- Loading states only change when actually fetching from API
- Multiple hooks for same query share loading states
- Fresh data returns immediately without loading changes

### Performance

- Reduced API call frequency for duplicate requests within stale time
- Decreased React re-render counts
- No loading state cascades between components

### Code Quality

- All core functions have unit tests with >90% coverage
- Clear separation between core logic and React integration
- Consistent patterns across all collection hooks
- Zero TypeScript errors and warnings

## Risk Mitigation

### Backwards Compatibility

- Keep existing hook APIs unchanged
- Gradual migration approach - fix one hook at a time
- Extensive testing before and after changes

### Testing Strategy

- Unit tests for all core functions before integration
- Integration tests for hook behavior
- Performance benchmarks to validate improvements
- Manual testing of all user flows

### Rollback Plan

- Core functions are additive - can be rolled back without breaking changes
- Hook changes are incremental - can revert individual hooks if needed
- Feature flags for enabling/disabling new behavior during testing

## Timeline

- **Week 1**: Phase 1 (Core infrastructure setup)
- **Week 2**: Phase 2-3 (Update createCollection and useInitiative)
- **Week 3**: Phase 4-5 (Testing and validation)
- **Week 4**: Phase 6 (Apply to other hooks and documentation)

This foundational work is essential before attempting the page-level refactoring to move `useInitiativeRefinementData` up to `InitiativeEditPage`.
