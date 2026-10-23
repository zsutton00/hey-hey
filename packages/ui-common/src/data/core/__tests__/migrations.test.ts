/**
 * Phase 5.3: Migration Tests
 *
 * Comprehensive test suite for queryKeys migration utilities as specified in QUERY_KEYS.MD.
 * Tests all migration scenarios including edge cases and data preservation.
 */

import {
  ensureQueryKeys,
  ensureQueryKeysForItems,
  migrateCollectionState,
  validateCollectionState,
  performRuntimeMigration,
  hasQueryKeysField,
  inspectCollectionMigrationState,
} from "../migration";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import type { CollectionItem } from "../types";
import { QueryKey, QueryKeyField } from "../QueryKey";

interface TestData {
  id: string;
  name: string;
  value: number;
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
const toKeyString = (key: string) => createTestQueryKey(key).toKey();

// Helper to create items without queryKeys (simulating legacy data)
const createLegacyItem = (
  id: string,
  name: string = `Item ${id}`
): Omit<CollectionItem<TestData>, "queryKeys"> => ({
  id,
  data: { id, name, value: 42, updatedAt: "2024-01-01" },
  lastFetched: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01",
});

// Helper to create items with queryKeys
const createModernItem = (
  id: string,
  queryKeys: string[],
  name: string = `Item ${id}`
): CollectionItem<TestData> => ({
  id,
  data: { id, name, value: 42, updatedAt: "2024-01-01" },
  lastFetched: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01",
  queryKeys,
});

describe("Phase 5.3: Migration Tests", () => {
  describe("queryKeys migration - adding queryKeys to items without them", () => {
    it("should add queryKeys to items without them", () => {
      const legacyItem = createLegacyItem("legacy-1");
      const queryKey = createTestQueryKey("test:query:key");
      const queryKeyString = queryKey.toKey();

      const migrated = ensureQueryKeys(legacyItem, queryKey);

      expect(migrated).toHaveProperty("queryKeys");
      expect(migrated.queryKeys).toEqual([queryKeyString]);
      expect(migrated.id).toBe("legacy-1");
      expect(migrated.data.name).toBe("Item legacy-1");
    });

    it("should add empty queryKeys array when no queryKey provided", () => {
      const legacyItem = createLegacyItem("legacy-2");

      const migrated = ensureQueryKeys(legacyItem);

      expect(migrated.queryKeys).toEqual([]);
    });

    it("should handle items that already have queryKeys", () => {
      const modernItem = createModernItem("modern-1", ["existing:query"]);

      const result = ensureQueryKeys(
        modernItem,
        createTestQueryKey("new:query")
      );

      expect(result).toBe(modernItem); // Reference equality when no change needed
      expect(result.queryKeys).toEqual(["existing:query"]);
    });

    it("should migrate arrays of items", () => {
      const legacyItems = [
        createLegacyItem("legacy-1"),
        createLegacyItem("legacy-2"),
        createLegacyItem("legacy-3"),
      ];
      const queryKey = createTestQueryKey("batch:migration");
      const queryKeyString = queryKey.toKey();

      const migrated = ensureQueryKeysForItems(legacyItems, queryKey);

      expect(migrated).toHaveLength(3);
      migrated.forEach((item, index) => {
        expect(item.queryKeys).toEqual([queryKeyString]);
        expect(item.id).toBe(`legacy-${index + 1}`);
      });
    });
  });

  describe("queryKeys migration - preserving existing data during migration", () => {
    it("should preserve all original item properties", () => {
      const originalItem = createLegacyItem("preserve-test");
      originalItem.data.name = "Special Name";
      originalItem.data.value = 999;
      originalItem.lastFetched = "2024-12-31T23:59:59Z";
      originalItem.updatedAt = "2024-12-31";

      const migrated = ensureQueryKeys(
        originalItem,
        createTestQueryKey("preservation:test")
      );

      expect(migrated.id).toBe(originalItem.id);
      expect(migrated.data).toEqual(originalItem.data);
      expect(migrated.lastFetched).toBe(originalItem.lastFetched);
      expect(migrated.updatedAt).toBe(originalItem.updatedAt);
      expect(migrated.queryKeys).toEqual([toKeyString("preservation:test")]);
    });

    it("should preserve complex nested data structures", () => {
      interface ComplexData {
        id: string;
        metadata: {
          tags: string[];
          settings: Record<string, unknown>;
          nested: {
            deep: {
              value: number;
            };
          };
        };
        updatedAt: string;
      }

      const complexItem: Omit<CollectionItem<ComplexData>, "queryKeys"> = {
        id: "complex-1",
        data: {
          id: "complex-1",
          updatedAt: "2024-01-01",
          metadata: {
            tags: ["important", "test"],
            settings: {
              enabled: true,
              count: 42,
              config: { mode: "advanced" },
            },
            nested: {
              deep: {
                value: 12345,
              },
            },
          },
        },
        lastFetched: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01",
      };

      const migrated = ensureQueryKeys(
        complexItem,
        createTestQueryKey("complex:query")
      );

      expect(migrated.data.metadata.tags).toEqual(["important", "test"]);
      expect(migrated.data.metadata.settings.config).toEqual({
        mode: "advanced",
      });
      expect(migrated.data.metadata.nested.deep.value).toBe(12345);
      expect(migrated.queryKeys).toEqual([toKeyString("complex:query")]);
    });

    it("should handle items with undefined or null data properties gracefully", () => {
      const itemWithNulls: Omit<
        CollectionItem<Partial<TestData>>,
        "queryKeys"
      > = {
        id: "nullish-1",
        data: {
          id: "nullish-1",
          name: undefined as unknown as string,
          value: undefined as unknown as number,
          updatedAt: "2024-01-01",
        },
        lastFetched: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01",
      };

      const migrated = ensureQueryKeys(
        itemWithNulls,
        createTestQueryKey("nullish:test")
      );

      expect(migrated.data.name).toBeUndefined();
      expect(migrated.data.value).toBeUndefined();
      expect(migrated.queryKeys).toEqual([toKeyString("nullish:test")]);
    });
  });

  describe("queryKeys migration - validating migrated state correctly", () => {
    it("should validate collection state successfully after migration", () => {
      const items = new CollectionMap<TestData>([
        ["item-1", createModernItem("item-1", ["query-1", "query-2"])],
        ["item-2", createModernItem("item-2", ["query-1"])],
        ["item-3", createModernItem("item-3", ["query-3"])],
      ]);

      const listQueries = new ListQueryMap(
        new Map([
          ["query-1", ["item-1", "item-2"]],
          ["query-3", ["item-3"]],
        ])
      );

      const singleQueries = new Map([["query-2", "item-1"]]);

      const result = validateCollectionState(items, listQueries, singleQueries);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing queryKeys field", () => {
      const items = new CollectionMap<TestData>();
      const legacyItem = createLegacyItem(
        "legacy-item"
      ) as CollectionItem<TestData>;
      // Simulate missing queryKeys by deleting the property
      delete (legacyItem as Partial<CollectionItem<TestData>>).queryKeys;
      items.setByStorageId("legacy-item", legacyItem);

      const listQueries = new ListQueryMap();
      const singleQueries = new Map<string, string>();

      const result = validateCollectionState(items, listQueries, singleQueries);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Item legacy-item is missing queryKeys field"
      );
    });

    it("should detect references to non-existent items", () => {
      const items = new CollectionMap([
        ["existing-item", createModernItem("existing-item", ["query-1"])],
      ]);

      const listQueries = new ListQueryMap(
        new Map([
          ["query-1", ["existing-item", "missing-item"]], // missing-item doesn't exist
          ["query-2", ["item-2", "item-3"]],
        ])
      );

      const singleQueries = new Map([
        ["query-2", "another-missing-item"], // another-missing-item doesn't exist
      ]);

      const result = validateCollectionState(items, listQueries, singleQueries);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "List query query-1 references non-existent item missing-item"
      );
      expect(result.errors).toContain(
        "Single query query-2 references non-existent item another-missing-item"
      );
    });

    it("should perform full runtime migration with validation", () => {
      // Setup: Mix of legacy and modern items
      const items = new CollectionMap<TestData>();
      const legacyItem = createLegacyItem("legacy") as CollectionItem<TestData>;
      delete (legacyItem as Partial<CollectionItem<TestData>>).queryKeys; // Simulate legacy
      const modernItem = createModernItem("modern", ["existing:query"]);

      items.setByStorageId("legacy", legacyItem);
      items.setByStorageId("modern", modernItem);

      const listQueries = new ListQueryMap(
        new Map([["test:query", ["legacy", "modern"]]])
      );
      const singleQueries = new Map<string, string>();

      const result = performRuntimeMigration(items, listQueries, singleQueries);

      expect(result.migrationPerformed).toBe(true);
      expect(result.validationResult.isValid).toBe(true);
      expect(result.items.getByStorageId("legacy")?.queryKeys).toEqual([]);
      expect(result.items.getByStorageId("modern")?.queryKeys).toEqual([
        "existing:query",
      ]);
    });
  });

