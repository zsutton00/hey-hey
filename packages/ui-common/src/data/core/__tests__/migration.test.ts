import {
  ensureQueryKeys,
  ensureQueryKeysForItems,
  hasQueryKeysField,
} from "../migration";
import type { CollectionItem } from "../types";
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

describe("migration utilities", () => {
  describe("ensureQueryKeys", () => {
    it("should add queryKeys field when missing", () => {
      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      };

      const result = ensureQueryKeys(itemWithoutQueryKeys, queryKey);

      expect(result.queryKeys).toEqual([queryKeyString]);
      expect(result.id).toBe("1");
      expect(result.data).toEqual({ id: "1", name: "Test" });
    });

    it("should preserve existing queryKeys field", () => {
      const newQueryKey = createTestQueryKey("new-query");
      const itemWithQueryKeys: CollectionItem<TestData> = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
        queryKeys: ["existing-query"],
      };

      const result = ensureQueryKeys(itemWithQueryKeys, newQueryKey);

      expect(result.queryKeys).toEqual(["existing-query"]);
      expect(result).toBe(itemWithQueryKeys); // Should return same reference
    });

    it("should handle missing queryKey parameter", () => {
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      };

      const result = ensureQueryKeys(itemWithoutQueryKeys);

      expect(result.queryKeys).toEqual([]);
    });

    it("should handle item with empty queryKeys array", () => {
      const queryKey = createTestQueryKey("test-query");
      const itemWithEmptyQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
        queryKeys: [] as string[],
      };

      const result = ensureQueryKeys(itemWithEmptyQueryKeys, queryKey);

      expect(result.queryKeys).toEqual([]);
      expect(result).toBe(itemWithEmptyQueryKeys);
    });
  });

  describe("ensureQueryKeysForItems", () => {
    it("should add queryKeys to all items in array", () => {
      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();
      const itemsWithoutQueryKeys = [
        {
          id: "1",
          data: { id: "1", name: "Item1" },
          updatedAt: "2024-01-01T00:00:00Z",
          lastFetched: "2024-01-01T00:00:00Z",
        },
        {
          id: "2",
          data: { id: "2", name: "Item2" },
          updatedAt: "2024-01-02T00:00:00Z",
          lastFetched: "2024-01-02T00:00:00Z",
        },
      ];

      const result = ensureQueryKeysForItems(itemsWithoutQueryKeys, queryKey);

      expect(result).toHaveLength(2);
      expect(result[0].queryKeys).toEqual([queryKeyString]);
      expect(result[1].queryKeys).toEqual([queryKeyString]);
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("2");
    });

    it("should handle mixed items (some with, some without queryKeys)", () => {
      const queryKey = createTestQueryKey("test-query");
      const queryKeyString = queryKey.toKey();
      const mixedItems = [
        {
          id: "1",
          data: { id: "1", name: "Item1" },
          updatedAt: "2024-01-01T00:00:00Z",
          lastFetched: "2024-01-01T00:00:00Z",
        },
        {
          id: "2",
          data: { id: "2", name: "Item2" },
          updatedAt: "2024-01-02T00:00:00Z",
          lastFetched: "2024-01-02T00:00:00Z",
          queryKeys: ["existing-query"],
        },
      ];

      const result = ensureQueryKeysForItems(mixedItems, queryKey);

      expect(result).toHaveLength(2);
      expect(result[0].queryKeys).toEqual([queryKeyString]);
      expect(result[1].queryKeys).toEqual(["existing-query"]);
    });

    it("should handle empty array", () => {
      const emptyArray: Array<
        Partial<CollectionItem<TestData>> &
          Pick<
            CollectionItem<TestData>,
            "id" | "data" | "updatedAt" | "lastFetched"
          >
      > = [];

      const result = ensureQueryKeysForItems(
        emptyArray,
        createTestQueryKey("test-query")
      );

      expect(result).toEqual([]);
    });

    it("should work without queryKey parameter", () => {
      const itemsWithoutQueryKeys = [
        {
          id: "1",
          data: { id: "1", name: "Item1" },
          updatedAt: "2024-01-01T00:00:00Z",
          lastFetched: "2024-01-01T00:00:00Z",
        },
      ];

      const result = ensureQueryKeysForItems(itemsWithoutQueryKeys);

      expect(result[0].queryKeys).toEqual([]);
    });
  });

  describe("hasQueryKeysField", () => {
    it("should return true for item with queryKeys", () => {
      const itemWithQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
        queryKeys: ["test-query"],
      };

      expect(hasQueryKeysField(itemWithQueryKeys)).toBe(true);
    });

    it("should return false for item without queryKeys", () => {
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      };

      expect(hasQueryKeysField(itemWithoutQueryKeys)).toBe(false);
    });

    it("should return false for item with non-array queryKeys", () => {
      const itemWithInvalidQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
        queryKeys: "not-an-array",
      };

      expect(hasQueryKeysField(itemWithInvalidQueryKeys)).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(hasQueryKeysField(null)).toBe(false);
      expect(hasQueryKeysField(undefined)).toBe(false);
    });

    it("should return false for primitive values", () => {
      expect(hasQueryKeysField("string")).toBe(false);
      expect(hasQueryKeysField(123)).toBe(false);
      expect(hasQueryKeysField(true)).toBe(false);
    });

    it("should return true for item with empty queryKeys array", () => {
      const itemWithEmptyQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
        queryKeys: [],
      };

      expect(hasQueryKeysField(itemWithEmptyQueryKeys)).toBe(true);
    });
  });
});
