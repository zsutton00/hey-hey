import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleBatchRefetch,
  handleFetchQuery,
  handleRefetchQuery,
  type AsyncActionData,
  type FetcherFunction,
  type StateDispatch,
} from "../asyncActions";
import type { StaleTimeConfig } from "../staleTime";
import type { CollectionState, FetcherResponse } from "../types";
import { createFetchQueue, type FetchQueue } from "../fetchQueue";
import { ListQueryMap } from "../ListQueryMap";
import { CollectionMap } from "../CollectionMap";
import { QueryKey, QueryKeyField } from "../QueryKey";

// The handlers only consult fetchUtils for the cache/stale skip decision and
// for wrapping fetched data — mock those so tests drive the queue directly.
vi.mock("../fetchUtils", () => ({
  wrapSingleItem: vi.fn(),
  wrapArrayItems: vi.fn(),
  shouldSkipFetchForQuery: vi.fn(),
}));

import {
  shouldSkipFetchForQuery,
  wrapArrayItems,
  wrapSingleItem,
} from "../fetchUtils";

type TestQueryFields = {
  key: QueryKeyField<string>;
};

class TestQueryKey extends QueryKey<TestQueryFields> {
  constructor(key: string) {
    super({ key: new QueryKeyField("key", key) });
  }
}

const createTestQueryKey = (key: string) => new TestQueryKey(key);

const mockWrapSingleItem = wrapSingleItem as vi.MockedFunction<
  typeof wrapSingleItem
>;
const mockWrapArrayItems = wrapArrayItems as vi.MockedFunction<
  typeof wrapArrayItems
>;
const mockShouldSkipFetchForQuery =
  shouldSkipFetchForQuery as vi.MockedFunction<typeof shouldSkipFetchForQuery>;

