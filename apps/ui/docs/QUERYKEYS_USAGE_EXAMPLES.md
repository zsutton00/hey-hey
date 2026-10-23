# QueryKeys Collection Usage Examples

This guide provides practical examples of using collections with the QueryKeys architecture.

## Basic Collection Usage

### Setting up a Collection

```typescript
import { createCollection } from '../data/core/createCollection';
import type { ConversationResponseDto } from '../api';

// Create a typed collection
const conversationsCollection = createCollection<ConversationResponseDto>();
```

### Loading Data with Query Patterns

```typescript
// Load all project conversations
const projectQuery = `conversations:${orgId}:${projectId}::`;
await conversationsCollection.fetchQuery(projectQuery, (action) => {
  store.set(conversationsCollection.actionsAtom, action);
});

// Load onboarding conversations  
const onboardingQuery = `conversations:${orgId}:${projectId}:onboarding:`;
await conversationsCollection.fetchQuery(onboardingQuery, (action) => {
  store.set(conversationsCollection.actionsAtom, action);
});

// Load specific conversation
const conversationQuery = `conversation:${orgId}:${projectId}:${conversationId}`;
await conversationsCollection.fetchQuery(conversationQuery, (action) => {
  store.set(conversationsCollection.actionsAtom, action);
});
```

### Accessing Items with QueryKey Tracking

```typescript
// Get item with automatic queryKey tracking
const conversation = conversationsCollection.getItem(
  conversationId, 
  projectQuery  // QueryKey automatically added to item
);

// Item now tracks: queryKeys = ["conversations:org123:proj456::"]
```

## Hook Integration Examples

### useConversations Hook

```typescript
import { useConversations } from '../data/hooks/useConversations';

export const ConversationsPage: React.FC = () => {
  const { conversations, isLoading, error } = useConversations({
    organizationId: orgId,
    projectId: projectId,
    // Optional filters create different query patterns
    status: 'onboarding' // Creates "conversations:org:proj:onboarding:" query
  });

  if (isLoading) return <div>Loading conversations...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {conversations.map(conv => (
        <ConversationCard 
          key={conv.id} 
          conversation={conv} 
          // Each conversation automatically tracks the query that loaded it
        />
      ))}
    </div>
  );
};
```

### useConversation Hook (Single Item)

```typescript
import { useConversation } from '../data/hooks/useConversation';

export const ConversationPage: React.FC<{ conversationId: string }> = ({ 
  conversationId 
}) => {
  const { conversation, isLoading, error } = useConversation({
    conversationId,
    organizationId: orgId,
    projectId: projectId,
  });

  // This creates query: "conversation:org:proj:convId"
  // Item automatically tracks this queryKey

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <ConversationViewer conversation={conversation} />;
};
```

## Real-World User Journey Example

### Multi-Step Data Access Pattern

```typescript
// === STEP 1: User starts at onboarding ===
export const OnboardingPage: React.FC = () => {
  const { conversations } = useConversations({
    organizationId: orgId,
    projectId: projectId,
    status: 'onboarding'
  });
  
  // Query: "conversations:org:proj:onboarding:"
  // Items get: queryKeys = ["conversations:org:proj:onboarding:"]

  return (
    <div>
      {conversations.map(conv => 
        <OnboardingConversationCard key={conv.id} conversation={conv} />
      )}
    </div>
  );
};

// === STEP 2: User navigates to project conversations ===
export const ProjectPage: React.FC = () => {
  const { conversations } = useConversations({
    organizationId: orgId,
    projectId: projectId,
    // No status filter = all conversations
  });
  
  // Query: "conversations:org:proj::"
  // Same items now have: queryKeys = [
  //   "conversations:org:proj:onboarding:",
  //   "conversations:org:proj::"
  // ]

  return (
    <div>
      {conversations.map(conv => 
        <ProjectConversationCard key={conv.id} conversation={conv} />
      )}
    </div>
  );
};

// === STEP 3: User opens specific conversation ===  
export const ConversationPage: React.FC<{ conversationId: string }> = ({ 
  conversationId 
}) => {
  const { conversation } = useConversation({
    conversationId,
    organizationId: orgId,
    projectId: projectId,
  });
  
  // Query: "conversation:org:proj:convId"
  // Item now has: queryKeys = [
  //   "conversations:org:proj:onboarding:",
  //   "conversations:org:proj::",
  //   "conversation:org:proj:convId"
  // ]

  return <ConversationViewer conversation={conversation} />;
};

// === STEP 4: WebSocket update arrives ===
// WebSocket handler automatically invalidates ALL tracked queries
private handleConversationUpdated(event: WebSocketConversationUpdatedEvent) {
  // This single dispatch invalidates all 3 query patterns!
  this.dispatchConversation({
    type: "MARK_ITEM_STALE",
    itemId: event.conversationId,
  });
  
  // Result: All 3 views will refetch the updated conversation
  // - OnboardingPage → refetches onboarding query
  // - ProjectPage → refetches project query  
  // - ConversationPage → refetches conversation query
}
```

