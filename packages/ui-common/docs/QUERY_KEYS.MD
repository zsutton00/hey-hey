QUERY_KEYS.MD

QueryKeys Architecture: Detailed Phased Implementation Plan

Phase 1: Foundation & Core Utilities (1-2 days)

1.1 Pure Utility Functions

File: /src/data/core/queryKeyUtils.ts
// Pure utility functions for query key management
export function addQueryKeyToItem<T>(
item: CollectionItem<T>,
queryKey: string
): CollectionItem<T>

export function removeQueryKeyFromItem<T>(
item: CollectionItem<T>,
queryKey: string
): CollectionItem<T>

export function hasQueryKey<T>(
item: CollectionItem<T>,
queryKey: string
): boolean

export function mergeQueryKeys(
existing: string[],
newKeys: string[]
): string[]

export function findItemsByQueryKeyPattern(
items: Map<string, CollectionItem<any>>,
pattern: string | RegExp
): CollectionItem<any>[]

Tests: /src/data/core/**tests**/queryKeyUtils.test.ts
describe('queryKeyUtils', () => {
describe('addQueryKeyToItem', () => {
it('should add queryKey to empty queryKeys array')
it('should not duplicate existing queryKeys')
it('should preserve item data and metadata')
it('should handle undefined queryKeys gracefully')
})

    describe('removeQueryKeyFromItem', () => {
      it('should remove existing queryKey')
      it('should ignore non-existent queryKey')
      it('should preserve other queryKeys')
    })

    describe('mergeQueryKeys', () => {
      it('should merge arrays without duplicates')
      it('should handle empty arrays')
      it('should maintain order (new keys last)')
    })

    describe('findItemsByQueryKeyPattern', () => {
      it('should find items by exact queryKey match')
      it('should find items by regex pattern')
      it('should return empty array when no matches')
    })

})

1.2 Type System Updates

File: /src/data/core/types.ts
export interface CollectionItem<T = unknown> {
id: string;
updatedAt: string;
lastFetched: string;
data: T;
queryKeys: string[]; // 🆕 New field
}

// New action types
export type CollectionAction<T> =
| { type: "MARK_ITEM_STALE"; itemId: string } // 🆕
| { type: "MARK_ITEMS_STALE"; itemIds: string[] } // 🆕 Batch operation
| { type: "CLEAR_QUERY_FROM_ITEMS"; queryKey: string } // 🆕 Cleanup
// ... existing actions

Tests: Type-level tests to ensure backward compatibility

Phase 2: Core Collection Updates (2-3 days)

2.1 Collection Action Handler Updates

File: /src/data/core/createCollection.ts

New Action Handlers:
case "MARK_ITEM_STALE": {
const item = state.items.get(action.itemId);
if (!item?.queryKeys?.length) return;

    const newStale = new Set(state.stale);
    item.queryKeys.forEach(queryKey => newStale.add(queryKey));

    set(stateAtom, { ...state, stale: newStale });
    break;

}

case "MARK_ITEMS_STALE": {
const newStale = new Set(state.stale);
action.itemIds.forEach(itemId => {
const item = state.items.get(itemId);
item?.queryKeys?.forEach(queryKey => newStale.add(queryKey));
});
set(stateAtom, { ...state, stale: newStale });
break;
}

Updated Action Handlers:
case "SET_ITEM": {
const existingItem = state.items.get(action.item.id);
const updatedItem = existingItem
? addQueryKeyToItem(existingItem, action.queryKey)
: { ...action.item, queryKeys: [action.queryKey] };

    // ... rest of SET_ITEM logic

}

case "SET_ITEMS": {
const itemsWithQueryKeys = action.items.map(item => {
const existing = state.items.get(item.id);
return existing
? addQueryKeyToItem(existing, action.queryKey)
: { ...item, queryKeys: [action.queryKey] };
});

    // ... rest of SET_ITEMS logic

}

2.2 Comprehensive Tests