  describe("queryKeys migration - handling edge cases gracefully", () => {
    it("should handle empty collections", () => {
      const items = new CollectionMap<TestData>();
      const listQueries = new ListQueryMap();
      const singleQueries = new Map<string, string>();

      const migrated = migrateCollectionState(items);
      const validation = validateCollectionState(
        items,
        listQueries,
        singleQueries
      );

      expect(migrated.size()).toBe(0);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should handle collections with only modern items", () => {
      const items = new CollectionMap([
        ["modern-1", createModernItem("modern-1", ["query-1"])],
        ["modern-2", createModernItem("modern-2", ["query-2"])],
      ]);
      const listQueries = new ListQueryMap();
      const singleQueries = new Map<string, string>();

      const result = performRuntimeMigration(items, listQueries, singleQueries);

      expect(result.migrationPerformed).toBe(false); // No migration needed
      expect(result.validationResult.isValid).toBe(true);
    });

    it("should handle malformed items gracefully", () => {
      const items = new CollectionMap<TestData>();

      // Create malformed items
      const malformedItem = {
        id: "malformed",
        data: null, // Malformed data
        lastFetched: "invalid-date",
        updatedAt: "invalid-date",
      } as unknown as CollectionItem<TestData>;

      items.setByStorageId("malformed", malformedItem);

      const migrated = ensureQueryKeys(
        malformedItem as unknown as Omit<CollectionItem<TestData>, "queryKeys">,
        createTestQueryKey("test")
      );

      expect(migrated.queryKeys).toEqual([toKeyString("test")]);
      expect(migrated.data).toBeNull();
      expect(migrated.lastFetched).toBe("invalid-date");
    });

    it("should handle very large queryKeys arrays", () => {
      const manyQueryKeys = Array.from(
        { length: 1000 },
        (_, i) => `query-${i}`
      );
      const item = createModernItem("large-querykeys", manyQueryKeys);

      const result = ensureQueryKeys(item, createTestQueryKey("new-query"));

      expect(result).toBe(item); // Reference equality - no change needed
      expect(result.queryKeys).toHaveLength(1000);
    });

    it("should handle special characters in queryKeys", () => {
      const specialQueryKey =
        "query:with:colons|pipes&ampersands/slashes?questions=marks#hashes";
      const item = createLegacyItem("special-chars");

      const migrated = ensureQueryKeys(
        item,
        createTestQueryKey(specialQueryKey)
      );

      expect(migrated.queryKeys).toEqual([toKeyString(specialQueryKey)]);
    });

    it("should handle duplicate migration attempts", () => {
      const item = createLegacyItem("duplicate-test");
      const queryKey = createTestQueryKey("duplicate:query");

      // First migration
      const firstMigration = ensureQueryKeys(item, queryKey);

      // Second migration with same queryKey
      const secondMigration = ensureQueryKeys(firstMigration, queryKey);

      expect(secondMigration).toBe(firstMigration); // Reference equality
      expect(secondMigration.queryKeys).toEqual([queryKey.toKey()]);
    });

    it("should handle type guard edge cases", () => {
      expect(hasQueryKeysField(null)).toBe(false);
      expect(hasQueryKeysField(undefined)).toBe(false);
      expect(hasQueryKeysField({})).toBe(false);
      expect(hasQueryKeysField({ queryKeys: "not-array" })).toBe(false);
      expect(hasQueryKeysField({ queryKeys: [] })).toBe(true);
      expect(hasQueryKeysField({ queryKeys: ["query"] })).toBe(true);
    });
  });

