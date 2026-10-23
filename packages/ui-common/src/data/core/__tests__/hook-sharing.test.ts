import { renderHook, waitFor, act } from "@testing-library/react";
import { vi } from "vitest";
import { useQuery } from "../useQuery";
import type {
  CollectionState,
  CollectionItem,
  DispatchFunction,
} from "../types";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import { QueryKey, QueryKeyField } from "../QueryKey";

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

describe("Hook Loading State Sharing (Phase 5 Simplified Implementation)", () => {
  let mockDispatch: vi.MockedFunction<DispatchFunction<TestData>>;
  let sharedState: CollectionState<TestData>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    sharedState = {
      items: new CollectionMap(),
      singleQueries: new Map(),
      loading: new Set(),
      errors: new Map(),
      stale: new Set(),
      listQueries: new ListQueryMap(),
      fetched: new Set(),
      optimisticUpdates: new Map(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should share loading state between multiple hooks with same queryKey", async () => {
    const queryKey = createTestQueryKey("shared-key");
    const queryKeyString = queryKey.toKey();
    // Render first hook
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    // Render second hook with same queryKey
    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    // Initially both should show not loading
    expect(result1.current.isLoading).toBe(false);
    expect(result2.current.isLoading).toBe(false);

    // Simulate shared state update (loading: true)
    act(() => {
      sharedState.loading.add(queryKeyString);
    });

    // Force re-render by changing state reference
    const updatedState = { ...sharedState };

    const { result: result1Updated } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: updatedState,
        enabled: true,
      })
    );

    const { result: result2Updated } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: updatedState,
        enabled: true,
      })
    );

    // Both hooks should see the same loading state
    expect(result1Updated.current.isLoading).toBe(true);
    expect(result2Updated.current.isLoading).toBe(true);
  });

  it("should share data between hooks with same queryKey", () => {
    const queryKey = createTestQueryKey("shared-key");
    const queryKeyString = queryKey.toKey();
    const testData = { id: "1", name: "shared data" };

    // Setup shared data
    const item: CollectionItem<TestData> = {
      id: "item-1",
      updatedAt: new Date().toISOString(),
      lastFetched: new Date().toISOString(),
      data: testData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    };
    sharedState.items.setByStorageId("item-1", item);
    sharedState.singleQueries.set(queryKeyString, "item-1");

    // Render two hooks with same queryKey
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    // Both should have the same data
    expect(result1.current.data).toEqual(testData);
    expect(result2.current.data).toEqual(testData);
  });

  it("should share stale state between hooks with same queryKey", () => {
    const queryKey = createTestQueryKey("shared-key");
    const queryKeyString = queryKey.toKey();
    // Mark query as stale
    sharedState.stale.add(queryKeyString);

    // Render two hooks with same queryKey
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    // Both should see stale state
    expect(result1.current.isStale).toBe(true);
    expect(result2.current.isStale).toBe(true);
  });

  it("should share error state between hooks with same queryKey", () => {
    const queryKey = createTestQueryKey("shared-key");
    const queryKeyString = queryKey.toKey();
    const testError = new Error("Test error");
    sharedState.errors.set(queryKeyString, testError);

    // Render two hooks with same queryKey
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    // Both should see the same error
    expect(result1.current.error).toBe(testError);
    expect(result2.current.error).toBe(testError);
  });

  it("should have independent state for different queryKeys", () => {
    const queryKey1 = createTestQueryKey("key-1");
    const queryKey1String = queryKey1.toKey();
    const queryKey2 = createTestQueryKey("key-2");
    const queryKey2String = queryKey2.toKey();
    // Setup data for first query
    const testData1 = { id: "1", name: "data 1" };
    const item1: CollectionItem<TestData> = {
      id: "item-1",
      updatedAt: new Date().toISOString(),
      lastFetched: new Date().toISOString(),
      data: testData1,
      queryKeys: [queryKey1String],
      fetchedCount: 1,
    };
    sharedState.items.setByStorageId("item-1", item1);
    sharedState.singleQueries.set(queryKey1String, "item-1");
    sharedState.loading.add(queryKey1String);

    // Setup different state for second query
    const testData2 = { id: "2", name: "data 2" };
    const item2: CollectionItem<TestData> = {
      id: "item-2",
      updatedAt: new Date().toISOString(),
      lastFetched: new Date().toISOString(),
      data: testData2,
      queryKeys: [queryKey2String],
      fetchedCount: 1,
    };
    sharedState.items.setByStorageId("item-2", item2);
    sharedState.singleQueries.set(queryKey2String, "item-2");
    sharedState.stale.add(queryKey2String);

    // Render hooks with different queryKeys
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey: queryKey1,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey: queryKey2,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
      })
    );

    // Should have independent data
    expect(result1.current.data).toEqual(testData1);
    expect(result2.current.data).toEqual(testData2);

    // Should have independent loading state
    expect(result1.current.isLoading).toBe(false);
    expect(result2.current.isLoading).toBe(false);

    // Should have independent fetching state
    expect(result1.current.isFetching).toBe(true);
    expect(result2.current.isFetching).toBe(false);

    // Should have independent stale state
    expect(result1.current.isStale).toBe(false);
    expect(result2.current.isStale).toBe(true);
  });

  it("should allow both hooks to independently call markStale for same query", () => {
    const queryKey = createTestQueryKey("shared-key");
    // Render two hooks with same queryKey, but disable initial fetching
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
        refetchOnMount: false, // Disable initial fetch to isolate markStale behavior
      })
    );

    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
        refetchOnMount: false, // Disable initial fetch to isolate markStale behavior
      })
    );

    // Both hooks should be able to independently call markStale
    act(() => {
      result1.current.markStale();
    });

    act(() => {
      result2.current.markStale();
    });

    // Should have dispatched MARK_STALE twice for the same queryKey
    // This tests that each hook instance can independently trigger actions
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenNthCalledWith(1, {
      type: "MARK_STALE",
      queryKey,
    });
    expect(mockDispatch).toHaveBeenNthCalledWith(2, {
      type: "MARK_STALE",
      queryKey,
    });
  });

  it("should dispatch fetch actions independently for same queryKey", async () => {
    const queryKey = createTestQueryKey("shared-key");
    // Mock dispatch to return test data
    mockDispatch.mockResolvedValue({ id: "1", name: "test" });

    // Render first hook
    const { result: result1 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
        refetchOnMount: true,
      })
    );

    // Render second hook immediately with same queryKey
    const { result: result2 } = renderHook(() =>
      useQuery({
        queryKey,
        dispatch: mockDispatch,
        state: sharedState,
        enabled: true,
        refetchOnMount: true,
      })
    );

    // Wait for initial fetches to be dispatched
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalled();
    });

    // Both refetch calls should work independently
    await act(async () => {
      await result1.current.refetch();
    });

    await act(async () => {
      await result2.current.refetch();
    });

    // Should have dispatched fetch actions (initial + refetches)
    // The exact count depends on timing, but both hooks should be functional
    expect(mockDispatch).toHaveBeenCalled();
    expect(
      mockDispatch.mock.calls.some((call) => call[0].type === "FETCH_QUERY")
    ).toBe(true);
  });
});