File: /src/data/core/**tests**/createCollection-queryKeys.test.ts
describe('createCollection - queryKeys integration', () => {
describe('SET_ITEM with queryKeys', () => {
it('should add queryKey to new item')
it('should merge queryKey with existing item')
it('should not duplicate existing queryKeys')
it('should handle item updates from different queries')
})

    describe('SET_ITEMS with queryKeys', () => {
      it('should add queryKey to all items in list')
      it('should merge with existing items that have different queryKeys')
      it('should handle mixed new/existing items')
    })

    describe('MARK_ITEM_STALE', () => {
      it('should mark all queryKeys for an item as stale')
      it('should handle item with no queryKeys gracefully')
      it('should handle non-existent item gracefully')
    })

    describe('MARK_ITEMS_STALE', () => {
      it('should mark all queryKeys for multiple items as stale')
      it('should handle mixed existing/non-existing items')
    })

    describe('CLEAR_QUERY_FROM_ITEMS', () => {
      it('should remove queryKey from all items that have it')
      it('should not affect items without the queryKey')
      it('should handle cleanup when query is deleted')
    })

})

Phase 3: Hook Integration (1-2 days)

3.1 Collection Hook Updates

Files: /src/data/hooks/useConversation.ts, /src/data/hooks/useConversations.ts

Minimal changes needed - hooks should automatically benefit from new collection behavior.

Test strategy: Verify hooks still work with new queryKeys field.

3.2 Integration Tests

File: /src/data/hooks/**tests**/queryKeys-integration.test.ts
describe('queryKeys integration with hooks', () => {
it('should track queryKeys across multiple hook instances', async () => {
// Use same conversation from multiple hooks with different query patterns
// Verify queryKeys accumulate correctly
})

    it('should invalidate all relevant queries when item marked stale', async () => {
      // Load item via multiple query patterns
      // Mark item stale by ID
      // Verify all queries refetch
    })

    it('should handle real-world scenario: onboarding → project → direct view', async () => {
      // Simulate exact user journey from requirements
      // Verify queryKeys build up correctly
      // Verify WebSocket invalidation works
    })

})

Phase 4: WebSocket Handler Integration (1 day)

4.1 WebSocket Handler Simplification

File: /src/data/websockets/handler.ts

New Approach:
private handleConversationUpdated(
event: WebSocketConversationUpdatedEvent | WebSocketConversationStatusChangedEvent
) {
console.log(`🔄 Conversation ${event.conversationId} updated`);

    if (!event.conversationId) return;

    // Simple, precise invalidation by item ID
    this.dispatchConversation({
      type: "MARK_ITEM_STALE",
      itemId: event.conversationId,
    });

}

Benefits:

- Eliminates query key guessing
- Works with any query pattern automatically
- Much simpler logic
- Self-documenting

  4.2 WebSocket Integration Tests

File: /src/data/websockets/**tests**/handler-queryKeys.test.ts
describe('WebSocket handler with queryKeys', () => {
it('should invalidate item by ID regardless of query patterns', () => {
// Setup item with multiple queryKeys
// Trigger WebSocket event
// Verify MARK_ITEM_STALE dispatched with correct itemId
})

    it('should handle multiple items updated simultaneously', () => {
      // Test batch invalidation scenarios
    })

    it('should work with real WebSocket event payloads', () => {
      // Use actual event structures from logs
    })

})

Phase 5: Migration & Backward Compatibility (1-2 days)

5.1 Migration Utilities

File: /src/data/core/migrations.ts
export function migrateCollectionItemsToQueryKeys<T>(
items: Map<string, CollectionItem<T>>
): Map<string, CollectionItem<T>> {
// Add empty queryKeys array to existing items
// This ensures graceful deployment
}

export function validateCollectionState<T>(
state: CollectionState<T>
): { isValid: boolean; errors: string[] } {
// Validate state consistency
// Ensure all items have queryKeys field
}

5.2 Runtime Migration

Strategy:

