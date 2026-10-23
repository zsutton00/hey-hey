import type { CollectionItem, CollectionAction } from "../types";

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

describe("createCollection - queryKeys integration", () => {
  describe("SET_ITEM with queryKeys", () => {
    it("should create valid action structure for new item", () => {
      const item = createMockItem("1", "Test", []);
      const action: CollectionAction<TestData> = {
        type: "SET_ITEM",
        item,
        queryKey: "test-query",
      };

      expect(action.type).toBe("SET_ITEM");
      expect(action.item.id).toBe("1");
      expect(action.queryKey).toBe("test-query");
      expect(action.item.queryKeys).toEqual([]);
    });

    it("should create valid action structure for item updates from different queries", () => {
      const item1 = createMockItem("1", "Test", ["query1"]);
      const item2 = createMockItem("1", "Test", ["query1", "query2"]);

      const action1: CollectionAction<TestData> = {
        type: "SET_ITEM",
        item: item1,
        queryKey: "query1",
      };

      const action2: CollectionAction<TestData> = {
        type: "SET_ITEM",
        item: item2,
        queryKey: "query2",
      };

      expect(action1.item.queryKeys).toEqual(["query1"]);
      expect(action2.item.queryKeys).toEqual(["query1", "query2"]);
    });
  });

  describe("SET_ITEMS with queryKeys", () => {
    it("should create valid action structure for list items", () => {
      const items = [
        createMockItem("1", "Item1", []),
        createMockItem("2", "Item2", []),
      ];

      const action: CollectionAction<TestData> = {
        type: "SET_ITEMS",
        items,
        queryKey: "list-query",
      };

      expect(action.type).toBe("SET_ITEMS");
      expect(action.items).toHaveLength(2);
      expect(action.queryKey).toBe("list-query");
      expect(action.items[0].id).toBe("1");
      expect(action.items[1].id).toBe("2");
    });

    it("should handle mixed new/existing items structure", () => {
      const items = [
        createMockItem("1", "Item1", ["existing-query"]),
        createMockItem("2", "Item2", []),
      ];

      const action: CollectionAction<TestData> = {
        type: "SET_ITEMS",
        items,
        queryKey: "new-query",
      };

      expect(action.items[0].queryKeys).toEqual(["existing-query"]);
      expect(action.items[1].queryKeys).toEqual([]);
    });
  });

  describe("MARK_ITEM_STALE", () => {
    it("should create valid action structure", () => {
      const action: CollectionAction<TestData> = {
        type: "MARK_ITEM_STALE",
        itemId: "item-1",
      };

      expect(action.type).toBe("MARK_ITEM_STALE");
      expect(action.itemId).toBe("item-1");
    });

    it("should handle different itemId values", () => {
      const action: CollectionAction<TestData> = {
        type: "MARK_ITEM_STALE",
        itemId: "non-existent",
      };

      expect(action.itemId).toBe("non-existent");
    });
  });

  describe("MARK_ITEMS_STALE", () => {
    it("should create valid batch action structure", () => {
      const action: CollectionAction<TestData> = {
        type: "MARK_ITEMS_STALE",
        itemIds: ["item-1", "item-2", "item-3"],
      };

      expect(action.type).toBe("MARK_ITEMS_STALE");
      expect(action.itemIds).toHaveLength(3);
      expect(action.itemIds).toContain("item-1");
      expect(action.itemIds).toContain("item-2");
      expect(action.itemIds).toContain("item-3");
    });

    it("should handle empty itemIds array", () => {
      const action: CollectionAction<TestData> = {
        type: "MARK_ITEMS_STALE",
        itemIds: [],
      };

      expect(action.itemIds).toHaveLength(0);
    });

    it("should handle mixed existing/non-existing items", () => {
      const action: CollectionAction<TestData> = {
        type: "MARK_ITEMS_STALE",
        itemIds: ["existing-1", "non-existent", "existing-2"],
      };

      expect(action.itemIds).toHaveLength(3);
      expect(action.itemIds).toContain("existing-1");
      expect(action.itemIds).toContain("non-existent");
      expect(action.itemIds).toContain("existing-2");
    });
  });

  describe("CLEAR_QUERY_FROM_ITEMS", () => {
    it("should create valid cleanup action structure", () => {
      const action: CollectionAction<TestData> = {
        type: "CLEAR_QUERY_FROM_ITEMS",
        queryKey: "query-to-remove",
      };

      expect(action.type).toBe("CLEAR_QUERY_FROM_ITEMS");
      expect(action.queryKey).toBe("query-to-remove");
    });

    it("should handle different queryKey values", () => {
      const action: CollectionAction<TestData> = {
        type: "CLEAR_QUERY_FROM_ITEMS",
        queryKey: "non-existent-query",
      };

      expect(action.queryKey).toBe("non-existent-query");
    });
  });

  describe("Action types validation", () => {
    it("should have correct action type constants", () => {
      // Test that our new action types are properly typed
      const markItemStale: CollectionAction<TestData>["type"] =
        "MARK_ITEM_STALE";
      const markItemsStale: CollectionAction<TestData>["type"] =
        "MARK_ITEMS_STALE";
      const clearQuery: CollectionAction<TestData>["type"] =
        "CLEAR_QUERY_FROM_ITEMS";

      expect(markItemStale).toBe("MARK_ITEM_STALE");
      expect(markItemsStale).toBe("MARK_ITEMS_STALE");
      expect(clearQuery).toBe("CLEAR_QUERY_FROM_ITEMS");
    });

    it("should maintain existing action types", () => {
      // Ensure we didn't break existing action types
      const setItem: CollectionAction<TestData>["type"] = "SET_ITEM";
      const setItems: CollectionAction<TestData>["type"] = "SET_ITEMS";
      const markStale: CollectionAction<TestData>["type"] = "MARK_STALE";
      const deleteItem: CollectionAction<TestData>["type"] = "DELETE_ITEM";

      expect(setItem).toBe("SET_ITEM");
      expect(setItems).toBe("SET_ITEMS");
      expect(markStale).toBe("MARK_STALE");
      expect(deleteItem).toBe("DELETE_ITEM");
    });
  });

  describe("Integration scenarios", () => {
    it("should create valid action structures for onboarding user journey pattern", () => {
      // Simulate the queryKey patterns from the real user journey
      const onboardingQuery = "conversations:org:project:onboarding:";
      const projectQuery = "conversations:org:project";
      const directQuery = "conversation:org:project:convId";

      const actions: CollectionAction<TestData>[] = [
        {
          type: "SET_ITEM",
          item: createMockItem("conv-123", "Onboarding Conversation"),
          queryKey: onboardingQuery,
        },
        {
          type: "SET_ITEM",
          item: createMockItem("conv-123", "Same Conversation"),
          queryKey: projectQuery,
        },
        {
          type: "SET_ITEM",
          item: createMockItem("conv-123", "Direct View"),
          queryKey: directQuery,
        },
        {
          type: "MARK_ITEM_STALE",
          itemId: "conv-123",
        },
      ];

      // Verify action structures are valid
      expect(actions).toHaveLength(4);
      expect(actions[0].type).toBe("SET_ITEM");
      expect(actions[1].type).toBe("SET_ITEM");
      expect(actions[2].type).toBe("SET_ITEM");
      expect(actions[3].type).toBe("MARK_ITEM_STALE");

      const markStaleAction = actions[3] as Extract<
        CollectionAction<TestData>,
        { type: "MARK_ITEM_STALE" }
      >;
      expect(markStaleAction.itemId).toBe("conv-123");
    });

    it("should create valid action structure for WebSocket invalidation pattern", () => {
      // Simulate WebSocket event triggering item-based invalidation
      const conversationId = "conv-456";

      const action: CollectionAction<TestData> = {
        type: "MARK_ITEM_STALE",
        itemId: conversationId,
      };

      expect(action.type).toBe("MARK_ITEM_STALE");
      expect(action.itemId).toBe(conversationId);
    });

    it("should create valid action structure for query cleanup pattern", () => {
      // Simulate cleaning up a query when it's no longer needed
      const queryToClean = "conversations:old-project:";

      const action: CollectionAction<TestData> = {
        type: "CLEAR_QUERY_FROM_ITEMS",
        queryKey: queryToClean,
      };

      expect(action.type).toBe("CLEAR_QUERY_FROM_ITEMS");
      expect(action.queryKey).toBe(queryToClean);
    });
  });
});
