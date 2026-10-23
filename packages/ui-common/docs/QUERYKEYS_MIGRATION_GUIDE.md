# QueryKeys Migration Guide for Existing Collections

This guide provides step-by-step instructions for migrating existing collections to use the QueryKeys architecture.

## Migration Overview

The QueryKeys migration is designed to be **backward compatible** and **zero-downtime**. Existing collections will continue to work while gradually adopting queryKeys functionality.

### Migration Phases

1. **Phase 1**: Automatic migration of existing items (adds empty queryKeys arrays)
2. **Phase 2**: Gradual population of queryKeys as items are accessed  
3. **Phase 3**: Full queryKeys functionality with enhanced invalidation

## Pre-Migration Checklist

Before starting the migration, ensure:

- [ ] All tests pass on current codebase
- [ ] Collection state is healthy (no corruption)
- [ ] Backup of current collection data (if applicable)
- [ ] Understanding of existing query patterns in your app

### Assess Current Collection Health

```typescript
import { validateCollectionState } from '../data/core/migration';

// Check collection health before migration
const assessCollectionHealth = () => {
  const conversationState = store.get(conversationsCollection.stateAtom);
  
  console.log(`📊 Collection Health Assessment:`);
  console.log(`- Total items: ${conversationState.items.size}`);
  console.log(`- List queries: ${conversationState.listQueries.size}`);
  console.log(`- Single queries: ${conversationState.singleQueries.size}`);
  console.log(`- Stale queries: ${conversationState.stale.size}`);
  
  // Check for any obvious issues
  const hasOrphanedQueries = Array.from(conversationState.listQueries.values())
    .flat()
    .some(itemId => !conversationState.items.has(itemId));
    
  if (hasOrphanedQueries) {
    console.warn(`⚠️ Found orphaned query references - may need cleanup`);
  }
};

// Run before migration
assessCollectionHealth();
```

## Step 1: Update Type Definitions

### Add QueryKeys to CollectionItem

```typescript
// src/data/core/types.ts

// ✅ Updated interface (backward compatible)
export interface CollectionItem<T = unknown> {
  id: string;
  updatedAt: string;
  lastFetched: string;
  data: T;
  queryKeys: string[]; // 🆕 New required field
}

// ✅ New action types for migration
export type CollectionAction<T> =
  | { type: "SET_ITEM"; item: CollectionItem<T>; queryKey: string }
  | { type: "SET_ITEMS"; items: CollectionItem<T>[]; queryKey: string }
  | { type: "MARK_ITEM_STALE"; itemId: string }
  | { type: "MARK_ITEMS_STALE"; itemIds: string[] }
  | { type: "MIGRATE_STATE" }
  | { type: "MIGRATE_ITEM_QUERY_KEYS"; itemId: string; migratedItem: CollectionItem<T> }
  // ... existing actions
```

### Update Collection Actions

```typescript
// src/data/core/createCollection.ts

// Add migration action handlers
export function createCollectionReducer<T>() {
  return (
    get: Getter,
    set: Setter,
    stateAtom: WritableAtom<CollectionState<T>, [CollectionAction<T>], void>
  ) => (action: CollectionAction<T>) => {
    const state = get(stateAtom);

    switch (action.type) {
      // 🆕 New migration actions
      case "MIGRATE_STATE": {
        console.log(`🔄 [COLLECTION] Running runtime migration`);
        
        const migrationResult = performRuntimeMigration(
          state.items,
          state.listQueries,
          state.singleQueries
        );
        
        if (migrationResult.migrationPerformed) {
          console.log(`✅ [COLLECTION] Migration completed - ${migrationResult.items.size} items updated`);
          set(stateAtom, { ...state, items: migrationResult.items });
        }
        
        if (!migrationResult.validationResult.isValid) {
          console.warn(`⚠️ [COLLECTION] Validation failed:`, migrationResult.validationResult.errors);
        }
        break;
      }
      
      case "MIGRATE_ITEM_QUERY_KEYS": {
        const newItems = new Map(state.items);
        newItems.set(action.itemId, action.migratedItem);
        set(stateAtom, { ...state, items: newItems });
        break;
      }
      
      // ✅ Enhanced existing actions
      case "MARK_ITEM_STALE": {
        const item = state.items.get(action.itemId);
        if (!item?.queryKeys?.length) {
          console.warn(`⚠️ [COLLECTION] Item ${action.itemId} has no queryKeys - cannot mark stale`);
          return;
        }

        const newStale = new Set(state.stale);
        item.queryKeys.forEach(queryKey => {
          newStale.add(queryKey);
          console.log(`🔄 [COLLECTION] Marked query stale: ${queryKey}`);
        });

        set(stateAtom, { ...state, stale: newStale });
        break;
      }
      
      // ... rest of existing actions
    }
  };
}
```