## Advanced Usage Patterns

### Custom Query Pattern Design

```typescript
// Design hierarchical, descriptive query patterns
const QueryPatterns = {
  // Organization level
  allConversations: (orgId: string) => 
    `conversations:${orgId}:::`,
  
  // Project level  
  projectConversations: (orgId: string, projectId: string) =>
    `conversations:${orgId}:${projectId}::`,
  
  // Filtered views
  onboardingConversations: (orgId: string, projectId: string) =>
    `conversations:${orgId}:${projectId}:onboarding:`,
  
  activeConversations: (orgId: string, projectId: string) =>
    `conversations:${orgId}:${projectId}:active:`,
    
  // Individual items
  specificConversation: (orgId: string, projectId: string, convId: string) =>
    `conversation:${orgId}:${projectId}:${convId}`,
};

// Usage in components
const { conversations } = useConversations({
  queryKey: QueryPatterns.onboardingConversations(orgId, projectId)
});
```

### Batch Operations

```typescript
// Mark multiple items stale efficiently
const handleMultipleConversationsUpdated = (conversationIds: string[]) => {
  store.set(conversationsCollection.actionsAtom, {
    type: "MARK_ITEMS_STALE",
    itemIds: conversationIds,
  });
  
  // All affected queries for all items will be invalidated
};

// Batch create items with queryKeys
const handleBulkImport = async (conversations: ConversationResponseDto[]) => {
  const queryKey = QueryPatterns.projectConversations(orgId, projectId);
  
  store.set(conversationsCollection.actionsAtom, {
    type: "SET_ITEMS", 
    items: conversations,
    queryKey: queryKey,
  });
  
  // All items automatically get the queryKey
};
```

### Memory Management

```typescript
// Clear unused queries and cleanup queryKeys
const handleProjectSwitch = (newProjectId: string) => {
  // Clear old project queries
  const oldProjectQuery = QueryPatterns.projectConversations(orgId, oldProjectId);
  
  store.set(conversationsCollection.actionsAtom, {
    type: "CLEAR_QUERY",
    queryKey: oldProjectQuery,
  });
  
  // Items that were only loaded by this query are removed
  // Items loaded by other queries have this queryKey removed
};
```

## Testing Collection Usage

### Unit Testing with QueryKeys

```typescript
import { createMockCollectionState } from '../data/__tests__/helpers';

describe('ConversationPage', () => {
  it('should load conversation with correct queryKey', async () => {
    const mockCollection = createMockCollectionState();
    const conversationId = 'conv-123';
    const expectedQueryKey = `conversation:org:proj:${conversationId}`;
    
    // Mock the collection to track queryKeys
    const mockFetchQuery = vi.fn();
    mockCollection.fetchQuery = mockFetchQuery;
    
    render(<ConversationPage conversationId={conversationId} />);
    
    await waitFor(() => {
      expect(mockFetchQuery).toHaveBeenCalledWith(
        expectedQueryKey,
        expect.any(Function)
      );
    });
    
    // Verify item has correct queryKey after loading
    const item = mockCollection.getItem(conversationId, expectedQueryKey);
    expect(item?.queryKeys).toContain(expectedQueryKey);
  });
});
```

### Integration Testing

