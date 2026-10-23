/**
 * Phase 5.2: Runtime Migration Tests
 *
 * Tests the gradual migration strategy where existing items without queryKeys
 * are transparently migrated as they are accessed during normal operation.
 */

import { vi } from "vitest";
import {
  ensureQueryKeysOnAccess,
  ensureQueryKeysForListAccess,
  createMigratingItemGetter,
  createMigratingListGetter,
} from "../migration";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import type { CollectionItem } from "../types";
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

const createMockItemWithoutQueryKeys = (
  id: string
): Omit<CollectionItem<TestItem>, "queryKeys"> &
  Partial<Pick<CollectionItem<TestItem>, "queryKeys">> => ({
  id,
  data: { id, name: `Item ${id}`, updatedAt: "2024-01-01" },
  lastFetched: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01",
  // Deliberately omit queryKeys to simulate existing items
});

const createMockItemWithQueryKeys = (
  id: string,
  queryKeys: string[]
): CollectionItem<TestItem> => ({
  id,
  data: { id, name: `Item ${id}`, updatedAt: "2024-01-01" },
  lastFetched: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01",
  queryKeys,
});

describe("Phase 5.2: Runtime Migration", () => {
  describe("ensureQueryKeysOnAccess", () => {
    it("should migrate item without queryKeys field", () => {
      const itemWithoutQueryKeys = createMockItemWithoutQueryKeys("test-1");
      const queryKey = createTestQueryKey("conversations:org:project::");
      const queryKeyString = queryKey.toKey();

      const result = ensureQueryKeysOnAccess(
        itemWithoutQueryKeys as CollectionItem<TestItem>,
        queryKey
      );

      expect(result).toBeDefined();
      expect(result?.queryKeys).toEqual([queryKeyString]);
      expect(result?.id).toBe("test-1");
      expect(result?.data).toEqual(itemWithoutQueryKeys.data);
    });

    it("should add queryKey to item with existing queryKeys", () => {
      const existingItem = createMockItemWithQueryKeys("test-2", [
        "existing:query",
      ]);
      const newQueryKey = createTestQueryKey("conversations:org:project::");
      const newQueryKeyString = newQueryKey.toKey();

      const result = ensureQueryKeysOnAccess(existingItem, newQueryKey);

      expect(result?.queryKeys).toEqual(["existing:query", newQueryKeyString]);
    });

    it("should not duplicate existing queryKeys", () => {
      const sameQueryKey = createTestQueryKey("conversations:org:project::");
      const sameQueryKeyString = sameQueryKey.toKey();
      const existingItem = createMockItemWithQueryKeys("test-3", [
        sameQueryKeyString,
      ]);

      const result = ensureQueryKeysOnAccess(existingItem, sameQueryKey);

      expect(result?.queryKeys).toEqual([sameQueryKeyString]);
      expect(result).toBe(existingItem); // Reference equality when no change needed
    });

    it("should return undefined for undefined item", () => {
      const result = ensureQueryKeysOnAccess(
        undefined,
        createTestQueryKey("any:query")
      );
      expect(result).toBeUndefined();
    });
  });

  describe("ensureQueryKeysForListAccess", () => {
    it("should migrate multiple items without queryKeys", () => {
      const items = [
        createMockItemWithoutQueryKeys("item-1") as CollectionItem<TestItem>,
        createMockItemWithoutQueryKeys("item-2") as CollectionItem<TestItem>,
      ];
      const queryKey = createTestQueryKey("conversations:org:project::");
      const queryKeyString = queryKey.toKey();

      const result = ensureQueryKeysForListAccess(items, queryKey);

      expect(result.migrationNeeded).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].queryKeys).toEqual([queryKeyString]);
      expect(result.items[1].queryKeys).toEqual([queryKeyString]);
    });

    it("should handle mixed items with and without queryKeys", () => {
      const items = [
        createMockItemWithoutQueryKeys("item-1") as CollectionItem<TestItem>,
        createMockItemWithQueryKeys("item-2", ["existing:query"]),
      ];
      const queryKey = createTestQueryKey("conversations:org:project::");
      const queryKeyString = queryKey.toKey();

      const result = ensureQueryKeysForListAccess(items, queryKey);

      expect(result.migrationNeeded).toBe(true);
      expect(result.items[0].queryKeys).toEqual([queryKeyString]);
      expect(result.items[1].queryKeys).toEqual([
        "existing:query",
        queryKeyString,
      ]);
    });

    it("should detect no migration needed when all items have queryKey", () => {
      const queryKey = createTestQueryKey("conversations:org:project::");
      const queryKeyString = queryKey.toKey();
      const items = [
        createMockItemWithQueryKeys("item-1", [queryKeyString]),
        createMockItemWithQueryKeys("item-2", [queryKeyString]),
      ];

      const result = ensureQueryKeysForListAccess(items, queryKey);

      expect(result.migrationNeeded).toBe(false);
      expect(result.items).toHaveLength(2);
    });
  });

  describe("createMigratingItemGetter", () => {
    it("should dispatch migration action when item needs migration", () => {
      const items = new CollectionMap<TestItem>();
      const itemWithoutQueryKeys = createMockItemWithoutQueryKeys(
        "test-item"
      ) as CollectionItem<TestItem>;
      items.setByStorageId("test-item", itemWithoutQueryKeys);

      const dispatchedActions: unknown[] = [];
      const mockDispatch = (action: unknown) => dispatchedActions.push(action);

      const getter = createMigratingItemGetter(items, mockDispatch);
      const queryKey = createTestQueryKey("conversations:org:project::");
      const queryKeyString = queryKey.toKey();
      const result = getter("test-item", queryKey);

      expect(result?.queryKeys).toEqual([queryKeyString]);
      expect(dispatchedActions).toHaveLength(1);
      expect(dispatchedActions[0]).toMatchObject({
        type: "MIGRATE_ITEM_QUERY_KEYS",
        itemId: "test-item",
      });
    });

    it("should not dispatch when item already has queryKeys", () => {
      const items = new CollectionMap<TestItem>();
      const queryKey = createTestQueryKey("conversations:org:project::");
      const queryKeyString = queryKey.toKey();
      const itemWithQueryKeys = createMockItemWithQueryKeys("test-item", [
        queryKeyString,
      ]);
      items.setByStorageId("test-item", itemWithQueryKeys);

      const dispatchedActions: unknown[] = [];
      const mockDispatch = (action: unknown) => dispatchedActions.push(action);

      const getter = createMigratingItemGetter(items, mockDispatch);
      const result = getter("test-item", queryKey);

      expect(result).toBe(itemWithQueryKeys); // Reference equality
      expect(dispatchedActions).toHaveLength(0); // No migration needed
    });

    it("should return item without migration when no queryKey provided", () => {
      const items = new CollectionMap<TestItem>();
      const itemWithoutQueryKeys = createMockItemWithoutQueryKeys(
        "test-item"
      ) as CollectionItem<TestItem>;
      items.setByStorageId("test-item", itemWithoutQueryKeys);

      const dispatchedActions: unknown[] = [];
      const mockDispatch = (action: unknown) => dispatchedActions.push(action);

      const getter = createMigratingItemGetter(items, mockDispatch);
      const result = getter("test-item"); // No queryKey

      expect(result).toBe(itemWithoutQueryKeys); // Original item returned
      expect(dispatchedActions).toHaveLength(0); // No migration without queryKey
    });
  });

  describe("createMigratingListGetter", () => {
    it("should migrate entire list when items need migration", () => {
      const items = new CollectionMap<TestItem>();
      const listQueries = new ListQueryMap();
      const listQueryKey = createTestQueryKey("conversations:org:project::");
      const listQueryKeyString = listQueryKey.toKey();

      // Setup items without queryKeys
      const item1 = createMockItemWithoutQueryKeys(
        "item-1"
      ) as CollectionItem<TestItem>;
      const item2 = createMockItemWithoutQueryKeys(
        "item-2"
      ) as CollectionItem<TestItem>;
      items.setByStorageId("item-1", item1);
      items.setByStorageId("item-2", item2);

      // Setup list query
      listQueries.setByKeyString(listQueryKeyString, ["item-1", "item-2"]);

      const dispatchedActions: unknown[] = [];
      const mockDispatch = (action: unknown) => dispatchedActions.push(action);

      const getter = createMigratingListGetter(
        items,
        listQueries,
        mockDispatch
      );
      const result = getter(listQueryKey);

      expect(result).toHaveLength(2);
      expect(result?.[0].queryKeys).toEqual([listQueryKeyString]);
      expect(result?.[1].queryKeys).toEqual([listQueryKeyString]);
      expect(dispatchedActions).toHaveLength(2); // One migration action per item
    });

    it("should handle non-existent query key", () => {
      const items = new CollectionMap<TestItem>();
      const listQueries = new ListQueryMap();
      const mockDispatch = vi.fn();
      const missingQueryKey = createTestQueryKey("non-existent:query");

      const getter = createMigratingListGetter(
        items,
        listQueries,
        mockDispatch
      );
      const result = getter(missingQueryKey);

      expect(result).toBeUndefined();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("End-to-end runtime migration scenarios", () => {
    it("should demonstrate Phase 5.2 gradual migration strategy", () => {
      // Scenario: Existing collection with items that lack queryKeys field
      // As hooks access these items, they should be transparently migrated

      const items = new CollectionMap<TestItem>();
      const listQueries = new ListQueryMap();
      const baseQueryKey = createTestQueryKey("conversations:org:proj::");
      const baseQueryKeyString = baseQueryKey.toKey();

      // Simulate existing items in collection (pre-Phase 5 data)
      const existingItem = createMockItemWithoutQueryKeys(
        "existing-conv"
      ) as CollectionItem<TestItem>;
      items.setByStorageId("existing-conv", existingItem);
      listQueries.setByKeyString(baseQueryKeyString, ["existing-conv"]);

      const migrationLog: string[] = [];
      const mockDispatch = (action: {
        type: string;
        itemId: string;
        migratedItem: CollectionItem<TestItem>;
      }) => {
        migrationLog.push(
          `Migrated ${
            action.itemId
          } to include queryKeys: ${action.migratedItem.queryKeys.join(", ")}`
        );
        // Simulate collection updating the item
        items.setByStorageId(action.itemId, action.migratedItem);
      };

      // Phase 5.2: Access items through migrating getter (simulates hook usage)
      const listGetter = createMigratingListGetter(
        items,
        listQueries,
        mockDispatch
      );

      // First access - should trigger migration
      const firstAccess = listGetter(baseQueryKey);
      expect(firstAccess?.[0].queryKeys).toEqual([baseQueryKeyString]);
      expect(migrationLog).toHaveLength(1);
      expect(migrationLog[0]).toBe(
        `Migrated existing-conv to include queryKeys: ${baseQueryKeyString}`
      );

      // Second access to same query - should not re-migrate
      migrationLog.length = 0; // Clear log
      const secondAccess = listGetter(baseQueryKey);
      expect(secondAccess?.[0].queryKeys).toEqual([baseQueryKeyString]);
      expect(migrationLog).toHaveLength(0); // No additional migration

      // Access from different query - should add queryKey
      const differentQueryKey = createTestQueryKey(
        "conversations:org:proj:onboarding:"
      );
      const differentQueryKeyString = differentQueryKey.toKey();
      const differentAccess = listGetter(differentQueryKey);
      expect(differentAccess).toBeUndefined(); // Query doesn't exist yet

      // Add the item to the new query and access again
      listQueries.setByKeyString(differentQueryKeyString, ["existing-conv"]);
      const onboardingAccess = listGetter(differentQueryKey);
      expect(onboardingAccess?.[0].queryKeys).toEqual([
        baseQueryKeyString,
        differentQueryKeyString,
      ]);
      expect(migrationLog).toHaveLength(1); // One migration to add the new queryKey
    });
  });
});