## Step 2: Implement Migration Utilities

The migration utilities are already implemented in `src/data/core/migration.ts`. Here's how to use them:

### Automatic State Migration

```typescript
// src/data/core/createCollection.ts

export function createCollection<T>(): Collection<T> {
  const stateAtom = atom<CollectionState<T>>({
    items: new Map(),
    listQueries: new Map(),
    singleQueries: new Map(),
    stale: new Set(),
  });

  const actionsAtom = atom(null, createCollectionReducer<T>()(get, set, stateAtom));

  // 🆕 Initialize with migration check
  const initializeCollection = () => {
    const state = store.get(stateAtom);
    
    // Check if migration is needed
    const needsMigration = Array.from(state.items.values())
      .some(item => !hasQueryKeysField(item));
      
    if (needsMigration) {
      console.log(`🔄 [COLLECTION] Auto-migration needed - ${state.items.size} items`);
      store.set(actionsAtom, { type: "MIGRATE_STATE" });
    }
  };

  // Auto-initialize on first access
  let initialized = false;
  const ensureInitialized = () => {
    if (!initialized) {
      initializeCollection();
      initialized = true;
    }
  };

  return {
    stateAtom,
    actionsAtom,
    
    // Enhanced methods with migration support
    getItem: (itemId: string, queryKey?: string) => {
      ensureInitialized();
      const state = store.get(stateAtom);
      const items = state.items;
      
      if (!queryKey) {
        return items.get(itemId);
      }
      
      // Use migrating getter for queryKey tracking
      const migratingGetter = createMigratingItemGetter(
        items, 
        (action) => store.set(actionsAtom, action)
      );
      
      return migratingGetter(itemId, queryKey);
    },
    
    // ... rest of collection methods
  };
}
```

## Step 3: Update Hook Integration

### Migrate useConversations Hook

```typescript
// src/data/hooks/useConversations.ts

export function useConversations(options?: {
  organizationId?: string;
  projectId?: string;
  status?: string;
}) {
  const { organizationId, projectId, status } = options || {};
  
  // ✅ Construct queryKey consistently
  const queryKey = useMemo(() => {
    if (!organizationId || !projectId) return null;
    
    let key = `conversations:${organizationId}:${projectId}:`;
    if (status) {
      key += `${status}:`;
    } else {
      key += `:`;
    }
    return key;
  }, [organizationId, projectId, status]);

  // ✅ Use collection with queryKey tracking
  const conversations = useAtomValue(
    useMemo(() => {
      if (!queryKey) return atom([]);
      
      return atom((get) => {
        const state = get(conversationsCollection.stateAtom);
        const itemIds = state.listQueries.get(queryKey) || [];
        
        // Use migrating getter to ensure queryKeys are tracked
        return itemIds
          .map(id => conversationsCollection.getItem(id, queryKey))
          .filter((item): item is CollectionItem<ConversationResponseDto> => !!item)
          .map(item => item.data);
      });
    }, [queryKey])
  );

  // Enhanced loading/error states with migration awareness
  const { isLoading, error } = useQueryState(queryKey);
  
  return { conversations, isLoading, error, queryKey };
}
```

