import { describe, it, expect, vi } from "vitest";
import {
  wrapSingleItem,
  wrapArrayItems,
  shouldSkipFetchForQuery,
  createErrorState,
  createLoadingState,
  createSuccessState,
} from "../fetchUtils";
import type { CollectionState, CollectionItem } from "../types";
import type { StaleTimeConfig } from "../staleTime";

// Mock the staleTime freshness helpers
vi.mock("../staleTime", async (importOriginal) => ({
  ...await importOriginal<typeof import("../staleTime")>(),
  shouldSkipFetch: vi.fn(),
  shouldSkipFetchForTimestamp: vi.fn(),
}));

import { shouldSkipFetch, shouldSkipFetchForTimestamp } from "../staleTime";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import { QueryKey, QueryKeyField } from "../QueryKey";
const mockShouldSkipFetch = shouldSkipFetch as vi.MockedFunction<
  typeof shouldSkipFetch
>;
const mockShouldSkipFetchForTimestamp =
  shouldSkipFetchForTimestamp as vi.MockedFunction<
    typeof shouldSkipFetchForTimestamp
  >;

type TestQueryFields = {
  key: QueryKeyField<string>;
};

class TestQueryKey extends QueryKey<TestQueryFields> {
  constructor(key: string) {
    super({ key: new QueryKeyField("key", key) });
  }
}

const createTestQueryKey = (key: string) => new TestQueryKey(key);