  describe("Migration debugging and inspection utilities", () => {
    it("should provide comprehensive migration state inspection", () => {
      const items = new CollectionMap<TestData>();

      // Mix of items with and without queryKeys
      const legacyItem = createLegacyItem(
        "legacy-1"
      ) as CollectionItem<TestData>;
      delete (legacyItem as Partial<CollectionItem<TestData>>).queryKeys;
      const modernItem1 = createModernItem("modern-1", ["query-1", "query-2"]);
      const modernItem2 = createModernItem("modern-2", ["query-1"]);
      const orphanedItem = createModernItem("orphaned", ["query-orphan"]); // Not in any query

      items.setByStorageId("legacy-1", legacyItem);
      items.setByStorageId("modern-1", modernItem1);
      items.setByStorageId("modern-2", modernItem2);
      items.setByStorageId("orphaned", orphanedItem);

      const listQueries = new ListQueryMap(
        new Map([
          ["query-1", ["modern-1", "modern-2", "missing-item"]], // missing-item referenced but doesn't exist
          ["query-2", ["modern-1"]],
        ])
      );

      const singleQueries = new Map([["query-2", "modern-1"]]);

      const inspection = inspectCollectionMigrationState(
        items,
        listQueries,
        singleQueries
      );

      expect(inspection.totalItems).toBe(4);
      expect(inspection.itemsWithQueryKeys).toBe(3); // modern-1, modern-2, orphaned
      expect(inspection.itemsNeedingMigration).toBe(1); // legacy-1
      expect(inspection.queryKeyDistribution).toEqual({
        "query-1": 2, // modern-1, modern-2
        "query-2": 1, // modern-1
        "query-orphan": 1, // orphaned
      });
      expect(inspection.orphanedItems).toEqual(["legacy-1", "orphaned"]); // Items not referenced by any query
      expect(inspection.missingItems).toEqual(["missing-item"]); // Referenced but doesn't exist
    });

    it("should handle inspection of perfect collection state", () => {
      const items = new CollectionMap([
        ["item-1", createModernItem("item-1", ["query-1"])],
        ["item-2", createModernItem("item-2", ["query-1", "query-2"])],
      ]);

      const listQueries = new ListQueryMap(
        new Map([["query-1", ["item-1", "item-2"]]])
      );
      const singleQueries = new Map([["query-2", "item-2"]]);

      const inspection = inspectCollectionMigrationState(
        items,
        listQueries,
        singleQueries
      );

      expect(inspection.totalItems).toBe(2);
      expect(inspection.itemsWithQueryKeys).toBe(2);
      expect(inspection.itemsNeedingMigration).toBe(0);
      expect(inspection.orphanedItems).toHaveLength(0);
      expect(inspection.missingItems).toHaveLength(0);
    });
  });

  describe("Integration with collection operations", () => {
    it("should migrate items during normal collection state operations", () => {
      // This test simulates how migration integrates with actual collection usage
      const items = new CollectionMap<TestData>();

      // Start with legacy item (no queryKeys)
      const legacyItem = createLegacyItem(
        "integration-test"
      ) as CollectionItem<TestData>;
      delete (legacyItem as Partial<CollectionItem<TestData>>).queryKeys;
      items.setByStorageId("integration-test", legacyItem);

      // Simulate collection state with queries
      const listQueries = new ListQueryMap();
      const singleQueries = new Map<string, string>();

      // Perform runtime migration (as would happen during collection initialization)
      const migrationResult = performRuntimeMigration(
        items,
        listQueries,
        singleQueries
      );

      expect(migrationResult.migrationPerformed).toBe(true);
      expect(migrationResult.validationResult.isValid).toBe(true);

      // After migration, item should have empty queryKeys array
      const migratedItem =
        migrationResult.items.getByStorageId("integration-test");
      expect(migratedItem?.queryKeys).toEqual([]);

      // Subsequent access should work normally with the queryKeys architecture
      expect(hasQueryKeysField(migratedItem)).toBe(true);
    });
  });
});