### Migrate useConversation Hook

```typescript
// src/data/hooks/useConversation.ts

export function useConversation(options: {
  conversationId: string;
  organizationId: string;
  projectId: string;
}) {
  const { conversationId, organizationId, projectId } = options;
  
  // ✅ Single item query pattern
  const queryKey = `conversation:${organizationId}:${projectId}:${conversationId}`;
  
  const conversation = useAtomValue(
    useMemo(() => {
      return atom((get) => {
        // Use collection's migrating getter
        const item = conversationsCollection.getItem(conversationId, queryKey);
        return item?.data;
      });
    }, [conversationId, queryKey])
  );

  const { isLoading, error } = useQueryState(queryKey);
  
  return { conversation, isLoading, error, queryKey };
}
```

## Step 4: Update Data Creation Points

### Migrate useConversationCache Hook

```typescript
// src/data/hooks/useConversationCache.ts

export const useConversationCache = () => {
  const dispatch = useSetAtom(conversationsCollection.actionsAtom);

  const cacheConversation = useCallback((
    conversationId: string,
    newData: ConversationResponseDto,
    queryKey: string // 🆕 Now required
  ) => {
    console.log(`💾 [CACHE] Caching conversation ${conversationId} for query: ${queryKey}`);

    // ✅ Create item with queryKeys from the start
    const item = ensureQueryKeys({
      id: conversationId,
      data: newData,
      lastFetched: new Date().toISOString(),
      updatedAt: newData.updatedAt || new Date().toISOString(),
    }, queryKey);

    dispatch({
      type: "SET_ITEM",
      item,
      queryKey, // Collection will ensure this queryKey is tracked
    });
  }, [dispatch]);

  return { cacheConversation };
};
```

## Step 5: Gradual Migration Testing

### Verify Migration Progress

```typescript
// src/data/__tests__/migration-progress.test.ts

describe('Migration Progress Tracking', () => {
  it('should track migration completion over time', async () => {
    const collection = createCollection<TestData>();
    
    // Start with legacy items (no queryKeys)
    const legacyItems = [
      createLegacyItem('item-1'),
      createLegacyItem('item-2'),
      createLegacyItem('item-3'),
    ];
    
    // Add legacy items to collection (simulates existing data)
    legacyItems.forEach(item => {
      store.get(collection.stateAtom).items.set(item.id, item as CollectionItem<TestData>);
    });
    
    // Track migration progress
    let migrationState = inspectCollectionMigrationState(
      store.get(collection.stateAtom).items,
      new Map(),
      new Map()
    );
    
    expect(migrationState.itemsNeedingMigration).toBe(3);
    expect(migrationState.itemsWithQueryKeys).toBe(0);
    
    // Access items gradually (triggers migration)
    const item1 = collection.getItem('item-1', 'query-1');
    migrationState = inspectCollectionMigrationState(
      store.get(collection.stateAtom).items,
      new Map([['query-1', ['item-1']]]),
      new Map()
    );
    
    expect(migrationState.itemsNeedingMigration).toBe(2);
    expect(migrationState.itemsWithQueryKeys).toBe(1);
    
    // Continue until full migration
    collection.getItem('item-2', 'query-2');
    collection.getItem('item-3', 'query-3');
    
    migrationState = inspectCollectionMigrationState(
      store.get(collection.stateAtom).items,
      new Map([
        ['query-1', ['item-1']],
        ['query-2', ['item-2']],
        ['query-3', ['item-3']]
      ]),
      new Map()
    );
    
    expect(migrationState.itemsNeedingMigration).toBe(0);
    expect(migrationState.itemsWithQueryKeys).toBe(3);
  });
});
```

## Step 6: WebSocket Handler Migration

### Update Handler to Use Item-Based Invalidation

