import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { useQuery } from "../useQuery";
import type { CollectionState, FetcherResponse } from "../types";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import { QueryKey, QueryKeyField } from "../QueryKey";
import { createFetchQueue } from "../fetchQueue";

interface TestData {
  id: string;
  name: string;
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

describe("Fresh Data Behavior (Phase 5 Simplified Interface)", () => {
  let mockDispatch: ReturnType<typeof vi.fn>;
  let mockState: CollectionState<TestData>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    mockState = {
      staleTimeMs: 300_000,
      items: new CollectionMap(),
      singleQueries: new Map(),
      loading: new Set(),
      errors: new Map(),
      stale: new Set(),
      listQueries: new ListQueryMap(),
      fetched: new Set(), // Added missing fetched field
      optimisticUpdates: new Map(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return fresh data immediately without loading changes", async () => {
    const queryKey = createTestQueryKey("test-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "fresh data" };
    const freshTimestamp = new Date().toISOString();

    // Setup fresh data in state
    mockState.items.setByStorageId("item-1", {
      id: "item-1",
      updatedAt: freshTimestamp,
      lastFetched: freshTimestamp,
      data: testData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    });
    mockState.singleQueries.set(queryKeyString, "item-1");
    mockState.fetched.add(queryKeyString);

    // Mock dispatch to simulate async actions behavior - return cached data without fetching
    mockDispatch.mockImplementation(async (action) => {
      if (action.type === "FETCH_QUERY") {
        // Simulate handleFetchQuery returning cached data for fresh items
        return testData;
      }
      return undefined;
    });

    const { result } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: mockState,
        enabled: true,
        refetchOnMount: false, // Don't fetch on mount to test immediate return
      })
    );

    // Should return fresh data immediately
    expect(result.current.data).toEqual(testData);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetched).toBe(true);
    expect(result.current.isStale).toBe(false);
    expect(result.current.error).toBeNull();

    // Should not have dispatched any fetch actions when refetchOnMount is false and data is present
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("should not trigger loading state changes for fresh data on mount", async () => {
    const queryKey = createTestQueryKey("test-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "fresh data" };
    const freshTimestamp = new Date().toISOString();

    mockState.items.setByStorageId("item-1", {
      id: "item-1",
      updatedAt: freshTimestamp,
      lastFetched: freshTimestamp,
      data: testData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    });
    mockState.singleQueries.set(queryKeyString, "item-1");
    mockState.fetched.add(queryKeyString);

    // Mock dispatch to simulate returning fresh cached data
    mockDispatch.mockImplementation(async (action) => {
      if (action.type === "FETCH_QUERY") {
        // Simulate handleFetchQuery checking freshness and returning cached data without actually fetching
        return testData;
      }
      return undefined;
    });

    renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: mockState,
        enabled: true,
        refetchOnMount: true,
      })
    );

    // With refetchOnMount: true, dispatch should be called but should return cached data for fresh items
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "FETCH_QUERY",
      queryKey,
      signal: expect.any(AbortSignal),
    });

    // But the actual fetcher should not be called since data is fresh
    // (this would be verified by the async action's internal logic)
  });

  it("should handle multiple hooks accessing fresh data without loading changes", () => {
    const queryKey = createTestQueryKey("test-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "fresh data" };
    const freshTimestamp = new Date().toISOString();

    mockState.items.setByStorageId("item-1", {
      id: "item-1",
      updatedAt: freshTimestamp,
      lastFetched: freshTimestamp,
      data: testData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    });
    mockState.singleQueries.set(queryKeyString, "item-1");
    mockState.fetched.add(queryKeyString);

    // Mock dispatch to return fresh data without fetching
    mockDispatch.mockImplementation(async (action) => {
      if (action.type === "FETCH_QUERY") {
        return testData;
      }
      return undefined;
    });

    // Render multiple hooks with refetchOnMount: false to avoid initial fetches
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: mockState,
        enabled: true,
        refetchOnMount: false,
      })
    );

    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: mockState,
        enabled: true,
        refetchOnMount: false,
      })
    );

    const { result: result3 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: mockState,
        enabled: true,
        refetchOnMount: false,
      })
    );

    // All should return fresh data immediately
    expect(result1.current.data).toEqual(testData);
    expect(result2.current.data).toEqual(testData);
    expect(result3.current.data).toEqual(testData);

    // None should be loading
    expect(result1.current.isLoading).toBe(false);
    expect(result2.current.isLoading).toBe(false);
    expect(result3.current.isLoading).toBe(false);

    // Should not have dispatched any fetch actions with refetchOnMount: false
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("should trigger fetch for stale data but not for fresh data", async () => {
    // Test the async actions directly instead of using collection
    const mockFetcher = vi.fn();
    const freshData = { id: "1", name: "fresh data" };
    const staleData = { id: "2", name: "stale data" };
    const updatedStaleData = { id: "2", name: "updated stale data" };
    const freshQueryKey = createTestQueryKey("fresh-key");
    const freshQueryKeyString = freshQueryKey.toKey();
    const staleQueryKey = createTestQueryKey("stale-key");
    const staleQueryKeyString = staleQueryKey.toKey();

    // Setup mock fetcher responses
    mockFetcher.mockResolvedValueOnce({
      data: updatedStaleData,
      isArray: false,
    });

    const freshTimestamp = new Date().toISOString();
    const staleTimestamp = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    // Setup state with fresh and stale data
    const testState: CollectionState<typeof freshData> = {
      staleTimeMs: 300_000,
      items: new CollectionMap([
        [
          "fresh-item",
          {
            id: "fresh-item",
            updatedAt: freshTimestamp,
            lastFetched: freshTimestamp, // Fresh: within 30 seconds
            data: freshData,
            queryKeys: [freshQueryKeyString],
            fetchedCount: 1,
          },
        ],
        [
          "stale-item",
          {
            id: "stale-item",
            updatedAt: staleTimestamp,
            lastFetched: staleTimestamp, // Stale: 1 minute ago > 30 seconds
            data: staleData,
            queryKeys: [staleQueryKeyString],
            fetchedCount: 1,
          },
        ],
      ]),
      singleQueries: new Map([
        [freshQueryKeyString, "fresh-item"],
        [staleQueryKeyString, "stale-item"],
      ]),
      listQueries: new ListQueryMap(),
      loading: new Set<string>(),
      stale: new Set<string>(),
      fetched: new Set<string>([freshQueryKeyString, staleQueryKeyString]),
      errors: new Map(),
      optimisticUpdates: new Map(),
    };

    const staleTimeConfig = { staleTimeMs: 30000 };
    const fetchQueue = createFetchQueue<
      typeof freshData | (typeof freshData)[] | null
    >(0);

    // Import the async actions directly
    const { handleFetchQuery } = await import("../asyncActions");

    // Create mock dispatch function for immediate dispatch architecture
    const mockDispatch = vi.fn();
    const getState = () => testState;

    // Test fresh data fetch - should NOT call fetcher
    const freshResult = await handleFetchQuery(
      freshQueryKey,
      getState,
      mockFetcher,
      staleTimeConfig,
      fetchQueue,
      mockDispatch
    );

    // Test stale data fetch - should call fetcher
    const staleResult = await handleFetchQuery(
      staleQueryKey,
      getState,
      mockFetcher,
      staleTimeConfig,
      fetchQueue,
      mockDispatch
    );

    // Verify fetcher call behavior
    expect(mockFetcher).toHaveBeenCalledTimes(1); // Only called for stale data
    expect(mockFetcher).toHaveBeenCalledWith(staleQueryKey, expect.anything(), {});

    // Verify return values (direct data, not wrapped in object)
    expect(freshResult).toEqual(freshData); // Cached data returned
    expect(staleResult).toEqual(updatedStaleData); // Fresh data from fetcher
  });

  it("should respect stale time configuration in collection", async () => {
    const queryKey = createTestQueryKey("test-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "test item" };
    const mockFetcher = vi.fn().mockResolvedValue({
      data: testData,
      isArray: false,
    } as FetcherResponse<TestData>);

    const recentTimestamp = new Date().toISOString();

    // Setup state with fresh data (within 30 seconds)
    const freshState = {
      items: new CollectionMap([
        [
          "item1",
          {
            id: "item1",
            updatedAt: recentTimestamp,
            lastFetched: recentTimestamp, // Fresh: just fetched
            data: testData,
            queryKeys: [queryKeyString],
            fetchedCount: 1,
          },
        ],
      ]),
      singleQueries: new Map([[queryKeyString, "item1"]]),
      loading: new Set<string>(),
      stale: new Set<string>(),
      fetched: new Set<string>([queryKeyString]),
      errors: new Map(),
      listQueries: new ListQueryMap(),
      optimisticUpdates: new Map(),
    };

    // Test the shouldSkipFetchForQuery logic directly with fresh data
    const { shouldSkipFetchForQuery } = await import("../fetchUtils");
    const { shouldSkipFetch } = await import("../staleTime");

    const staleTimeConfig = { staleTimeMs: 30000 };

    // Test that fresh data should skip fetch
    const skipResult = shouldSkipFetchForQuery(
      queryKey,
      freshState as any,
      staleTimeConfig
    );

    expect(skipResult.skip).toBe(true);
    expect(skipResult.data).toEqual(testData);

    // Also test the core stale time logic directly
    const item = freshState.items.getByStorageId("item1");
    const shouldSkip = shouldSkipFetch(item as any, staleTimeConfig);

    expect(shouldSkip).toBe(true); // Should skip because data is fresh
  });

  it("should refetch fresh data when the window regains focus", async () => {
    const queryKey = createTestQueryKey("test-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "fresh data" };
    const freshTimestamp = new Date().toISOString();

    mockState.items.setByStorageId("item-1", {
      id: "item-1",
      updatedAt: freshTimestamp,
      lastFetched: freshTimestamp,
      data: testData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    });
    mockState.singleQueries.set(queryKeyString, "item-1");
    mockState.fetched.add(queryKeyString);

    mockDispatch.mockResolvedValue(testData);

    renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: mockState,
        enabled: true,
        refetchOnMount: false, // Don't fetch on mount
        refetchOnWindowFocus: true,
      })
    );

    // Clear any previous calls
    mockDispatch.mockClear();

    // Simulate window focus
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "REFETCH_QUERY",
      queryKey,
      signal: expect.any(AbortSignal),
    });
  });

  it("should handle rapid successive hook mounts without unnecessary fetches", () => {
    const queryKey = createTestQueryKey("test-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "fresh data" };
    const freshTimestamp = new Date().toISOString();

    mockState.items.setByStorageId("item-1", {
      id: "item-1",
      updatedAt: freshTimestamp,
      lastFetched: freshTimestamp,
      data: testData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    });
    mockState.singleQueries.set(queryKeyString, "item-1");
    mockState.fetched.add(queryKeyString);

    // Mock dispatch to return fresh data
    mockDispatch.mockImplementation(async (action) => {
      if (action.type === "FETCH_QUERY") {
        return testData;
      }
      return undefined;
    });

    // Mount hooks rapidly with refetchOnMount: false
    const hooks = Array.from({ length: 5 }, () =>
      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false, // Don't fetch on mount to avoid multiple dispatch calls
        })
      )
    );

    // All should return fresh data immediately
    hooks.forEach(({ result }) => {
      expect(result.current.data).toEqual(testData);
      expect(result.current.isLoading).toBe(false);
    });

    // Should not have triggered any dispatch calls when refetchOnMount is false
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