type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("asyncActions", () => {
  const testQueryKey = createTestQueryKey("test-query");
  const testQueryKeyString = testQueryKey.toKey();
  const mockState: CollectionState<unknown> = {
      staleTimeMs: 300_000,
    items: new CollectionMap(),
    listQueries: new ListQueryMap(),
    singleQueries: new Map(),
    stale: new Set(),
    loading: new Set(),
    fetched: new Set(),
    errors: new Map(),
    optimisticUpdates: new Map(),
  };
  const getState = () => mockState;

  const mockStaleTimeConfig: StaleTimeConfig = { staleTimeMs: 30000 };

  const mockFetcher: FetcherFunction<unknown> = vi.fn();
  let fetchQueue: FetchQueue<AsyncActionData<unknown>>;
  let mockDispatch: vi.MockedFunction<StateDispatch>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch = vi.fn();
    // Zero-length window: the trailing window collapses to "next microtask",
    // so awaiting a handler resolves as soon as the coalesced fetch settles.
    fetchQueue = createFetchQueue<AsyncActionData<unknown>>(0);
  });

  describe("handleFetchQuery", () => {
    it("should return cached data if fetch should be skipped", async () => {
      const mockData = { id: "1", name: "Test" };
      mockShouldSkipFetchForQuery.mockReturnValue({
        skip: true,
        data: mockData,
      });

      const result = await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(result).toBe(mockData);
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it("should not schedule a fetch when the caller has already aborted", async () => {
      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      const abortController = new AbortController();
      abortController.abort();

      const result = await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch,
        abortController.signal
      );

      expect(result).toBe(null);
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it("should handle single item fetch successfully", async () => {
      const mockResponseData = { id: "1", name: "Test" };
      const mockWrappedItem = {
        id: "1",
        data: mockResponseData,
        lastFetched: "2024-01-01",
        queryKeys: [testQueryKeyString],
      };

      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: false,
      });
      mockWrapSingleItem.mockReturnValue(mockWrappedItem as never);

      const result = await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(result).toBe(mockResponseData);

      // Loading is asserted up front (eager), the item + success are
      // dispatched once the coalesced fetch resolves, loading clears last.
      const calls = mockDispatch.mock.calls.map((call) => call[0]);
      expect(calls[0]).toEqual({
        type: "SET_LOADING",
        payload: { queryKey: testQueryKey, isLoading: true },
      });
      expect(calls.at(-1)).toEqual({
        type: "SET_LOADING",
        payload: { queryKey: testQueryKey, isLoading: false },
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ITEM",
        payload: { item: mockWrappedItem, queryKey: testQueryKey },
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_FETCH_SUCCESS",
        payload: { queryKey: testQueryKey },
      });
    });

    it("stores parsed single-item responses as a single query", async () => {
      const mockResponseData = { name: "Task" };
      const parsedItem = {
        id: "STANDARD",
        data: mockResponseData,
        updatedAt: "2024-01-01",
        lastFetched: "2024-01-01",
        queryKeys: [testQueryKeyString],
        fetchedCount: 1,
      };

      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: false,
        parsedItems: [parsedItem],
      });

      await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ITEM",
        payload: { item: parsedItem, queryKey: testQueryKey },
      });
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_ITEMS" })
      );
    });

    it("keeps multiple parsed items from a single response as a list query", async () => {
      const mockResponseData = { name: "Hierarchy" };
      const parsedItems = [
        {
          id: "parent",
          data: { name: "Parent" },
          updatedAt: "2024-01-01",
          lastFetched: "2024-01-01",
          queryKeys: [testQueryKeyString],
          fetchedCount: 1,
        },
        {
          id: "child",
          data: { name: "Child" },
          updatedAt: "2024-01-01",
          lastFetched: "2024-01-01",
          queryKeys: [testQueryKeyString],
          fetchedCount: 1,
        },
      ];

      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: false,
        parsedItems,
        parsedItemsQueryKind: "list",
      });

      await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ITEMS",
        payload: { items: parsedItems, queryKey: testQueryKey },
      });
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_ITEM" })
      );
    });

    it("should handle array fetch successfully", async () => {
      const mockResponseData = [
        { id: "1", name: "First" },
        { id: "2", name: "Second" },
      ];
      const mockWrappedItems = mockResponseData.map((item) => ({
        id: item.id,
        data: item,
        lastFetched: "2024-01-01",
        queryKeys: [testQueryKeyString],
      }));

      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: true,
      });
      mockWrapArrayItems.mockReturnValue(mockWrappedItems as never);

      const result = await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(result).toBe(mockResponseData);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ITEMS",
        payload: { items: mockWrappedItems, queryKey: testQueryKey },
      });
    });

    it("keeps parsed list responses as list queries", async () => {
      const mockResponseData = [{ name: "Task" }];
      const parsedItems = [
        {
          id: "STANDARD",
          data: mockResponseData[0],
          updatedAt: "2024-01-01",
          lastFetched: "2024-01-01",
          queryKeys: [testQueryKeyString],
          fetchedCount: 1,
        },
      ];

      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: true,
        parsedItems,
      });

      await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ITEMS",
        payload: { items: parsedItems, queryKey: testQueryKey },
      });
    });

    it("should clear a single query when the fetch returns no item", async () => {
      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: null,
        isArray: false,
      });

      const result = await handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(result).toBeNull();
      expect(mockWrapSingleItem).not.toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "CLEAR_QUERY",
        payload: { queryKey: testQueryKey },
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_FETCH_SUCCESS",
        payload: { queryKey: testQueryKey },
      });
    });

    it("should handle fetch errors correctly", async () => {
      const mockError = new Error("Fetch failed");

      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockRejectedValue(
        mockError
      );

      await expect(
        handleFetchQuery(
          testQueryKey,
          getState,
          mockFetcher,
          mockStaleTimeConfig,
          fetchQueue,
          mockDispatch
        )
      ).rejects.toThrow("Fetch failed");

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_FETCH_ERROR",
        payload: { queryKey: testQueryKey, error: mockError },
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_LOADING",
        payload: { queryKey: testQueryKey, isLoading: false },
      });
    });

    it("should coalesce a burst of concurrent fetches into a single network call", async () => {
      const mockResponseData = { id: "1", name: "Test" };
      mockShouldSkipFetchForQuery.mockReturnValue({ skip: false });
      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: false,
      });
      mockWrapSingleItem.mockReturnValue({
        id: "1",
        data: mockResponseData,
        lastFetched: "2024-01-01",
        queryKeys: [testQueryKeyString],
      } as never);

      const results = await Promise.all([
        handleFetchQuery(
          testQueryKey,
          getState,
          mockFetcher,
          mockStaleTimeConfig,
          fetchQueue,
          mockDispatch
        ),
        handleFetchQuery(
          testQueryKey,
          getState,
          mockFetcher,
          mockStaleTimeConfig,
          fetchQueue,
          mockDispatch
        ),
        handleFetchQuery(
          testQueryKey,
          getState,
          mockFetcher,
          mockStaleTimeConfig,
          fetchQueue,
          mockDispatch
        ),
      ]);

      // Every caller gets the result, but only one network call was made.
      expect(results).toEqual([
        mockResponseData,
        mockResponseData,
        mockResponseData,
      ]);
      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });

    it("should not let an older in-flight response satisfy a parked follow-up", async () => {
      const olderMessage = { id: "message-1", text: "initial" };
      const newerMessage = { id: "message-2", text: "final" };
      const firstFetch = createDeferredPromise<FetcherResponse<unknown>>();

      mockShouldSkipFetchForQuery
        // First caller should enqueue work.
        .mockReturnValueOnce({ skip: false })
        // Initial queued cycle still gets the fire-time freshness check.
        .mockReturnValueOnce({ skip: false })
        // Follow-up invalidation arrives while the first fetch is in flight.
        .mockReturnValueOnce({ skip: false })
        // If a parked cycle incorrectly re-checks freshness, it would accept
        // the older response and never perform the required follow-up read.
        .mockReturnValue({ skip: true, data: olderMessage });

      (mockFetcher as vi.MockedFunction<typeof mockFetcher>)
        .mockReturnValueOnce(firstFetch.promise)
        .mockResolvedValueOnce({ data: newerMessage, isArray: false });

      mockWrapSingleItem
        .mockReturnValueOnce({
          id: olderMessage.id,
          data: olderMessage,
          lastFetched: "2024-01-01",
          queryKeys: [testQueryKeyString],
        } as never)
        .mockReturnValueOnce({
          id: newerMessage.id,
          data: newerMessage,
          lastFetched: "2024-01-01",
          queryKeys: [testQueryKeyString],
        } as never);

      const firstRequest = handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      await vi.waitFor(() => expect(mockFetcher).toHaveBeenCalledTimes(1));

      const followUpRequest = handleFetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        mockStaleTimeConfig,
        fetchQueue,
        mockDispatch
      );

      expect(mockFetcher).toHaveBeenCalledTimes(1);

      firstFetch.resolve({ data: olderMessage, isArray: false });

      await vi.waitFor(() => expect(mockFetcher).toHaveBeenCalledTimes(2));

      await expect(firstRequest).resolves.toBe(olderMessage);
      await expect(followUpRequest).resolves.toBe(newerMessage);
      expect(mockShouldSkipFetchForQuery).toHaveBeenCalledTimes(3);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ITEM",
        payload: {
          item: {
            id: newerMessage.id,
            data: newerMessage,
            lastFetched: "2024-01-01",
            queryKeys: [testQueryKeyString],
          },
          queryKey: testQueryKey,
        },
      });
    });
  });

  describe("handleRefetchQuery", () => {
    it("should mark as stale before fetching", async () => {
      const mockResponseData = { id: "1", name: "Test" };

      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockResolvedValue({
        data: mockResponseData,
        isArray: false,
      });
      mockWrapSingleItem.mockReturnValue({
        id: "1",
        data: mockResponseData,
        lastFetched: "2024-01-01",
        queryKeys: [testQueryKeyString],
      } as never);

      const result = await handleRefetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        fetchQueue,
        mockDispatch
      );

      expect(result).toBe(mockResponseData);
      expect(mockDispatch).toHaveBeenNthCalledWith(1, {
        type: "MARK_STALE",
        payload: { queryKey: testQueryKey },
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_LOADING",
        payload: { queryKey: testQueryKey, isLoading: true },
      });
    });

    it("should mark stale but not fetch when the caller has aborted", async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await handleRefetchQuery(
        testQueryKey,
        getState,
        mockFetcher,
        fetchQueue,
        mockDispatch,
        abortController.signal
      );

      expect(result).toBe(null);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "MARK_STALE",
        payload: { queryKey: testQueryKey },
      });
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it("should handle refetch errors correctly", async () => {
      const mockError = new Error("Refetch failed");

      (mockFetcher as vi.MockedFunction<typeof mockFetcher>).mockRejectedValue(
        mockError
      );

      await expect(
        handleRefetchQuery(
          testQueryKey,
          getState,
          mockFetcher,
          fetchQueue,
          mockDispatch
        )
      ).rejects.toThrow("Refetch failed");

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "MARK_STALE",
        payload: { queryKey: testQueryKey },
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_FETCH_ERROR",
        payload: { queryKey: testQueryKey, error: mockError },
      });
    });
  });

  describe("handleBatchRefetch", () => {
    it("should handle multiple query refetches", async () => {
      const queryKeys = [
        createTestQueryKey("query1"),
        createTestQueryKey("query2"),
      ];
      const queryKeyStrings = queryKeys.map((key) => key.toKey());

      (mockFetcher as vi.MockedFunction<typeof mockFetcher>)
        .mockResolvedValueOnce({
          data: { id: "1", name: "First" },
          isArray: false,
        })
        .mockResolvedValueOnce({
          data: { id: "2", name: "Second" },
          isArray: false,
        });
      mockWrapSingleItem
        .mockReturnValueOnce({
          id: "1",
          data: { id: "1", name: "First" },
          lastFetched: "2024-01-01",
          queryKeys: [queryKeyStrings[0]],
        } as never)
        .mockReturnValueOnce({
          id: "2",
          data: { id: "2", name: "Second" },
          lastFetched: "2024-01-01",
          queryKeys: [queryKeyStrings[1]],
        } as never);

      const result = await handleBatchRefetch(
        queryKeys,
        getState,
        mockFetcher,
        fetchQueue,
        mockDispatch
      );

      expect(result.size).toBe(2);
      expect((result.get(queryKeyStrings[0]) as { name: string }).name).toBe(
        "First"
      );
      expect((result.get(queryKeyStrings[1]) as { name: string }).name).toBe(
        "Second"
      );

      const staleDispatchCalls = mockDispatch.mock.calls.filter(
        (call) => call[0].type === "MARK_STALE"
      );
      expect(staleDispatchCalls).toHaveLength(2);
    });

    it("should handle partial failures in batch refetch", async () => {
      const queryKeys = [
        createTestQueryKey("query1"),
        createTestQueryKey("query2"),
      ];
      const queryKeyStrings = queryKeys.map((key) => key.toKey());

      (mockFetcher as vi.MockedFunction<typeof mockFetcher>)
        .mockResolvedValueOnce({
          data: { id: "1", name: "First" },
          isArray: false,
        })
        .mockRejectedValueOnce(new Error("Second query failed"));
      mockWrapSingleItem.mockReturnValueOnce({
        id: "1",
        data: { id: "1", name: "First" },
        lastFetched: "2024-01-01",
        queryKeys: [queryKeyStrings[0]],
      } as never);

      const result = await handleBatchRefetch(
        queryKeys,
        getState,
        mockFetcher,
        fetchQueue,
        mockDispatch
      );

      expect((result.get(queryKeyStrings[0]) as { name: string }).name).toBe(
        "First"
      );
      expect(result.get(queryKeyStrings[1])).toBe(null);
      expect(result.size).toBe(2);
    });

    it("should mark stale but not fetch on an aborted batch refetch", async () => {
      const abortController = new AbortController();
      abortController.abort();
      const queryKeys = [
        createTestQueryKey("query1"),
        createTestQueryKey("query2"),
      ];
      const queryKeyStrings = queryKeys.map((key) => key.toKey());

      const result = await handleBatchRefetch(
        queryKeys,
        getState,
        mockFetcher,
        fetchQueue,
        mockDispatch,
        abortController.signal
      );

      expect(result.get(queryKeyStrings[0])).toBe(null);
      expect(result.get(queryKeyStrings[1])).toBe(null);
      expect(result.size).toBe(2);
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it("should handle empty query keys array", async () => {
      const result = await handleBatchRefetch(
        [],
        getState,
        mockFetcher,
        fetchQueue,
        mockDispatch
      );

      expect(result.size).toBe(0);
      expect(mockFetcher).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