describe("fetchUtils", () => {
  describe("wrapSingleItem", () => {
    it("should wrap a single item with metadata", () => {
      const data = { id: "1", name: "Test", updatedAt: "2024-01-01T00:00:00Z" };
      const wrapped = wrapSingleItem(data, "test-query");

      expect(wrapped).toEqual({
        id: "1",
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: expect.any(String),
        data,
        queryKeys: ["test-query"],
        fetchedCount: 1,
      });
      expect(new Date(wrapped.lastFetched).getTime()).toBeGreaterThan(
        Date.now() - 1000
      );
    });

    it("should use provided timestamp", () => {
      const data = { id: "1", name: "Test" };
      const now = "2024-01-15T10:00:00Z";
      const wrapped = wrapSingleItem(data, "test-query", now);

      expect(wrapped.lastFetched).toBe(now);
      expect(wrapped.updatedAt).toBe(now);
    });

    it("should handle items without updatedAt field", () => {
      const data = { id: "2", name: "No UpdatedAt" };
      const now = "2024-01-15T10:00:00Z";
      const wrapped = wrapSingleItem(data, "test-query", now);

      expect(wrapped.updatedAt).toBe(now);
    });

    it("should handle items with existing updatedAt field", () => {
      const data = {
        id: "3",
        name: "Has UpdatedAt",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      const now = "2024-01-15T10:00:00Z";
      const wrapped = wrapSingleItem(data, "test-query", now);

      expect(wrapped.updatedAt).toBe("2024-01-01T00:00:00Z");
    });

    it("should gracefully handle null data responses", () => {
      const now = "2024-01-15T10:00:00Z";
      const wrapped = wrapSingleItem(
        null as unknown as { id: string },
        "test-query",
        now
      );

      expect(wrapped.id).toBe("test-query");
      expect(wrapped.updatedAt).toBe(now);
      expect(wrapped.lastFetched).toBe(now);
      expect(wrapped.data).toBeNull();
      expect(wrapped.queryKeys).toEqual(["test-query"]);
      expect(wrapped.fetchedCount).toBe(1);
    });
  });

  describe("wrapArrayItems", () => {
    it("should wrap multiple items with metadata", () => {
      const data = [
        { id: "1", name: "First" },
        { id: "2", name: "Second" },
      ];
      const wrapped = wrapArrayItems(data, "test-query");

      expect(wrapped).toHaveLength(2);
      expect(wrapped[0]).toEqual({
        id: "1",
        updatedAt: expect.any(String),
        lastFetched: expect.any(String),
        data: data[0],
        queryKeys: ["test-query"],
        fetchedCount: 1,
      });
      expect(wrapped[1]).toEqual({
        id: "2",
        updatedAt: expect.any(String),
        lastFetched: expect.any(String),
        data: data[1],
        queryKeys: ["test-query"],
        fetchedCount: 1,
      });
    });

    it("should handle empty array", () => {
      const wrapped = wrapArrayItems([], "test-query");
      expect(wrapped).toEqual([]);
    });

    it("should use provided timestamp for all items", () => {
      const data = [
        { id: "1", name: "First" },
        { id: "2", name: "Second" },
      ];
      const now = "2024-01-15T10:00:00Z";
      const wrapped = wrapArrayItems(data, "test-query", now);

      expect(wrapped[0].lastFetched).toBe(now);
      expect(wrapped[1].lastFetched).toBe(now);
    });
  });

  describe("shouldSkipFetchForQuery", () => {
    const mockStaleTimeConfig: StaleTimeConfig = { staleTimeMs: 30000 };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should not skip if marked stale", () => {
      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();
      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(),
        singleQueries: new Map(),
        stale: new Set([queryKeyString]),
        loading: new Set(),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(false);
      expect(mockShouldSkipFetch).not.toHaveBeenCalled();
    });

    it("should skip if data is fresh and not stale (single query)", () => {
      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();
      const now = new Date().toISOString();
      const item: CollectionItem<unknown> = {
        id: "1",
        lastFetched: now,
        updatedAt: now,
        data: { id: "1", name: "Test" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap([["1", item]]),
        listQueries: new ListQueryMap(),
        singleQueries: new Map([[queryKeyString, "1"]]),
        stale: new Set(),
        loading: new Set(),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      mockShouldSkipFetch.mockReturnValue(true);

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(true);
      expect(result.data).toBe(item.data);
      expect(mockShouldSkipFetch).toHaveBeenCalledWith(
        item,
        mockStaleTimeConfig
      );
    });

    it("should not skip if data is stale", () => {
      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();
      const now = new Date().toISOString();
      const item: CollectionItem<unknown> = {
        id: "1",
        lastFetched: now,
        updatedAt: now,
        data: { id: "1", name: "Test" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap([["1", item]]),
        listQueries: new ListQueryMap(),
        singleQueries: new Map([[queryKeyString, "1"]]),
        stale: new Set(),
        loading: new Set(),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      mockShouldSkipFetch.mockReturnValue(false);

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(false);
      expect(result.data).toBeUndefined();
    });

    it("should handle missing item", () => {
      const queryKey = createTestQueryKey("test-query");
      const state: CollectionState<unknown> = {
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

      mockShouldSkipFetch.mockReturnValue(false);

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(false);
      expect(result.data).toBeUndefined();
      expect(mockShouldSkipFetch).not.toHaveBeenCalled();
    });

    it("should skip and return list data if fresh (list query)", () => {
      const queryKey = createTestQueryKey("list-query");
      const queryKeyString = queryKey.toKey();
      const now = new Date().toISOString();
      const item1: CollectionItem<unknown> = {
        id: "1",
        lastFetched: now,
        updatedAt: now,
        data: { id: "1", name: "First" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };
      const item2: CollectionItem<unknown> = {
        id: "2",
        lastFetched: now,
        updatedAt: now,
        data: { id: "2", name: "Second" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      const fetchedAt = now;
      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap([
          ["1", item1],
          ["2", item2],
        ]),
        listQueries: new ListQueryMap(new Map([[queryKeyString, ["1", "2"]]])),
        listFetchTimes: new Map([[queryKeyString, fetchedAt]]),
        singleQueries: new Map(),
        stale: new Set(),
        loading: new Set(),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      mockShouldSkipFetchForTimestamp.mockReturnValue(true);

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(true);
      expect(result.data).toEqual([
        { id: "1", name: "First" },
        { id: "2", name: "Second" },
      ]);
      expect(mockShouldSkipFetchForTimestamp).toHaveBeenCalledWith(
        fetchedAt,
        mockStaleTimeConfig
      );
    });

    it("should skip an empty list query when its fetch time is fresh", () => {
      // Regression: a list that legitimately returned zero items must be treated
      // as fresh off its own stamped fetch time, not refetch forever for lack of
      // a representative item.
      const queryKey = createTestQueryKey("empty-list-query");
      const queryKeyString = queryKey.toKey();
      const fetchedAt = new Date().toISOString();

      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(new Map([[queryKeyString, []]])),
        listFetchTimes: new Map([[queryKeyString, fetchedAt]]),
        singleQueries: new Map(),
        stale: new Set(),
        loading: new Set(),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      mockShouldSkipFetchForTimestamp.mockReturnValue(true);

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(true);
      expect(result.data).toEqual([]);
      expect(mockShouldSkipFetchForTimestamp).toHaveBeenCalledWith(
        fetchedAt,
        mockStaleTimeConfig
      );
    });

    it("should not skip an empty list query once its fetch time is stale", () => {
      const queryKey = createTestQueryKey("empty-list-query");
      const queryKeyString = queryKey.toKey();

      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(new Map([[queryKeyString, []]])),
        listFetchTimes: new Map([[queryKeyString, "2000-01-01T00:00:00Z"]]),
        singleQueries: new Map(),
        stale: new Set(),
        loading: new Set(),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      mockShouldSkipFetchForTimestamp.mockReturnValue(false);

      const result = shouldSkipFetchForQuery(
        queryKey,
        state,
        mockStaleTimeConfig
      );
      expect(result.skip).toBe(false);
      expect(result.data).toBeUndefined();
    });
  });

  describe("createErrorState", () => {
    it("should create proper error state update", () => {
      const error = new Error("Test error");
      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(),
        singleQueries: new Map(),
        stale: new Set(),
        loading: new Set(["test-query", "other-query"]),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      const result = createErrorState(state, "test-query", error);

      expect(result.loading?.has("test-query")).toBe(false);
      expect(result.loading?.has("other-query")).toBe(true);
      expect(result.errors?.get("test-query")).toBe(error);
      expect(result.fetched?.has("test-query")).toBe(true);
    });
  });

  describe("createLoadingState", () => {
    it("should add query to loading when isLoading is true", () => {
      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(),
        singleQueries: new Map(),
        stale: new Set(),
        loading: new Set(["other-query"]),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      const result = createLoadingState(state, "test-query", true);

      expect(result.loading?.has("test-query")).toBe(true);
      expect(result.loading?.has("other-query")).toBe(true);
    });

    it("should remove query from loading when isLoading is false", () => {
      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(),
        singleQueries: new Map(),
        stale: new Set(),
        loading: new Set(["test-query", "other-query"]),
        fetched: new Set(),
        errors: new Map(),
        optimisticUpdates: new Map(),
      };

      const result = createLoadingState(state, "test-query", false);

      expect(result.loading?.has("test-query")).toBe(false);
      expect(result.loading?.has("other-query")).toBe(true);
    });
  });

  describe("createSuccessState", () => {
    it("should create proper success state update", () => {
      const error = new Error("Test error");
      const state: CollectionState<unknown> = {
      staleTimeMs: 300_000,
        items: new CollectionMap(),
        listQueries: new ListQueryMap(),
        singleQueries: new Map(),
        stale: new Set(["test-query", "other-query"]),
        loading: new Set(["test-query", "other-query"]),
        fetched: new Set(),
        errors: new Map([["test-query", error]]),
        optimisticUpdates: new Map(),
      };

      const result = createSuccessState(state, "test-query");

      expect(result.loading?.has("test-query")).toBe(false);
      expect(result.loading?.has("other-query")).toBe(true);
      expect(result.fetched?.has("test-query")).toBe(true);
      expect(result.stale?.has("test-query")).toBe(false);
      expect(result.stale?.has("other-query")).toBe(true);
      expect(result.errors?.has("test-query")).toBe(false);
    });
  });
});
