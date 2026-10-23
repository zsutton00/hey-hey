import {
  addQueryKeyToItem,
  removeQueryKeyFromItem,
  hasQueryKey,
  mergeQueryKeys,
  findItemsByQueryKeyPattern,
  getAllQueryKeys,
  removeQueryKeyFromAllItems,
  mergeItemWithFreshData,
} from "../queryKeyUtils";
import { CollectionMap } from "../CollectionMap";
import type { CollectionItem } from "../types";

interface TestData {
  id: string;
  name: string;
}

const createMockItem = (
  id: string,
  name: string,
  queryKeys: string[] = []
): CollectionItem<TestData> => ({
  id,
  data: { id, name },
  updatedAt: "2024-01-01T00:00:00Z",
  lastFetched: "2024-01-01T00:00:00Z",
  queryKeys,
});

describe("queryKeyUtils", () => {
  describe("addQueryKeyToItem", () => {
    it("should add queryKey to empty queryKeys array", () => {
      const item = createMockItem("1", "Test", []);
      const result = addQueryKeyToItem(item, "test-query");

      expect(result.queryKeys).toEqual(["test-query"]);
      expect(result.id).toBe("1");
      expect(result.data).toEqual({ id: "1", name: "Test" });
    });

    it("should add queryKey to existing queryKeys array", () => {
      const item = createMockItem("1", "Test", ["existing-query"]);
      const result = addQueryKeyToItem(item, "new-query");

      expect(result.queryKeys).toEqual(["existing-query", "new-query"]);
    });

    it("should not duplicate existing queryKeys", () => {
      const item = createMockItem("1", "Test", ["existing-query"]);
      const result = addQueryKeyToItem(item, "existing-query");

      expect(result.queryKeys).toEqual(["existing-query"]);
      expect(result).toBe(item); // Should return same reference
    });

    it("should handle undefined queryKeys gracefully", () => {
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      } as CollectionItem<TestData>;

      const result = addQueryKeyToItem(itemWithoutQueryKeys, "test-query");

      expect(result.queryKeys).toEqual(["test-query"]);
    });

    it("should handle empty queryKey", () => {
      const item = createMockItem("1", "Test", ["existing"]);
      const result = addQueryKeyToItem(item, "");

      expect(result).toBe(item); // Should return same reference
    });

    it("should preserve all other item properties", () => {
      const item = createMockItem("1", "Test", []);
      const result = addQueryKeyToItem(item, "test-query");

      expect(result.id).toBe(item.id);
      expect(result.data).toBe(item.data);
      expect(result.updatedAt).toBe(item.updatedAt);
      expect(result.lastFetched).toBe(item.lastFetched);
    });
  });

  describe("removeQueryKeyFromItem", () => {
    it("should remove existing queryKey", () => {
      const item = createMockItem("1", "Test", ["query1", "query2", "query3"]);
      const result = removeQueryKeyFromItem(item, "query2");

      expect(result.queryKeys).toEqual(["query1", "query3"]);
    });

    it("should ignore non-existent queryKey", () => {
      const item = createMockItem("1", "Test", ["query1", "query2"]);
      const result = removeQueryKeyFromItem(item, "non-existent");

      expect(result).toBe(item); // Should return same reference
      expect(result.queryKeys).toEqual(["query1", "query2"]);
    });

    it("should preserve other queryKeys", () => {
      const item = createMockItem("1", "Test", ["keep1", "remove", "keep2"]);
      const result = removeQueryKeyFromItem(item, "remove");

      expect(result.queryKeys).toEqual(["keep1", "keep2"]);
    });

    it("should handle item without queryKeys", () => {
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      } as CollectionItem<TestData>;

      const result = removeQueryKeyFromItem(itemWithoutQueryKeys, "test-query");

      expect(result).toBe(itemWithoutQueryKeys);
    });

    it("should handle empty queryKey", () => {
      const item = createMockItem("1", "Test", ["existing"]);
      const result = removeQueryKeyFromItem(item, "");

      expect(result).toBe(item);
    });
  });

  describe("hasQueryKey", () => {
    it("should return true for existing queryKey", () => {
      const item = createMockItem("1", "Test", ["query1", "query2"]);

      expect(hasQueryKey(item, "query1")).toBe(true);
      expect(hasQueryKey(item, "query2")).toBe(true);
    });

    it("should return false for non-existent queryKey", () => {
      const item = createMockItem("1", "Test", ["query1", "query2"]);

      expect(hasQueryKey(item, "non-existent")).toBe(false);
    });

    it("should return false for item without queryKeys", () => {
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      } as CollectionItem<TestData>;

      expect(hasQueryKey(itemWithoutQueryKeys, "test-query")).toBe(false);
    });

    it("should return false for empty queryKey", () => {
      const item = createMockItem("1", "Test", ["existing"]);

      expect(hasQueryKey(item, "")).toBe(false);
    });
  });

  describe("mergeQueryKeys", () => {
    it("should merge arrays without duplicates", () => {
      const existing = ["query1", "query2"];
      const newKeys = ["query2", "query3", "query4"];

      const result = mergeQueryKeys(existing, newKeys);

      expect(result).toEqual(["query1", "query2", "query3", "query4"]);
    });

    it("should handle empty existing array", () => {
      const existing: string[] = [];
      const newKeys = ["query1", "query2"];

      const result = mergeQueryKeys(existing, newKeys);

      expect(result).toEqual(["query1", "query2"]);
    });

    it("should handle empty new keys array", () => {
      const existing = ["query1", "query2"];
      const newKeys: string[] = [];

      const result = mergeQueryKeys(existing, newKeys);

      expect(result).toEqual(["query1", "query2"]);
    });

    it("should maintain order (new keys last)", () => {
      const existing = ["a", "b"];
      const newKeys = ["c", "a", "d"];

      const result = mergeQueryKeys(existing, newKeys);

      expect(result).toEqual(["a", "b", "c", "d"]);
    });

    it("should handle both arrays empty", () => {
      const result = mergeQueryKeys([], []);

      expect(result).toEqual([]);
    });
  });

  describe("findItemsByQueryKeyPattern", () => {
    const items = new CollectionMap([
      [
        "1",
        createMockItem("1", "Item1", ["conversations:org1:proj1", "single:1"]),
      ],
      [
        "2",
        createMockItem("2", "Item2", ["conversations:org1:proj2", "single:2"]),
      ],
      [
        "3",
        createMockItem("3", "Item3", [
          "projects:org1",
          "conversations:org1:proj1",
        ]),
      ],
    ]);

    it("should find items by exact queryKey match", () => {
      const result = findItemsByQueryKeyPattern(
        items,
        "conversations:org1:proj1"
      );

      expect(result).toHaveLength(2);
      expect(result.map((item) => item.id)).toContain("1");
      expect(result.map((item) => item.id)).toContain("3");
    });

    it("should find items by regex pattern", () => {
      const pattern = /^conversations:org1:/;
      const result = findItemsByQueryKeyPattern(items, pattern);

      expect(result).toHaveLength(3);
      expect(result.map((item) => item.id)).toContain("1");
      expect(result.map((item) => item.id)).toContain("2");
      expect(result.map((item) => item.id)).toContain("3");
    });

    it("should return empty array when no matches", () => {
      const result = findItemsByQueryKeyPattern(items, "non-existent");

      expect(result).toEqual([]);
    });

    it("should handle regex pattern with no matches", () => {
      const pattern = /^nomatch:/;
      const result = findItemsByQueryKeyPattern(items, pattern);

      expect(result).toEqual([]);
    });

    it("should handle empty items map", () => {
      const emptyItems = new Map<string, CollectionItem<TestData>>();
      const result = findItemsByQueryKeyPattern(emptyItems, "any-query");

      expect(result).toEqual([]);
    });
  });

  describe("getAllQueryKeys", () => {
    it("should return all unique query keys", () => {
      const items = new CollectionMap([
        ["1", createMockItem("1", "Item1", ["query1", "query2"])],
        ["2", createMockItem("2", "Item2", ["query2", "query3"])],
        ["3", createMockItem("3", "Item3", ["query3", "query4"])],
      ]);

      const result = getAllQueryKeys(items);

      expect(result.sort()).toEqual(["query1", "query2", "query3", "query4"]);
    });

    it("should handle items without queryKeys", () => {
      const itemWithoutQueryKeys = {
        id: "1",
        data: { id: "1", name: "Test" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      } as CollectionItem<TestData>;

      const items = new CollectionMap([
        ["1", itemWithoutQueryKeys],
        ["2", createMockItem("2", "Item2", ["query1", "query2"])],
      ]);

      const result = getAllQueryKeys(items);

      expect(result.sort()).toEqual(["query1", "query2"]);
    });

    it("should handle empty items map", () => {
      const emptyItems = new Map<string, CollectionItem<TestData>>();
      const result = getAllQueryKeys(emptyItems);

      expect(result).toEqual([]);
    });
  });

  describe("removeQueryKeyFromAllItems", () => {
    it("should remove queryKey from all items that have it", () => {
      const items = new CollectionMap([
        ["1", createMockItem("1", "Item1", ["query1", "remove", "query2"])],
        ["2", createMockItem("2", "Item2", ["query3", "remove"])],
        ["3", createMockItem("3", "Item3", ["query4", "query5"])],
      ]);

      const result = removeQueryKeyFromAllItems(items, "remove");

      expect(result.getByStorageId("1")?.queryKeys).toEqual([
        "query1",
        "query2",
      ]);
      expect(result.getByStorageId("2")?.queryKeys).toEqual(["query3"]);
      expect(result.getByStorageId("3")?.queryKeys).toEqual([
        "query4",
        "query5",
      ]);
    });

    it("should not affect items without the queryKey", () => {
      const items = new CollectionMap([
        ["1", createMockItem("1", "Item1", ["query1", "query2"])],
        ["2", createMockItem("2", "Item2", ["query3", "query4"])],
      ]);

      const result = removeQueryKeyFromAllItems(items, "non-existent");

      // Items should be the same reference since no changes were made
      expect(result.getByStorageId("1")).toBe(items.getByStorageId("1"));
      expect(result.getByStorageId("2")).toBe(items.getByStorageId("2"));
    });

    it("should handle empty items map", () => {
      const emptyItems = new CollectionMap<TestData>();
      const result = removeQueryKeyFromAllItems(emptyItems, "any-query");

      expect(result.size()).toBe(0);
    });

    it("should return new map instance", () => {
      const items = new CollectionMap([
        ["1", createMockItem("1", "Item1", ["query1"])],
      ]);

      const result = removeQueryKeyFromAllItems(items, "query1");

      expect(result).not.toBe(items);
      expect(result instanceof CollectionMap).toBe(true);
    });
  });

  describe("mergeItemWithFreshData", () => {
    it("should use fresh data while preserving existing queryKeys", () => {
      const existingItem = createMockItem("1", "Old Name", ["existing-query"]);
      const freshData = {
        id: "1",
        data: { id: "1", name: "Fresh Name" },
        updatedAt: "2024-01-02T00:00:00Z",
        lastFetched: "2024-01-02T00:00:00Z",
        queryKeys: [],
      };

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "new-query"
      );

      // Should use fresh data
      expect(result.data.name).toBe("Fresh Name");
      expect(result.updatedAt).toBe("2024-01-02T00:00:00Z");
      expect(result.lastFetched).toBe("2024-01-02T00:00:00Z");

      // Should preserve existing queryKeys and add new one
      expect(result.queryKeys).toEqual(["existing-query", "new-query"]);
    });

    it("should preserve fuller fields omitted by a later lighter read", () => {
      interface RichTestData extends TestData {
        edges?: string[];
      }

      const existingItem: CollectionItem<RichTestData> = {
        ...createMockItem("1", "Full Name", ["plan-query"]),
        data: {
          id: "1",
          name: "Full Name",
          edges: ["dependency-edge"],
        },
      };
      const freshData: CollectionItem<RichTestData> = {
        ...createMockItem("1", "Updated Name"),
        data: {
          id: "1",
          name: "Updated Name",
        },
      };

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "plan-query"
      );

      expect(result.data.name).toBe("Updated Name");
      expect(result.data.edges).toEqual(["dependency-edge"]);
    });

    it("should merge queryKeys from both items and avoid duplicates", () => {
      const existingItem = createMockItem("1", "Old", ["query1", "query2"]);
      const freshData = createMockItem("1", "Fresh", ["query2", "query3"]);

      const result = mergeItemWithFreshData(existingItem, freshData, "query4");

      expect(result.data.name).toBe("Fresh");
      expect(result.queryKeys).toEqual([
        "query1",
        "query2",
        "query3",
        "query4",
      ]);
    });

    it("should handle existing item with no queryKeys", () => {
      const existingItem = {
        id: "1",
        data: { id: "1", name: "Old" },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
      } as CollectionItem<TestData>;

      const freshData = createMockItem("1", "Fresh", ["fresh-query"]);

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "new-query"
      );

      expect(result.data.name).toBe("Fresh");
      expect(result.queryKeys).toEqual(["fresh-query", "new-query"]);
    });

    it("should handle fresh data with no queryKeys", () => {
      const existingItem = createMockItem("1", "Old", ["existing-query"]);
      const freshData = {
        id: "1",
        data: { id: "1", name: "Fresh" },
        updatedAt: "2024-01-02T00:00:00Z",
        lastFetched: "2024-01-02T00:00:00Z",
      } as CollectionItem<TestData>;

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "new-query"
      );

      expect(result.data.name).toBe("Fresh");
      expect(result.queryKeys).toEqual(["existing-query", "new-query"]);
    });

    it("should avoid duplicate queryKeys when merging", () => {
      const existingItem = createMockItem("1", "Old", ["duplicate", "unique1"]);
      const freshData = createMockItem("1", "Fresh", ["duplicate", "unique2"]);

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "duplicate"
      );

      expect(result.queryKeys).toEqual(["duplicate", "unique1", "unique2"]);
    });

    it("should handle empty queryKey gracefully", () => {
      const existingItem = createMockItem("1", "Old", ["existing"]);
      const freshData = createMockItem("1", "Fresh", ["fresh"]);

      const result = mergeItemWithFreshData(existingItem, freshData, "");

      expect(result).toBe(freshData); // Should just return fresh data
    });

    it("should preserve all fresh data properties", () => {
      const existingItem = createMockItem("1", "Old", ["old-query"]);
      const freshData = {
        id: "1",
        data: { id: "1", name: "Fresh Data" },
        updatedAt: "2024-01-02T12:00:00Z",
        lastFetched: "2024-01-02T12:30:00Z",
        queryKeys: ["fresh-query"],
      };

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "new-query"
      );

      // All fresh data should be preserved
      expect(result.id).toBe(freshData.id);
      expect(result.data).toBe(freshData.data);
      expect(result.updatedAt).toBe(freshData.updatedAt);
      expect(result.lastFetched).toBe(freshData.lastFetched);

      // QueryKeys should be merged
      expect(result.queryKeys).toEqual([
        "old-query",
        "fresh-query",
        "new-query",
      ]);
    });

    it("should handle complex data updates", () => {
      interface ComplexData {
        id: string;
        name: string;
        status: string;
        metadata: { version: number; tags: string[] };
      }

      const existingItem: CollectionItem<ComplexData> = {
        id: "complex-1",
        data: {
          id: "complex-1",
          name: "Old Item",
          status: "STARTED",
          metadata: { version: 1, tags: ["old"] },
        },
        updatedAt: "2024-01-01T00:00:00Z",
        lastFetched: "2024-01-01T00:00:00Z",
        queryKeys: ["list-query"],
      };

      const freshData: CollectionItem<ComplexData> = {
        id: "complex-1",
        data: {
          id: "complex-1",
          name: "Updated Item",
          status: "COMPLETED",
          metadata: { version: 2, tags: ["new", "updated"] },
        },
        updatedAt: "2024-01-02T00:00:00Z",
        lastFetched: "2024-01-02T00:00:00Z",
        queryKeys: [],
      };

      const result = mergeItemWithFreshData(
        existingItem,
        freshData,
        "refetch-query"
      );

      // All fresh data properties should be used
      expect(result.data.name).toBe("Updated Item");
      expect(result.data.status).toBe("COMPLETED");
      expect(result.data.metadata.version).toBe(2);
      expect(result.data.metadata.tags).toEqual(["new", "updated"]);
      expect(result.updatedAt).toBe("2024-01-02T00:00:00Z");
      expect(result.lastFetched).toBe("2024-01-02T00:00:00Z");

      // QueryKeys should be preserved and extended
      expect(result.queryKeys).toEqual(["list-query", "refetch-query"]);
    });
  });
});