```typescript
describe('Multi-step conversation access', () => {
  it('should accumulate queryKeys across different views', async () => {
    const conversationId = 'conv-123';
    const orgId = 'org-456';
    const projectId = 'proj-789';
    
    // Step 1: Load from onboarding
    const onboardingQuery = `conversations:${orgId}:${projectId}:onboarding:`;
    await collection.fetchQuery(onboardingQuery, mockDispatch);
    
    let item = collection.getItem(conversationId);
    expect(item?.queryKeys).toEqual([onboardingQuery]);
    
    // Step 2: Load from project view  
    const projectQuery = `conversations:${orgId}:${projectId}::`;
    await collection.fetchQuery(projectQuery, mockDispatch);
    
    item = collection.getItem(conversationId, projectQuery);
    expect(item?.queryKeys).toEqual([onboardingQuery, projectQuery]);
    
    // Step 3: WebSocket invalidation should affect both queries
    mockDispatch({
      type: "MARK_ITEM_STALE",
      itemId: conversationId,
    });
    
    const state = store.get(collection.stateAtom);
    expect(state.stale.has(onboardingQuery)).toBe(true);
    expect(state.stale.has(projectQuery)).toBe(true);
  });
});
```

## Error Handling

### Graceful Degradation

```typescript
export const ConversationsList: React.FC = () => {
  const { conversations, isLoading, error } = useConversations({
    organizationId: orgId,
    projectId: projectId,
  });

  // Handle different error states
  if (error) {
    console.error('Failed to load conversations:', error);
    
    // Check if it's a queryKeys migration issue
    if (error.message.includes('queryKeys')) {
      return (
        <div>
          Data migration in progress. Please refresh the page.
          <button onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      );
    }
    
    return <div>Failed to load conversations. Please try again.</div>;
  }

  if (isLoading) return <div>Loading conversations...</div>;

  return (
    <div>
      {conversations.map(conv => (
        <ConversationCard key={conv.id} conversation={conv} />
      ))}
    </div>
  );
};
```

### Migration Error Recovery

```typescript
import { validateCollectionState } from '../data/core/migration';

// Check collection health during development
const debugCollectionState = () => {
  const state = store.get(conversationsCollection.stateAtom);
  const validation = validateCollectionState(
    state.items,
    state.listQueries, 
    state.singleQueries
  );
  
  if (!validation.isValid) {
    console.warn('Collection validation failed:', validation.errors);
    
    // Trigger migration if needed
    store.set(conversationsCollection.actionsAtom, {
      type: "MIGRATE_STATE"
    });
  }
};
```

## Performance Optimization

### Efficient Query Patterns

```typescript
// ✅ Good: Hierarchical, cacheable patterns
const efficientPatterns = {
  allProjects: `conversations:${orgId}:::`,
  projectConversations: `conversations:${orgId}:${projectId}::`,  
  categoryConversations: `conversations:${orgId}:${projectId}:${category}:`,
};

// ❌ Avoid: Dynamic patterns that don't cache well
const inefficientPatterns = {
  userSpecificQuery: `conversations:${orgId}:${projectId}:user-${userId}:time-${timestamp}`,
  tooSpecificQuery: `conversations:${orgId}:${projectId}:page-${page}:sort-${sort}:filter-${filter}`,
};
```

### Memory Usage Monitoring

```typescript
import { inspectCollectionMigrationState } from '../data/core/migration';

// Monitor queryKeys memory usage
const monitorMemoryUsage = () => {
  const state = store.get(conversationsCollection.stateAtom);
  const inspection = inspectCollectionMigrationState(
    state.items,
    state.listQueries,
    state.singleQueries
  );
  
  console.log(`Total items: ${inspection.totalItems}`);
  console.log(`QueryKey distribution:`, inspection.queryKeyDistribution);
  
  // Alert if queryKeys per item is unusually high
  const avgQueryKeysPerItem = Object.values(inspection.queryKeyDistribution)
    .reduce((sum, count) => sum + count, 0) / inspection.totalItems;
    
  if (avgQueryKeysPerItem > 10) {
    console.warn(`High queryKeys per item: ${avgQueryKeysPerItem}`);
  }
};
```

This comprehensive usage guide shows how to effectively use collections with the QueryKeys architecture for robust, scalable data management.