- Add queryKeys field with default empty array for existing items
- Gradually populate queryKeys as items are refetched
- No breaking changes to existing functionality

  5.3 Migration Tests

File: /src/data/core/**tests**/migrations.test.ts
describe('queryKeys migration', () => {
it('should add queryKeys to items without them')
it('should preserve existing data during migration')
it('should validate migrated state correctly')
it('should handle edge cases gracefully')
})

Phase 6: End-to-End Testing & Optimization (1-2 days)

6.1 E2E Scenario Tests

File: /src/data/**tests**/queryKeys-e2e.test.ts
describe('queryKeys end-to-end scenarios', () => {
it('should handle the onboarding user journey', async () => {
// 1. Load onboarding conversation
// 2. Verify queryKey: "conversations:org:project:onboarding:"
// 3. Navigate to project conversations
// 4. Verify queryKey added: "conversations:org:project"  
 // 5. Open conversation directly
// 6. Verify queryKey added: "conversation:org:project:convId"
// 7. Trigger WebSocket update
// 8. Verify all 3 query patterns refetch
})

    it('should handle memory cleanup correctly', async () => {
      // Test queryKey removal when queries are cleared
      // Ensure no memory leaks
    })

    it('should handle high-frequency WebSocket updates', async () => {
      // Stress test with rapid updates
      // Verify performance and correctness
    })

})

6.2 Performance Testing

File: /src/data/**tests**/queryKeys-performance.test.ts
describe('queryKeys performance', () => {
it('should scale with many queryKeys per item')
it('should handle large numbers of items efficiently')
it('should batch invalidations efficiently')
})

Phase 7: Documentation & Cleanup (1 day)

7.1 Documentation Updates

Files to update:

- Architecture documentation explaining queryKeys approach
- Collection usage examples
- WebSocket integration guide
- Migration guide for existing collections

  7.2 Debug Tooling

Enhancement: Add queryKeys to debug logging
// In collection actions
console.log(`🔄 [COLLECTION] Item ${itemId} now tracked by queries:`, item.queryKeys);

// In WebSocket handler  
 console.log(`🔄 [WEBSOCKET] Invalidating item ${itemId} will affect queries:`, item.queryKeys);

🧪 Testing Strategy Summary

Unit Tests (Most Important)

- queryKeyUtils: Pure functions, easy to test thoroughly
- Collection actions: Isolated, predictable state changes
- Migration functions: Edge cases and data integrity

Integration Tests

- Hook behavior: Ensure hooks work with new collection system
- WebSocket integration: Verify end-to-end invalidation flow

E2E Tests

- User journeys: Real-world scenarios from requirements
- Performance: Scale and memory management

Test Utilities

// Helper functions for tests
export function createMockConversationItem(id: string, queryKeys: string[]): CollectionItem<ConversationResponseDto>
export function setupCollectionWithItems<T>(items: Array<{id: string, data: T, queryKeys: string[]}>): MockCollection<T>  
 export function simulateWebSocketEvent(type: string, payload: object): void

🚦 Success Criteria

Phase Completion Criteria

1. All tests pass with >95% coverage on new code
2. No breaking changes to existing API surface
3. Performance neutral or improved compared to current system
4. Memory usage stable - queryKeys overhead minimal
5. End-to-end scenario works: Onboarding → Project → Direct view with proper invalidation

Rollback Plan

- Feature flags to disable queryKeys behavior
- Migration utilities can be reversed
- Backward compatibility ensures safe rollback

📊 Estimated Timeline: 7-10 days

- High-confidence estimates due to pure functions and isolated changes
- Parallel development possible between phases 1-3
- Incremental deployment reduces risk

⏺ This plan emphasizes:

✅ Small, pure utility functions for easy testing✅ Incremental, backward-compatible changes✅ Comprehensive test coverage at every level✅ Real-world scenario validation✅ Performance and memory considerations✅ Safe deployment with rollback options

The architecture is fundamentally sound and this phased approach minimizes risk while delivering the powerful capability you've designed.
