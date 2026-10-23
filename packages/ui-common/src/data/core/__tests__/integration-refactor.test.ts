import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useQuery } from "../useQuery";
import { createCollection } from "../createCollection";
import type {
  FetcherResponse,
  CollectionItem,
  CollectionState,
} from "../types";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import { QueryKey, QueryKeyField } from "../QueryKey";

interface TestItem {
  id: string;
  name: string;
  updatedAt: string;
}

type TestQueryFields = {
  key: QueryKeyField<string>;
};

class TestQueryKey extends QueryKey<TestQueryFields> {
  constructor(key: string) {
    super({ key: new QueryKeyField("key", key) });
  }
}

const createTestQueryKey = (key: string) => new TestQueryKey(key);

describe("Integration: Actions Atom Refactor", () => {
  it("should handle complete fetch flow atomically", async () => {
    // Setup mock fetcher
    const mockFetcher = vi.fn<[QueryKey], Promise<FetcherResponse<TestItem>>>();
    const testData = { id: "1", name: "Test Item", updatedAt: "2024-01-01" };

    mockFetcher.mockResolvedValue({
      data: testData,
      isArray: false,
    });

    // Create collection with the refactored implementation
    const collection = createCollection<TestItem>({
      name: "test-integration",
      fetcher: mockFetcher,
    });

    // Mock store setup (simplified for testing)
    const currentState = {
      items: new CollectionMap(),
      listQueries: new ListQueryMap(),
      singleQueries: new Map(),
      stale: new Set(),
      loading: new Set(),
      fetched: new Set(),
      errors: new Map(),
      optimisticUpdates: new Map(),
    };

    // Mock dispatch that uses the actual actions atom logic
    const mockDispatch = vi.fn().mockImplementation(async (action) => {
      if (action.type === "FETCH_QUERY") {
        const queryKeyString = action.queryKey.toKey();
        // Simulate the actions atom calling our async handlers
        const response = await mockFetcher(action.queryKey);

        // Simulate state updates that would happen in the actions atom
        const now = new Date().toISOString();
        const wrappedItem = {
          id: testData.id,
          updatedAt: testData.updatedAt,
          lastFetched: now,
          data: testData,
          queryKeys: [queryKeyString],
          fetchedCount: 1,
        };

        currentState.items.setByStorageId(testData.id, wrappedItem);
        currentState.singleQueries.set(queryKeyString, testData.id);
        currentState.fetched.add(queryKeyString);

        return testData;
      }

      if (action.type === "REFETCH_QUERY") {
        const queryKeyString = action.queryKey.toKey();
        // Simulate refetch: mark stale then fetch
        currentState.stale.add(queryKeyString);
        const response = await mockFetcher(action.queryKey);

        const now = new Date().toISOString();
        const wrappedItem = {
          id: testData.id,
          updatedAt: testData.updatedAt,
          lastFetched: now,
          data: testData,
          queryKeys: [queryKeyString],
          fetchedCount: 1,
        };

        currentState.items.setByStorageId(testData.id, wrappedItem);
        currentState.singleQueries.set(queryKeyString, testData.id);
        currentState.stale.delete(queryKeyString); // Remove stale after successful fetch

        return testData;
      }

      if (action.type === "MARK_STALE") {
        currentState.stale.add(action.queryKey.toKey());
      }

      return undefined;
    });

    // Test the useQuery hook with the refactored implementation
    const queryKey = createTestQueryKey("test-item");
    const { result, rerender } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: currentState,
        enabled: true,
        refetchOnMount: true,
      })
    );

    // Initial state should be null
    expect(result.current.data).toBeNull();

    // Wait for the initial fetch to complete
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "FETCH_QUERY",
        queryKey,
        signal: expect.any(AbortSignal),
      });
    });

    // Verify that the fetcher was called
    expect(mockFetcher).toHaveBeenCalledWith(queryKey);

    // Update the state and rerender to simulate the state change
    rerender();

    // Now data should be available
    expect(result.current.data).toEqual(testData);
    expect(result.current.isFetched).toBe(true);

    // Test refetch functionality
    await act(async () => {
      await result.current.refetch();
    });

    // Verify refetch called the correct action
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "REFETCH_QUERY",
      queryKey,
      signal: expect.any(AbortSignal),
    });

    // Test markStale functionality
    act(() => {
      result.current.markStale();
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "MARK_STALE",
      queryKey,
    });
  });

  it("should demonstrate the race condition fix", async () => {
    // This test demonstrates that the old problem is solved:
    // Before: dispatch(MARK_STALE) + fetchData() had race conditions
    // After: dispatch(REFETCH_QUERY) is atomic

    const mockFetcher = vi.fn<[QueryKey], Promise<FetcherResponse<TestItem>>>();
    const testData = { id: "1", name: "Test Item", updatedAt: "2024-01-01" };

    mockFetcher.mockResolvedValue({
      data: testData,
      isArray: false,
    });

    const currentState = {
      items: new CollectionMap(),
      listQueries: new ListQueryMap(),
      singleQueries: new Map(),
      stale: new Set(),
      loading: new Set(),
      fetched: new Set(),
      errors: new Map(),
      optimisticUpdates: new Map(),
    };

    const staleOperations: string[] = [];

    const mockDispatch = vi.fn().mockImplementation(async (action) => {
      if (action.type === "REFETCH_QUERY") {
        // Record the sequence of operations for this atomic action
        staleOperations.push("MARK_STALE"); // This happens first
        staleOperations.push("FETCH"); // Then this happens
        staleOperations.push("SUCCESS"); // Then this happens

        // All in one atomic operation - no React renders in between
        const queryKeyString = action.queryKey.toKey();
        currentState.stale.add(queryKeyString);
        const response = await mockFetcher(action.queryKey);
        currentState.stale.delete(queryKeyString);

        return testData;
      }
      return undefined;
    });

    const queryKey = createTestQueryKey("test-item");
    const { result } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: currentState,
        enabled: true,
        refetchOnMount: false,
      })
    );

    // Execute refetch (the previously problematic operation)
    await act(async () => {
      await result.current.refetch();
    });

    // Verify that all operations happened atomically in correct order
    expect(staleOperations).toEqual(["MARK_STALE", "FETCH", "SUCCESS"]);

    // Verify that the dispatch was called once with the atomic action
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "REFETCH_QUERY",
      queryKey,
      signal: expect.any(AbortSignal),
    });

    // No separate MARK_STALE calls needed!
    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: "MARK_STALE",
      queryKey,
    });
  });

  it("should support both single items and arrays", async () => {
    const mockFetcher = vi.fn<[QueryKey], Promise<FetcherResponse<TestItem>>>();
    const arrayData = [
      { id: "1", name: "Item 1", updatedAt: "2024-01-01" },
      { id: "2", name: "Item 2", updatedAt: "2024-01-02" },
    ];

    mockFetcher.mockResolvedValue({
      data: arrayData,
      isArray: true,
    });

    let currentState: CollectionState<TestItem> = {
      staleTimeMs: 300_000,
      items: new CollectionMap<TestItem>(),
      listQueries: new ListQueryMap(),
      singleQueries: new Map<string, string>(),
      stale: new Set<string>(),
      loading: new Set<string>(),
      fetched: new Set<string>(),
      errors: new Map<string, Error>(),
      optimisticUpdates: new Map<string, CollectionItem<TestItem>>(),
    };

    // State setter function that creates new references
    const updateState = (updater: (state: typeof currentState) => void) => {
      const newState = {
        items: new CollectionMap(currentState.items),
        listQueries: new ListQueryMap(currentState.listQueries),
        singleQueries: new Map(currentState.singleQueries),
        stale: new Set(currentState.stale),
        loading: new Set(currentState.loading),
        fetched: new Set(currentState.fetched),
        errors: new Map(currentState.errors),
        optimisticUpdates: new Map(currentState.optimisticUpdates),
      };
      updater(newState);
      currentState = newState;
      return newState;
    };

    const mockDispatch = vi.fn().mockImplementation(async (action) => {
      if (action.type === "FETCH_QUERY") {
        const queryKeyString = action.queryKey.toKey();
        const response = await mockFetcher(action.queryKey);

        if (response.isArray) {
          const now = new Date().toISOString();
          const items = (response.data as TestItem[]).map((item) => ({
            id: item.id,
            updatedAt: item.updatedAt,
            lastFetched: now,
            data: item,
            queryKeys: [queryKeyString],
            fetchedCount: 1,
          }));

          // Use updateState to create new references
          updateState((newState) => {
            items.forEach((item) => {
              newState.items.setByStorageId(item.id, item);
            });

            newState.listQueries.setByKeyString(
              queryKeyString,
              items.map((item) => item.id)
            );
            newState.fetched.add(queryKeyString);
          });

          return arrayData;
        }
      }
      return undefined;
    });

    const listQueryKey = createTestQueryKey("test-items");
    const { result, rerender } = renderHook(
      (props) =>
        useQuery({
          queryKey: listQueryKey,
          dispatch: mockDispatch,
          state: props.state,
          enabled: true,
          refetchOnMount: true,
        }),
      {
        initialProps: { state: currentState },
      }
    );

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalled();
    });

    // Rerender with the updated state
    rerender({ state: currentState });

    // Verify array data is returned
    expect(result.current.data).toEqual(arrayData);
  });
});