```typescript
// src/data/websockets/handler.ts

export class WebSocketHandler {
  // ✅ Updated handler methods
  private handleConversationUpdated(event: WebSocketConversationUpdatedEvent) {
    console.log(`🔄 [WEBSOCKET] Conversation ${event.conversationId} updated`);
    
    if (!event.conversationId) return;

    // 🆕 Simple item-based invalidation (replaces manual pattern guessing)
    this.dispatchConversation({
      type: "MARK_ITEM_STALE",
      itemId: event.conversationId,
    });
    
    // 🆕 Optional: Log affected queries in development
    if (process.env.NODE_ENV === 'development') {
      this.logAffectedQueries(event.conversationId);
    }
  }

  private logAffectedQueries(itemId: string) {
    const state = store.get(conversationsCollection.stateAtom);
    const item = state.items.get(itemId);
    
    if (item?.queryKeys?.length) {
      console.log(`🐛 [WEBSOCKET] Item ${itemId} will invalidate queries:`, item.queryKeys);
    } else {
      console.log(`🐛 [WEBSOCKET] Item ${itemId} has no queryKeys - may need migration`);
    }
  }
}
```

## Migration Validation

### Comprehensive Validation Script

```typescript
// src/data/migration/validate.ts

export function validateMigration() {
  console.log(`🔍 Running migration validation...`);
  
  // Check conversations collection
  const conversationState = store.get(conversationsCollection.stateAtom);
  const conversationValidation = validateCollectionState(
    conversationState.items,
    conversationState.listQueries,
    conversationState.singleQueries
  );
  
  console.log(`📊 Conversations Collection:`);
  console.log(`- Valid: ${conversationValidation.isValid}`);
  console.log(`- Errors: ${conversationValidation.errors.length}`);
  
  if (conversationValidation.errors.length > 0) {
    console.error(`❌ Validation errors:`, conversationValidation.errors);
  }
  
  // Check migration completeness
  const inspection = inspectCollectionMigrationState(
    conversationState.items,
    conversationState.listQueries,
    conversationState.singleQueries
  );
  
  console.log(`📈 Migration Progress:`);
  console.log(`- Total items: ${inspection.totalItems}`);
  console.log(`- Items with queryKeys: ${inspection.itemsWithQueryKeys}`);
  console.log(`- Items needing migration: ${inspection.itemsNeedingMigration}`);
  console.log(`- QueryKey distribution:`, inspection.queryKeyDistribution);
  
  if (inspection.orphanedItems.length > 0) {
    console.warn(`⚠️ Orphaned items (not referenced by queries):`, inspection.orphanedItems);
  }
  
  if (inspection.missingItems.length > 0) {
    console.warn(`⚠️ Missing items (referenced but don't exist):`, inspection.missingItems);
  }
  
  const migrationPercent = inspection.totalItems > 0 
    ? (inspection.itemsWithQueryKeys / inspection.totalItems) * 100 
    : 100;
    
  console.log(`✅ Migration ${migrationPercent.toFixed(1)}% complete`);
  
  return {
    isValid: conversationValidation.isValid,
    migrationPercent,
    errors: conversationValidation.errors,
    inspection,
  };
}

// Run validation periodically during migration
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    validateMigration();
  }, 60000); // Every minute
}
```

## Rollback Strategy

### Safe Rollback Preparation

```typescript
// src/data/migration/rollback.ts

