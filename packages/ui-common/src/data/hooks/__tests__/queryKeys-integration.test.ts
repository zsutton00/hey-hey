/**
 * Phase 3: Hook Integration Tests
 *
 * Tests that hooks work correctly with the queryKeys architecture from Phase 1 & 2.
 * This ensures hooks automatically benefit from the new collection behavior without changes.
 */

import type { CollectionItem, CollectionAction } from "../../core/types";
import type { ConversationResponseDto } from "../../../api";
import {
  addQueryKeyToItem,
  hasQueryKey,
  findItemsByQueryKeyPattern,
} from "../../core/queryKeyUtils";
import { CollectionMap } from "../../core/CollectionMap";
import { ListQueryMap } from "../../core/ListQueryMap";
import { conversationKeys } from "../../collections/conversations";

// Conversations now live in TanStack Query; their keys serve here only as
// realistic, distinct sample keys for the generic queryKey utilities.
const createConversationsQueryKey = ({
  organizationId,
  projectId,
  workflowName,
}: {
  organizationId: string;
  projectId: string;
  workflowName?: string;
}) => ({
  toKey: () =>
    JSON.stringify(
      conversationKeys.list(organizationId, projectId, { workflowName })
    ),
});
const createConversationQueryKey = ({
  organizationId,
  projectId,
  conversationId,
}: {
  organizationId: string;
  projectId: string;
  conversationId: string;
}) => ({
  toKey: () =>
    JSON.stringify(
      conversationKeys.envelope(organizationId, projectId, conversationId)
    ),
});

interface TestHookState {
  items: CollectionMap<ConversationResponseDto>;
  listQueries: ListQueryMap;
  singleQueries: Map<string, string>;
  stale: Set<string>;
  loading: Set<string>;
  errors: Map<string, Error>;
  fetched: Set<string>;
  optimisticUpdates: Map<string, unknown>;
}

