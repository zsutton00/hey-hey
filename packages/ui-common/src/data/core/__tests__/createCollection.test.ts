import { act } from "@testing-library/react";
import { createStore } from "jotai";
import { createCollection } from "../createCollection";
import { QueryKey, QueryKeyField } from "../QueryKey";
import type {
  CollectionItem,
  CollectionState,
  CollectionAction,
} from "../types";

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

describe("createCollection", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe("State Management", () => {
    it("should initialize with empty state", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const state = store.get(collection.stateAtom);

      expect(state.items.size()).toBe(0);
      expect(state.listQueries.size()).toBe(0);
      expect(state.singleQueries.size).toBe(0);
      expect(state.stale.size).toBe(0);
      expect(state.loading.size).toBe(0);
      expect(state.errors.size).toBe(0);
    });

    it("should handle SET_ITEMS action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const items: CollectionItem<TestItem>[] = [
        {
          id: "1",
          data: { id: "1", name: "Item 1", updatedAt: "2024-01-01" },
          lastFetched: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01",
          queryKeys: [],
        },
        {
          id: "2",
          data: { id: "2", name: "Item 2", updatedAt: "2024-01-02" },
          lastFetched: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02",
          queryKeys: [],
        },
      ];

      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items,
          queryKey,
        });
      });

      const state = store.get(collection.stateAtom);

      expect(state.items.size()).toBe(2);
      expect(state.items.getByStorageId("1")).toEqual({
        ...items[0],
        queryKeys: [queryKeyString],
      });
      expect(state.items.getByStorageId("2")).toEqual({
        ...items[1],
        queryKeys: [queryKeyString],
      });
      expect(state.listQueries.getByKeyString(queryKeyString)).toEqual([
        "1",
        "2",
      ]);
    });

    it("should handle SET_ITEM action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const item: CollectionItem<TestItem> = {
        id: "1",
        data: { id: "1", name: "Item 1", updatedAt: "2024-01-01" },
        lastFetched: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01",
        queryKeys: [],
      };

      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEM",
          item,
          queryKey,
        });
      });

      const state = store.get(collection.stateAtom);

      expect(state.items.size()).toBe(1);
      expect(state.items.getByStorageId("1")).toEqual({
        ...item,
        queryKeys: [queryKeyString],
      });
      expect(state.singleQueries.get(queryKeyString)).toBe("1");
    });

    it("should handle MARK_STALE action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "MARK_STALE",
          queryKey,
        });
      });

      const state = store.get(collection.stateAtom);
      expect(state.stale.has(queryKeyString)).toBe(true);
    });

    it("should handle MARK_STALE_BY_KEY_STRINGS action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const queryKey1 = createTestQueryKey("query-1");
      const queryKey2 = createTestQueryKey("query-2");
      const queryKey3 = createTestQueryKey("query-3");

      act(() => {
        store.set(collection.actionsAtom, {
          type: "MARK_STALE_BY_KEY_STRINGS",
          queryKeyStrings: [queryKey1.toKey(), queryKey3.toKey()],
        });
      });

      const state = store.get(collection.stateAtom);
      expect(state.stale.has(queryKey1.toKey())).toBe(true);
      expect(state.stale.has(queryKey2.toKey())).toBe(false);
      expect(state.stale.has(queryKey3.toKey())).toBe(true);
    });

    it("should handle NEW_ITEM by invalidating list scopes", () => {
      const collection = createCollection<TestItem, { organizationId: string }>(
        {
          name: "test",
          fetcher: async () => ({ data: [], isArray: true }),
          listScopes: (context) => [
            createTestQueryKey(`tests:${context.organizationId}`),
            createTestQueryKey(`tests:${context.organizationId}:archived`),
          ],
        }
      );

      act(() => {
        store.set(collection.actionsAtom, {
          type: "NEW_ITEM",
          context: { organizationId: "org-1" },
        });
      });

      const state = store.get(collection.stateAtom);

      expect(state.stale.has("key=tests:org-1")).toBe(true);
      expect(state.stale.has("key=tests:org-1:archived")).toBe(true);
    });

    it("should handle MARK_ALL_STALE action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      // Setup some queries
      const query1 = createTestQueryKey("query1");
      const query1String = query1.toKey();
      const query2 = createTestQueryKey("query2");
      const query2String = query2.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items: [
            {
              id: "1",
              data: { id: "1", name: "Item 1", updatedAt: "2024-01-01" },
              lastFetched: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01",
              queryKeys: [],
            },
          ],
          queryKey: query1,
        });
        store.set(collection.actionsAtom, {
          type: "SET_ITEM",
          item: {
            id: "2",
            data: { id: "2", name: "Item 2", updatedAt: "2024-01-02" },
            lastFetched: "2024-01-02T00:00:00Z",
            updatedAt: "2024-01-02",
            queryKeys: [],
          },
          queryKey: query2,
        });
      });

      act(() => {
        store.set(collection.actionsAtom, { type: "MARK_ALL_STALE" });
      });

      const state = store.get(collection.stateAtom);
      expect(state.stale.has(query1String)).toBe(true);
      expect(state.stale.has(query2String)).toBe(true);
    });

    it("should handle OPTIMISTIC_UPDATE action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const originalItem: CollectionItem<TestItem> = {
        id: "1",
        data: { id: "1", name: "Original", updatedAt: "2024-01-01" },
        lastFetched: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01",
        queryKeys: [],
      };

      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEM",
          item: originalItem,
          queryKey,
        });
      });

      act(() => {
        store.set(collection.actionsAtom, {
          type: "OPTIMISTIC_UPDATE",
          id: "1",
          updater: (item) => ({
            ...item,
            data: { ...item.data, name: "Updated" },
          }),
        });
      });

      const state = store.get(collection.stateAtom);

      expect(state.items.getByStorageId("1")?.data.name).toBe("Updated");
      expect(state.optimisticUpdates.has("1")).toBe(true);
      expect(state.optimisticUpdates.get("1")?.previous).toEqual({
        ...originalItem,
        queryKeys: [queryKeyString],
      });
    });

    it("should handle ROLLBACK_OPTIMISTIC action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const originalItem: CollectionItem<TestItem> = {
        id: "1",
        data: { id: "1", name: "Original", updatedAt: "2024-01-01" },
        lastFetched: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01",
        queryKeys: [],
      };

      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEM",
          item: originalItem,
          queryKey,
        });
        store.set(collection.actionsAtom, {
          type: "OPTIMISTIC_UPDATE",
          id: "1",
          updater: (item) => ({
            ...item,
            data: { ...item.data, name: "Updated" },
          }),
        });
      });

      act(() => {
        store.set(collection.actionsAtom, {
          type: "ROLLBACK_OPTIMISTIC",
          id: "1",
        });
      });

      const state = store.get(collection.stateAtom);

      expect(state.items.getByStorageId("1")).toEqual({
        ...originalItem,
        queryKeys: [queryKeyString],
      });
      expect(state.optimisticUpdates.has("1")).toBe(false);
    });

    it("should handle DELETE_ITEM action", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const items: CollectionItem<TestItem>[] = [
        {
          id: "1",
          data: { id: "1", name: "Item 1", updatedAt: "2024-01-01" },
          lastFetched: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01",
          queryKeys: [],
        },
        {
          id: "2",
          data: { id: "2", name: "Item 2", updatedAt: "2024-01-02" },
          lastFetched: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02",
          queryKeys: [],
        },
      ];

      const listQuery = createTestQueryKey("list-query");
      const listQueryString = listQuery.toKey();
      const singleQuery = createTestQueryKey("single-query");
      const singleQueryString = singleQuery.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items,
          queryKey: listQuery,
        });
        store.set(collection.actionsAtom, {
          type: "SET_ITEM",
          item: items[0],
          queryKey: singleQuery,
        });
      });

      act(() => {
        store.set(collection.actionsAtom, {
          type: "DELETE_ITEM",
          id: "1",
        });
      });

      const state = store.get(collection.stateAtom);

      expect(state.items.hasByStorageId("1")).toBe(false);
      expect(state.items.hasByStorageId("2")).toBe(true);
      expect(state.listQueries.getByKeyString(listQueryString)).toEqual(["2"]);
      expect(state.singleQueries.has(singleQueryString)).toBe(false);
    });

    it("should handle loading and error states", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const error = new Error("Test error");

      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_LOADING",
          queryKey,
          isLoading: true,
        });
      });

      let state = store.get(collection.stateAtom);
      expect(state.loading.has(queryKeyString)).toBe(true);

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_LOADING",
          queryKey,
          isLoading: false,
        });
        store.set(collection.actionsAtom, {
          type: "SET_ERROR",
          queryKey,
          error,
        });
      });

      state = store.get(collection.stateAtom);
      expect(state.loading.has(queryKeyString)).toBe(false);
      expect(state.errors.get(queryKeyString)).toBe(error);
    });
  });

  describe("Query Key Serialization", () => {
    it("should use queryKey.toKey for list queries", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const queryKey = createTestQueryKey("serialized");
      const serialized = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items: [
            {
              id: "1",
              data: { id: "1", name: "Item", updatedAt: "2024-01-01" },
              lastFetched: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01",
              queryKeys: [],
            },
          ],
          queryKey,
        });
      });

      const state = store.get(collection.stateAtom);
      expect(state.listQueries.hasByKeyString(serialized)).toBe(true);
    });
  });

  describe("SET_ITEMS Data Update Bug", () => {
    it("should update existing items with fresh data while preserving queryKeys", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      // Initial items with original data
      const initialItems: CollectionItem<TestItem>[] = [
        {
          id: "item-1",
          data: {
            id: "item-1",
            name: "Original Name 1",
            updatedAt: "2024-01-01",
          },
          lastFetched: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01",
          queryKeys: [], // Will be set by action
        },
        {
          id: "item-2",
          data: {
            id: "item-2",
            name: "Original Name 2",
            updatedAt: "2024-01-01",
          },
          lastFetched: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01",
          queryKeys: [], // Will be set by action
        },
      ];

      // First SET_ITEMS with queryKey1
      const queryKey1 = createTestQueryKey("query-key-1");
      const queryKey1String = queryKey1.toKey();
      const queryKey2 = createTestQueryKey("query-key-2");
      const queryKey2String = queryKey2.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items: initialItems,
          queryKey: queryKey1,
        });
      });

      // Verify initial state
      let state = store.get(collection.stateAtom) as CollectionState<TestItem>;
      expect(state.items.size()).toBe(2);
      expect(state.items.getByStorageId("item-1")?.data.name).toBe(
        "Original Name 1"
      );
      expect(state.items.getByStorageId("item-1")?.queryKeys).toEqual([
        queryKey1String,
      ]);

      // Updated items with fresh data from API
      const updatedItems: CollectionItem<TestItem>[] = [
        {
          id: "item-1",
          data: {
            id: "item-1",
            name: "Updated Name 1",
            updatedAt: "2024-01-02",
          },
          lastFetched: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02",
          queryKeys: [], // Will be merged with existing
        },
        {
          id: "item-2",
          data: {
            id: "item-2",
            name: "Updated Name 2",
            updatedAt: "2024-01-02",
          },
          lastFetched: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02",
          queryKeys: [], // Will be merged with existing
        },
      ];

      // Second SET_ITEMS with fresh data and queryKey2
      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items: updatedItems,
          queryKey: queryKey2,
        });
      });

      // Verify final state - this should fail due to SET_ITEMS bug
      state = store.get(collection.stateAtom) as CollectionState<TestItem>;

      // Should have fresh data from updatedItems, not original data
      expect(state.items.getByStorageId("item-1")?.data.name).toBe(
        "Updated Name 1"
      ); // Should show updated name
      expect(state.items.getByStorageId("item-1")?.data.updatedAt).toBe(
        "2024-01-02"
      ); // Should show updated timestamp
      expect(state.items.getByStorageId("item-1")?.lastFetched).toBe(
        "2024-01-02T00:00:00Z"
      ); // Should show updated fetch time

      // Should preserve queryKeys from both operations
      expect(state.items.getByStorageId("item-1")?.queryKeys).toEqual([
        queryKey1String,
        queryKey2String,
      ]);

      // Same for second item
      expect(state.items.getByStorageId("item-2")?.data.name).toBe(
        "Updated Name 2"
      );
      expect(state.items.getByStorageId("item-2")?.queryKeys).toEqual([
        queryKey1String,
        queryKey2String,
      ]);
    });
  });

  describe("Empty list freshness", () => {
    it("stamps listFetchTimes for an empty SET_ITEMS result", () => {
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: async () => ({ data: [], isArray: true }),
      });

      const queryKey = createTestQueryKey("empty-list");
      const queryKeyString = queryKey.toKey();

      act(() => {
        store.set(collection.actionsAtom, {
          type: "SET_ITEMS",
          items: [],
          queryKey,
        });
      });

      const state = store.get(collection.stateAtom);
      expect(state.listQueries.hasByKeyString(queryKeyString)).toBe(true);
      expect(state.listQueries.getByKeyString(queryKeyString)).toEqual([]);
      expect(state.listFetchTimes?.get(queryKeyString)).toEqual(
        expect.any(String)
      );
    });

    it("does not refetch an empty list result while it is fresh", async () => {
      // Regression: a list query that legitimately returns zero items used to
      // fall through the freshness check (no representative item) and refetch on
      // every pass. It must now be treated as fresh off its own fetch time.
      const mockFetcher = vi.fn(async () => ({
        data: [] as TestItem[],
        isArray: true as const,
      }));
      const collection = createCollection<TestItem>({
        name: "test",
        fetcher: mockFetcher,
        staleTimeMs: 30000,
      });

      const queryKey = createTestQueryKey("empty-list");

      await act(async () => {
        await store.set(collection.actionsAtom, {
          type: "FETCH_QUERY",
          queryKey,
        });
      });

      // Second fetch lands while the empty result is still fresh — must skip the
      // network entirely rather than refetching forever.
      await act(async () => {
        await store.set(collection.actionsAtom, {
          type: "FETCH_QUERY",
          queryKey,
        });
      });

      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe("Async Actions Integration", () => {
    it("should handle async action types correctly", () => {
      // Test that the new async action types are recognized
      const fetchAction: CollectionAction<TestItem> = {
        type: "FETCH_QUERY",
        queryKey: createTestQueryKey("test-query"),
      };

      const refetchAction: CollectionAction<TestItem> = {
        type: "REFETCH_QUERY",
        queryKey: createTestQueryKey("test-query"),
        signal: new AbortController().signal,
      };

      const batchAction: CollectionAction<TestItem> = {
        type: "BATCH_REFETCH",
        queryKeys: [createTestQueryKey("query1"), createTestQueryKey("query2")],
      };

      // These should compile without TypeScript errors
      expect(fetchAction.type).toBe("FETCH_QUERY");
      expect(refetchAction.type).toBe("REFETCH_QUERY");
      expect(batchAction.type).toBe("BATCH_REFETCH");
    });

    it("should define state update action types correctly", () => {
      const successAction: CollectionAction<TestItem> = {
        type: "SET_FETCH_SUCCESS",
        queryKey: createTestQueryKey("test-query"),
      };

      const errorAction: CollectionAction<TestItem> = {
        type: "SET_FETCH_ERROR",
        queryKey: createTestQueryKey("test-query"),
        error: new Error("Test error"),
      };

      expect(successAction.type).toBe("SET_FETCH_SUCCESS");
      expect(errorAction.type).toBe("SET_FETCH_ERROR");
    });

    it("should support DispatchFunction type with async return", () => {
      const asyncDispatch = async (action: CollectionAction<TestItem>) => {
        if (action.type === "FETCH_QUERY") {
          return { id: "1", name: "test", updatedAt: "2024-01-01" };
        }
        return null;
      };

      // Test both sync and async dispatch
      const syncDispatch = (action: CollectionAction<TestItem>) => {
        console.log("Sync action:", action.type);
      };

      // Both should be valid DispatchFunction implementations
      expect(typeof asyncDispatch).toBe("function");
      expect(typeof syncDispatch).toBe("function");
    });
  });
});