export function prepareRollback() {
  console.log(`🔄 Preparing rollback utilities...`);
  
  // Create rollback utilities that can remove queryKeys if needed
  const rollbackMigration = () => {
    console.warn(`⚠️ Rolling back queryKeys migration...`);
    
    const state = store.get(conversationsCollection.stateAtom);
    const rolledBackItems = new Map();
    
    // Remove queryKeys from all items
    for (const [itemId, item] of state.items) {
      const { queryKeys, ...itemWithoutQueryKeys } = item;
      rolledBackItems.set(itemId, itemWithoutQueryKeys);
    }
    
    // Update collection state
    store.set(conversationsCollection.stateAtom, {
      ...state,
      items: rolledBackItems,
    });
    
    console.log(`✅ Rollback completed - queryKeys removed from ${rolledBackItems.size} items`);
  };
  
  // Export rollback function for emergency use
  (window as any).__rollbackQueryKeysMigration = rollbackMigration;
  
  console.log(`✅ Rollback function available at window.__rollbackQueryKeysMigration`);
}

// Prepare rollback in development
if (process.env.NODE_ENV === 'development') {
  prepareRollback();
}
```

## Production Deployment Checklist

### Pre-Deployment

- [ ] All tests pass with queryKeys changes
- [ ] Migration utilities tested with real data shapes
- [ ] WebSocket handlers updated to use MARK_ITEM_STALE
- [ ] Hooks updated to provide queryKey parameters
- [ ] Validation script confirms migration readiness

### During Deployment

- [ ] Deploy with feature flag (if available) to enable queryKeys gradually
- [ ] Monitor migration progress via validation script
- [ ] Watch for WebSocket invalidation working correctly
- [ ] Verify no performance degradation

### Post-Deployment

- [ ] Run validation script to confirm migration success
- [ ] Monitor WebSocket event processing
- [ ] Check for any errors in browser console
- [ ] Verify cache invalidation is working across all query patterns

### Success Metrics

✅ **Migration completion**: 100% of items have queryKeys field  
✅ **Validation success**: No validation errors in collection state  
✅ **WebSocket invalidation**: All affected queries invalidated correctly  
✅ **Performance**: No degradation in app performance  
✅ **Zero downtime**: App continues working throughout migration  

## Common Migration Issues

### Issue 1: Items Missing QueryKeys

**Symptom**: WebSocket events don't invalidate caches
**Cause**: Items still missing queryKeys field
**Solution**: 
```typescript
// Force migration
store.set(conversationsCollection.actionsAtom, { type: "MIGRATE_STATE" });

// Or access items to trigger gradual migration
const item = collection.getItem(itemId, queryKey);
```

### Issue 2: Query Patterns Don't Match

**Symptom**: Items have queryKeys but queries still stale
**Cause**: Query pattern mismatch between hook and WebSocket
**Solution**: Standardize query pattern generation
```typescript
const QueryPatterns = {
  conversations: (orgId, projectId, status?) => 
    `conversations:${orgId}:${projectId}:${status || ''}:`,
};
```

### Issue 3: Over-Migration

**Symptom**: Items accumulate too many queryKeys
**Cause**: Same item accessed from too many different query patterns
**Solution**: Review query pattern design for better reuse
```typescript
// Instead of many specific patterns
const tooSpecific = `conversations:org:proj:user123:page1:sort-date:`;

// Use broader, reusable patterns
const betterPattern = `conversations:org:proj::`;
```

## Advanced Migration Scenarios

### Migrating Complex Collections

```typescript
// For collections with nested relationships
export function migrateNestedCollection<T>() {
  const collection = createCollection<T>();
  
  // Enhanced migration for items with references to other items
  const migrateWithReferences = (item: CollectionItem<T>, queryKey: string) => {
    const migratedItem = ensureQueryKeys(item, queryKey);
    
    // Handle nested references if your data has them
    if (item.data && typeof item.data === 'object' && 'references' in item.data) {
      // Migrate referenced items too
      const references = (item.data as any).references || [];
      references.forEach((refId: string) => {
        collection.getItem(refId, queryKey); // Triggers migration
      });
    }
    
    return migratedItem;
  };
  
  return { ...collection, migrateWithReferences };
}
```

The QueryKeys migration is designed to be safe, gradual, and backward-compatible. Follow this guide step-by-step, and your existing collections will seamlessly gain the benefits of automatic query invalidation.