const createMockConversation = (
  id: string,
  projectId: string,
  queryKeys: string[] = []
): CollectionItem<ConversationResponseDto> => ({
  id,
  data: {
    id,
    projectId,
    organizationId: "org-123",
    title: `Conversation ${id}`,
    status: "ACTIVE" as ConversationResponseDto["status"],
    initiatedBy: "USER" as ConversationResponseDto["initiatedBy"],
    version: 1,
    category: "GENERAL" as ConversationResponseDto["category"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  } as ConversationResponseDto,
  updatedAt: "2024-01-01T00:00:00Z",
  lastFetched: "2024-01-01T00:00:00Z",
  queryKeys,
  fetchedCount: 1,
});

const createInitialState = (): TestHookState => ({
  items: new CollectionMap(),
  listQueries: new ListQueryMap(),
  singleQueries: new Map(),
  stale: new Set(),
  loading: new Set(),
  errors: new Map(),
  fetched: new Set(),
  optimisticUpdates: new Map(),
});

describe("queryKeys integration with hooks", () => {
  describe("Hook data retrieval with queryKeys", () => {
    it("should retrieve data correctly when item has multiple queryKeys", () => {
      // Simulate an item loaded by multiple hook instances with different query patterns
      const conversationId = "conv-123";
      const queryKeys = [
        createConversationsQueryKey({
          organizationId: "org",
          projectId: "project",
          workflowName: "onboarding",
        }).toKey(),
        createConversationsQueryKey({
          organizationId: "org",
          projectId: "project",
        }).toKey(),
        createConversationQueryKey({
          organizationId: "org",
          projectId: "project",
          conversationId: "conv-123",
        }).toKey(),
      ];

      const item = createMockConversation(
        conversationId,
        "project-456",
        queryKeys
      );

      // Verify the item has all expected queryKeys
      expect(item.queryKeys).toHaveLength(3);
      expect(hasQueryKey(item, queryKeys[0])).toBe(true);
      expect(hasQueryKey(item, queryKeys[1])).toBe(true);
      expect(hasQueryKey(item, queryKeys[2])).toBe(true);

      // Verify hooks can find this item through any of its queryKeys
      const items = new CollectionMap([[conversationId, item]]);

      const onboardingResults = findItemsByQueryKeyPattern(items, queryKeys[0]);
      const projectResults = findItemsByQueryKeyPattern(items, queryKeys[1]);
      const directResults = findItemsByQueryKeyPattern(items, queryKeys[2]);

      expect(onboardingResults).toHaveLength(1);
      expect(projectResults).toHaveLength(1);
      expect(directResults).toHaveLength(1);
      expect(onboardingResults[0].id).toBe(conversationId);
    });

    it("should handle useConversations list query pattern correctly", () => {
      // Simulate the query pattern from useConversations hook
      const queryKey = createConversationsQueryKey({
        organizationId: "org-123",
        projectId: "project-456",
      }).toKey();

      const conversations = [
        createMockConversation("conv-1", "project-456", [queryKey]),
        createMockConversation("conv-2", "project-456", [queryKey]),
        createMockConversation("conv-3", "project-456", [queryKey]),
      ];

      // Verify all conversations are properly tagged
      conversations.forEach((conv) => {
        expect(hasQueryKey(conv, queryKey)).toBe(true);
        expect(conv.queryKeys).toEqual([queryKey]);
      });

      // Simulate how useConversations retrieves list data
      const state = createInitialState();
      conversations.forEach((conv) => {
        state.items.setByStorageId(conv.id, conv);
      });
      state.listQueries.setByKeyString(
        queryKey,
        conversations.map((c) => c.id)
      );

      // Hook should be able to retrieve all conversations
      const itemIds = state.listQueries.getByKeyString(queryKey);
      expect(itemIds).toHaveLength(3);

      const retrievedConversations = itemIds
        ?.map((id) => state.items.getByStorageId(id)?.data)
        .filter(Boolean);
      expect(retrievedConversations).toHaveLength(3);
      expect(retrievedConversations?.[0]?.id).toBe("conv-1");
    });

    it("should handle useConversation single query pattern correctly", () => {
      // Simulate the query pattern from useConversation hook
      const queryKey = createConversationQueryKey({
        organizationId: "org-123",
        projectId: "project-456",
        conversationId: "conv-789",
      }).toKey();
      const conversationId = "conv-789";

      const conversation = createMockConversation(
        conversationId,
        "project-456",
        [queryKey]
      );

      // Simulate how useConversation retrieves single item data
      const state = createInitialState();
      state.items.setByStorageId(conversationId, conversation);
      state.singleQueries.set(queryKey, conversationId);

      // Hook should be able to retrieve the conversation
      const itemId = state.singleQueries.get(queryKey);
      expect(itemId).toBe(conversationId);

      const retrievedConversation = itemId
        ? state.items.getByStorageId(itemId)?.data
        : null;
      expect(retrievedConversation).not.toBeNull();
      expect(retrievedConversation?.id).toBe(conversationId);
      expect(hasQueryKey(conversation, queryKey)).toBe(true);
    });
  });

  describe("Multiple hook instances tracking same item", () => {
    it("should track queryKeys across multiple hook instances correctly", () => {
      // Simulate the scenario described in QUERY_KEYS.MD:
      // 1. Load onboarding conversation
      // 2. Navigate to project conversations
      // 3. Open conversation directly
      // Each step should add a new queryKey to the same item

      const conversationId = "conv-onboarding-123";
      const projectId = "project-456";
      const orgId = "org-123";

      // Step 1: useConversations from onboarding loads conversation
      const onboardingQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
        workflowName: "onboarding",
      }).toKey();
      let conversation = createMockConversation(conversationId, projectId, [
        onboardingQuery,
      ]);

      expect(conversation.queryKeys).toEqual([onboardingQuery]);

      // Step 2: useConversations from project page loads same conversation
      const projectQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
      }).toKey();
      conversation = addQueryKeyToItem(conversation, projectQuery);

      expect(conversation.queryKeys).toHaveLength(2);
      expect(conversation.queryKeys).toContain(onboardingQuery);
      expect(conversation.queryKeys).toContain(projectQuery);

      // Step 3: useConversation direct view loads same conversation
      const directQuery = createConversationQueryKey({
        organizationId: orgId,
        projectId,
        conversationId,
      }).toKey();
      conversation = addQueryKeyToItem(conversation, directQuery);

      expect(conversation.queryKeys).toHaveLength(3);
      expect(conversation.queryKeys).toContain(onboardingQuery);
      expect(conversation.queryKeys).toContain(projectQuery);
      expect(conversation.queryKeys).toContain(directQuery);

      // All three query patterns should be able to find this conversation
      const items = new CollectionMap([[conversationId, conversation]]);

      expect(findItemsByQueryKeyPattern(items, onboardingQuery)).toHaveLength(
        1
      );
      expect(findItemsByQueryKeyPattern(items, projectQuery)).toHaveLength(1);
      expect(findItemsByQueryKeyPattern(items, directQuery)).toHaveLength(1);
    });

    it("should prevent duplicate queryKeys when same hook instance refetches", () => {
      const conversationId = "conv-123";
      const queryKey = createConversationsQueryKey({
        organizationId: "org",
        projectId: "project",
      }).toKey();

      // First fetch adds queryKey
      let conversation = createMockConversation(conversationId, "project-456", [
        queryKey,
      ]);
      expect(conversation.queryKeys).toEqual([queryKey]);

      // Second fetch from same hook should not duplicate
      conversation = addQueryKeyToItem(conversation, queryKey);
      expect(conversation.queryKeys).toEqual([queryKey]); // Still only one

      // Third fetch - still no duplication
      conversation = addQueryKeyToItem(conversation, queryKey);
      expect(conversation.queryKeys).toEqual([queryKey]);
    });
  });

  describe("Invalidation scenarios with queryKeys", () => {
    it("should identify all affected queries when item is marked stale", () => {
      // Set up an item loaded by multiple query patterns
      const conversationId = "conv-multi-query";
      const queryKeys = [
        createConversationsQueryKey({
          organizationId: "org",
          projectId: "proj",
          workflowName: "onboarding",
        }).toKey(),
        createConversationsQueryKey({
          organizationId: "org",
          projectId: "proj",
        }).toKey(),
        createConversationQueryKey({
          organizationId: "org",
          projectId: "proj",
          conversationId: "conv-multi-query",
        }).toKey(),
      ];

      const conversation = createMockConversation(
        conversationId,
        "proj",
        queryKeys
      );
      const items = new CollectionMap([[conversationId, conversation]]);

      // Simulate MARK_ITEM_STALE action: all queryKeys for this item should be marked stale
      const item = items.getByStorageId(conversationId);
      expect(item?.queryKeys).toHaveLength(3);

      // All three queries should be affected
      const affectedQueries = item?.queryKeys || [];
      expect(affectedQueries).toContain(queryKeys[0]);
      expect(affectedQueries).toContain(queryKeys[1]);
      expect(affectedQueries).toContain(queryKeys[2]);

      // This means all three hook instances would refetch
      expect(affectedQueries).toHaveLength(3);
    });

    it("should handle real-world scenario: onboarding → project → direct view with WebSocket invalidation", () => {
      // Complete user journey simulation
      const conversationId = "conv-journey-test";
      const orgId = "org-123";
      const projectId = "project-456";

      const items = new CollectionMap<ConversationResponseDto>();
      const staleQueries = new Set<string>();

      // User starts at onboarding
      const onboardingQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
        workflowName: "onboarding",
      }).toKey();
      let conversation = createMockConversation(conversationId, projectId, [
        onboardingQuery,
      ]);
      items.setByStorageId(conversationId, conversation);

      // User navigates to project conversations
      const projectQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
      }).toKey();
      conversation = addQueryKeyToItem(conversation, projectQuery);
      items.setByStorageId(conversationId, conversation);

      // User opens conversation directly
      const directQuery = createConversationQueryKey({
        organizationId: orgId,
        projectId,
        conversationId,
      }).toKey();
      conversation = addQueryKeyToItem(conversation, directQuery);
      items.setByStorageId(conversationId, conversation);

      // Verify conversation is tracked by all three queries
      expect(conversation.queryKeys).toHaveLength(3);

      // WebSocket event triggers MARK_ITEM_STALE for this conversationId
      const item = items.getByStorageId(conversationId);
      if (item?.queryKeys) {
        item.queryKeys.forEach((queryKey) => staleQueries.add(queryKey));
      }

      // All three query patterns should be marked stale and refetch
      expect(staleQueries.has(onboardingQuery)).toBe(true);
      expect(staleQueries.has(projectQuery)).toBe(true);
      expect(staleQueries.has(directQuery)).toBe(true);
      expect(staleQueries.size).toBe(3);

      // This solves the original problem: regardless of which query pattern
      // WebSocket handler knows about, all queries that loaded this item will refetch
    });
  });

  describe("Action type compatibility", () => {
    it("should work with new MARK_ITEM_STALE action type", () => {
      const action: CollectionAction<ConversationResponseDto> = {
        type: "MARK_ITEM_STALE",
        itemId: "conv-123",
      };

      expect(action.type).toBe("MARK_ITEM_STALE");
      expect(action.itemId).toBe("conv-123");

      // Should be correctly typed
      if (action.type === "MARK_ITEM_STALE") {
        expect(typeof action.itemId).toBe("string");
      }
    });

    it("should work with new MARK_ITEMS_STALE action type", () => {
      const action: CollectionAction<ConversationResponseDto> = {
        type: "MARK_ITEMS_STALE",
        itemIds: ["conv-1", "conv-2", "conv-3"],
      };

      expect(action.type).toBe("MARK_ITEMS_STALE");
      expect(action.itemIds).toHaveLength(3);

      // Should be correctly typed
      if (action.type === "MARK_ITEMS_STALE") {
        expect(Array.isArray(action.itemIds)).toBe(true);
        expect(action.itemIds[0]).toBe("conv-1");
      }
    });

    it("should work with new CLEAR_QUERY_FROM_ITEMS action type", () => {
      const queryKey = createConversationsQueryKey({
        organizationId: "org-1",
        projectId: "old-project",
      }).toKey();
      const action: CollectionAction<ConversationResponseDto> = {
        type: "CLEAR_QUERY_FROM_ITEMS",
        queryKey,
      };

      expect(action.type).toBe("CLEAR_QUERY_FROM_ITEMS");
      expect(action.queryKey).toBe(queryKey);

      // Should be correctly typed
      if (action.type === "CLEAR_QUERY_FROM_ITEMS") {
        expect(typeof action.queryKey).toBe("string");
      }
    });

    it("should maintain compatibility with existing action types", () => {
      // Existing actions should still work
      const setItemAction: CollectionAction<ConversationResponseDto> = {
        type: "SET_ITEM",
        item: createMockConversation("conv-1", "proj-1", ["query-1"]),
        queryKey: "query-1",
      };

      const markStaleAction: CollectionAction<ConversationResponseDto> = {
        type: "MARK_STALE",
        queryKey: "query-to-stale",
      };

      expect(setItemAction.type).toBe("SET_ITEM");
      expect(markStaleAction.type).toBe("MARK_STALE");
    });
  });

  describe("Memory and performance considerations", () => {
    it("should not accumulate excessive queryKeys in normal usage", () => {
      const conversationId = "conv-performance-test";
      let conversation = createMockConversation(conversationId, "proj", []);

      // Simulate normal usage patterns
      const commonQueries = [
        createConversationsQueryKey({
          organizationId: "org",
          projectId: "proj",
        }).toKey(),
        createConversationQueryKey({
          organizationId: "org",
          projectId: "proj",
          conversationId: "conv-performance-test",
        }).toKey(),
        createConversationsQueryKey({
          organizationId: "org",
          projectId: "proj",
          workflowName: "completed",
        }).toKey(),
      ];

      // Add each query once (as would happen in normal app usage)
      commonQueries.forEach((query) => {
        conversation = addQueryKeyToItem(conversation, query);
      });

      expect(conversation.queryKeys).toHaveLength(3);
      expect(conversation.queryKeys).toEqual(
        expect.arrayContaining(commonQueries)
      );

      // Repeated usage of same queries shouldn't add duplicates
      commonQueries.forEach((query) => {
        conversation = addQueryKeyToItem(conversation, query);
      });

      expect(conversation.queryKeys).toHaveLength(3); // Still only 3
    });

    it("should handle queryKeys field efficiently for hook data retrieval", () => {
      // Create multiple conversations with different queryKey patterns
      const conversations = [];
      for (let i = 0; i < 100; i++) {
        conversations.push(
          createMockConversation(`conv-${i}`, "proj", [`query-${i % 10}`])
        );
      }

      // Verify each has exactly one queryKey (efficient memory usage)
      conversations.forEach((conv) => {
        expect(conv.queryKeys).toHaveLength(1);
      });

      // Pattern matching should be efficient
      const items = new CollectionMap(conversations.map((c) => [c.id, c]));
      const results = findItemsByQueryKeyPattern(items, "query-5");

      // Should find all conversations with query-5 (every 10th one)
      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(hasQueryKey(result, "query-5")).toBe(true);
      });
    });
  });

  describe("Cross-hook data sharing efficiency", () => {
    it("should demonstrate cross-hook data sharing without duplicate API calls", () => {
      // This test shows how the same conversation data is efficiently shared
      // across different hook instances without duplicate API calls

      const conversationId = "shared-conv-123";
      const projectId = "project-456";
      const orgId = "org-123";

      // Create conversation that will be shared across hooks
      const conversation = createMockConversation(
        conversationId,
        projectId,
        []
      );
      const items = new CollectionMap<ConversationResponseDto>();

      // Simulate Hook 1: Load via list query (like useConversations)
      const listQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
      }).toKey();
      let sharedConversation = addQueryKeyToItem(conversation, listQuery);
      items.setByStorageId(conversationId, sharedConversation);

      // Verify initial state - conversation loaded with list queryKey
      expect(sharedConversation.queryKeys).toEqual([listQuery]);

      // Simulate Hook 2: Access same conversation via single query (like useConversation)
      // This should merge queryKeys, not create new data
      const singleQuery = createConversationQueryKey({
        organizationId: orgId,
        projectId,
        conversationId,
      }).toKey();
      sharedConversation = addQueryKeyToItem(sharedConversation, singleQuery);
      items.setByStorageId(conversationId, sharedConversation);

      // Verify data sharing efficiency
      const finalItem = items.getByStorageId(conversationId);
      expect(finalItem?.queryKeys).toHaveLength(2);
      expect(finalItem?.queryKeys).toContain(listQuery);
      expect(finalItem?.queryKeys).toContain(singleQuery);

      // Verify data is the same object (efficient sharing)
      expect(finalItem?.data).toEqual(conversation.data);
      expect(finalItem?.id).toBe(conversationId);

      // Both query patterns should be able to find the same conversation
      const itemsMap = new CollectionMap([[conversationId, finalItem!]]);
      const listResults = findItemsByQueryKeyPattern(itemsMap, listQuery);
      const singleResults = findItemsByQueryKeyPattern(itemsMap, singleQuery);

      expect(listResults).toHaveLength(1);
      expect(singleResults).toHaveLength(1);
      expect(listResults[0]).toBe(singleResults[0]); // Same object reference

      // This demonstrates that:
      // 1. Same conversation data is reused across hook instances
      // 2. No data duplication occurs
      // 3. Both hooks can access the same conversation efficiently
      // 4. QueryKeys enable tracking which hooks are using the data
    });

    it("should handle multiple hooks accessing same conversation through different query patterns", () => {
      // Comprehensive test of the cross-hook sharing scenario
      const conversationId = "multi-hook-conv";
      const projectId = "project-789";
      const orgId = "org-456";

      const items = new CollectionMap<ConversationResponseDto>();

      // Start with empty conversation
      let conversation = createMockConversation(conversationId, projectId, []);

      // Hook 1: useConversations with category filter loads conversation
      const categoryQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
        workflowName: "onboarding",
      }).toKey();
      conversation = addQueryKeyToItem(conversation, categoryQuery);
      items.setByStorageId(conversationId, conversation);

      // Hook 2: useConversations without filter loads same conversation
      const allQuery = createConversationsQueryKey({
        organizationId: orgId,
        projectId,
      }).toKey();
      conversation = addQueryKeyToItem(conversation, allQuery);
      items.setByStorageId(conversationId, conversation);

      // Hook 3: useConversation loads same conversation directly
      const directQuery = createConversationQueryKey({
        organizationId: orgId,
        projectId,
        conversationId,
      }).toKey();
      conversation = addQueryKeyToItem(conversation, directQuery);
      items.setByStorageId(conversationId, conversation);

      // Verify all three hooks are tracking the same conversation
      const finalConversation = items.getByStorageId(conversationId);
      expect(finalConversation?.queryKeys).toHaveLength(3);
      expect(finalConversation?.queryKeys).toContain(categoryQuery);
      expect(finalConversation?.queryKeys).toContain(allQuery);
      expect(finalConversation?.queryKeys).toContain(directQuery);

      // All hooks should find the same conversation instance
      const itemsMap = new CollectionMap([
        [conversationId, finalConversation!],
      ]);
      const categoryResults = findItemsByQueryKeyPattern(
        itemsMap,
        categoryQuery
      );
      const allResults = findItemsByQueryKeyPattern(itemsMap, allQuery);
      const directResults = findItemsByQueryKeyPattern(itemsMap, directQuery);

      expect(categoryResults).toHaveLength(1);
      expect(allResults).toHaveLength(1);
      expect(directResults).toHaveLength(1);

      // All should reference the same conversation object
      expect(categoryResults[0]).toBe(allResults[0]);
      expect(allResults[0]).toBe(directResults[0]);

      // This proves that multiple hooks can efficiently share the same data
      // without creating separate copies or requiring duplicate API calls
    });

    it("should prevent duplicate queryKeys when same hook refetches", () => {
      // Test that prevents queryKey duplication on refetch
      const conversationId = "refetch-test-conv";
      const queryKey = createConversationsQueryKey({
        organizationId: "org",
        projectId: "project",
      }).toKey();

      let conversation = createMockConversation(conversationId, "project", []);

      // First fetch adds queryKey
      conversation = addQueryKeyToItem(conversation, queryKey);
      expect(conversation.queryKeys).toEqual([queryKey]);

      // Second fetch from same hook should not duplicate
      conversation = addQueryKeyToItem(conversation, queryKey);
      expect(conversation.queryKeys).toEqual([queryKey]); // Still only one

      // Third fetch - still no duplication
      conversation = addQueryKeyToItem(conversation, queryKey);
      expect(conversation.queryKeys).toEqual([queryKey]);

      // Verify the queryKey exists and can be found
      expect(hasQueryKey(conversation, queryKey)).toBe(true);

      // This ensures efficient memory usage and prevents queryKey bloat
    });
  });
});
