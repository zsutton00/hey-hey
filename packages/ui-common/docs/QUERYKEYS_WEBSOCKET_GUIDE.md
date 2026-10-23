# WebSocket Integration Guide for QueryKeys Architecture

This guide shows how to integrate WebSocket handlers with the QueryKeys architecture for automatic, pattern-agnostic cache invalidation.

## Overview

The QueryKeys architecture eliminates the need for WebSocket handlers to guess which query patterns to invalidate. Instead, handlers simply identify items by ID, and the system automatically invalidates all queries that loaded those items.

## Before and After Comparison

### Before QueryKeys (Manual Pattern Guessing)

```typescript
// ❌ OLD: Manual query pattern guessing
private handleConversationUpdated(event: WebSocketConversationUpdatedEvent) {
  console.log(`🔄 Conversation updated: ${event.conversationId}`);
  
  if (!event.conversationId) return;
  
  // Manual guessing of all possible query patterns
  const orgId = this.getCurrentOrgId();
  const projectId = this.getCurrentProjectId();
  
  // Have to guess every possible query pattern
  this.dispatchConversation({
    type: "MARK_STALE",
    queryKey: `conversations:${orgId}:${projectId}::`
  });
  
  this.dispatchConversation({
    type: "MARK_STALE", 
    queryKey: `conversations:${orgId}:${projectId}:onboarding:`
  });
  
  this.dispatchConversation({
    type: "MARK_STALE",
    queryKey: `conversations:${orgId}:${projectId}:active:`
  });
  
  this.dispatchConversation({
    type: "MARK_STALE",
    queryKey: `conversation:${orgId}:${projectId}:${event.conversationId}`
  });
  
  // Easy to miss new patterns as app evolves!
  // Brittle and error-prone
}
```

**Problems:**
- Have to manually track every possible query pattern
- Easy to miss new patterns as app evolves  
- Brittle - adding new views requires updating WebSocket handlers
- Over-invalidation when guessing too broadly
- Under-invalidation when missing specific patterns

### After QueryKeys (Automatic Invalidation)

```typescript
// ✅ NEW: Simple, automatic invalidation
private handleConversationUpdated(event: WebSocketConversationUpdatedEvent) {
  console.log(`🔄 Conversation updated: ${event.conversationId}`);
  
  if (!event.conversationId) return;
  
  // Simple, precise invalidation by item ID only
  this.dispatchConversation({
    type: "MARK_ITEM_STALE",
    itemId: event.conversationId,
  });
  
  // The system automatically invalidates ALL queries that loaded this item!
}
```

**Benefits:**
- Only need the item ID from WebSocket event
- Automatically invalidates all relevant query patterns
- Self-healing as new query patterns are added
- Precise - no over/under-invalidation
- Maintainable - no manual pattern tracking

## Complete WebSocket Handler Implementation

### Core Handler Structure

```typescript
// src/data/websockets/handler.ts

export class WebSocketHandler {
  private dispatchConversation: (action: CollectionAction<ConversationResponseDto>) => void;
  private dispatchProject: (action: CollectionAction<ProjectResponseDto>) => void;

  constructor(
    private conversationDispatch: (action: CollectionAction<ConversationResponseDto>) => void,
    private projectDispatch: (action: CollectionAction<ProjectResponseDto>) => void,
  ) {
    this.dispatchConversation = conversationDispatch;
    this.dispatchProject = projectDispatch;
  }

  public handleWebSocketMessage = (event: WebSocketEvent) => {
    console.log(`📨 [WEBSOCKET] Received event:`, event.type);
    
    try {
      switch (event.type) {
        case 'conversation_updated':
          this.handleConversationUpdated(event as WebSocketConversationUpdatedEvent);
          break;
          
        case 'conversation_status_changed':
          this.handleConversationStatusChanged(event as WebSocketConversationStatusChangedEvent);
          break;
          
        case 'project_updated':
          this.handleProjectUpdated(event as WebSocketProjectUpdatedEvent);
          break;
          
        case 'bulk_conversation_update':
          this.handleBulkConversationUpdate(event as WebSocketBulkConversationUpdateEvent);
          break;
          
        default:
          console.log(`⚠️ [WEBSOCKET] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`❌ [WEBSOCKET] Error handling event:`, error);
    }
  };

  // === CONVERSATION EVENTS ===
  
  private handleConversationUpdated(event: WebSocketConversationUpdatedEvent) {
    console.log(`🔄 [WEBSOCKET] Conversation ${event.conversationId} updated`);
    
    if (!event.conversationId) {
      console.warn(`⚠️ [WEBSOCKET] Missing conversationId in update event`);
      return;
    }

    // Simple item-based invalidation
    this.dispatchConversation({
      type: "MARK_ITEM_STALE",
      itemId: event.conversationId,
    });
    
    // Optional: Log which queries will be affected (for debugging)
    this.logAffectedQueries('conversation', event.conversationId);
  }

  private handleConversationStatusChanged(event: WebSocketConversationStatusChangedEvent) {
    console.log(`📊 [WEBSOCKET] Conversation ${event.conversationId} status changed to: ${event.status}`);
    
    if (!event.conversationId) {
      console.warn(`⚠️ [WEBSOCKET] Missing conversationId in status change event`);
      return;
    }

    // Same simple invalidation - works for status changes too
    this.dispatchConversation({
      type: "MARK_ITEM_STALE", 
      itemId: event.conversationId,
    });
  }

  private handleBulkConversationUpdate(event: WebSocketBulkConversationUpdateEvent) {
    console.log(`🔄 [WEBSOCKET] Bulk update for ${event.conversationIds?.length} conversations`);
    
    if (!event.conversationIds?.length) {
      console.warn(`⚠️ [WEBSOCKET] Missing conversationIds in bulk update event`);
      return;
    }

    // Efficient batch invalidation
    this.dispatchConversation({
      type: "MARK_ITEMS_STALE",
      itemIds: event.conversationIds,
    });
    
    console.log(`✅ [WEBSOCKET] Marked ${event.conversationIds.length} conversations stale`);
  }

  // === PROJECT EVENTS ===
  
  private handleProjectUpdated(event: WebSocketProjectUpdatedEvent) {
    console.log(`🏗️ [WEBSOCKET] Project ${event.projectId} updated`);
    
    if (!event.projectId) {
      console.warn(`⚠️ [WEBSOCKET] Missing projectId in update event`);
      return;
    }

    // Same pattern for projects
    this.dispatchProject({
      type: "MARK_ITEM_STALE",
      itemId: event.projectId,
    });
  }

  // === DEBUGGING UTILITIES ===
  
  private logAffectedQueries(itemType: string, itemId: string) {
    // In development, log which queries would be affected
    if (process.env.NODE_ENV === 'development') {
      // This would require access to collection state for full debugging
      console.log(`🐛 [WEBSOCKET] ${itemType} ${itemId} invalidation will affect all queries that loaded this item`);
    }
  }
}
```

### Event Type Definitions

```typescript
// src/data/websockets/types.ts

export interface WebSocketBaseEvent {
  type: string;
  timestamp: string;
  organizationId: string;
  projectId?: string;
}

export interface WebSocketConversationUpdatedEvent extends WebSocketBaseEvent {
  type: 'conversation_updated';
  conversationId: string;
  data?: Partial<ConversationResponseDto>;
}

export interface WebSocketConversationStatusChangedEvent extends WebSocketBaseEvent {
  type: 'conversation_status_changed';
  conversationId: string;
  status: string;
  previousStatus?: string;
}

export interface WebSocketBulkConversationUpdateEvent extends WebSocketBaseEvent {
  type: 'bulk_conversation_update';
  conversationIds: string[];
  updateType: 'status_change' | 'data_update' | 'metadata_update';
}

export interface WebSocketProjectUpdatedEvent extends WebSocketBaseEvent {
  type: 'project_updated';
  projectId: string;
  data?: Partial<ProjectResponseDto>;
}

export type WebSocketEvent = 
  | WebSocketConversationUpdatedEvent
  | WebSocketConversationStatusChangedEvent  
  | WebSocketBulkConversationUpdateEvent
  | WebSocketProjectUpdatedEvent;
```

## Integration with Collections

### Connecting WebSocket Handler to Collections

```typescript
// src/data/websockets/service.ts

import { store } from '../store';
import { conversationsCollection, projectsCollection } from '../collections';
import { WebSocketHandler } from './handler';

class WebSocketService {
  private handler: WebSocketHandler;
  private socket: WebSocket | null = null;

  constructor() {
    // Connect handler to collection dispatch functions
    this.handler = new WebSocketHandler(
      (action) => store.set(conversationsCollection.actionsAtom, action),
      (action) => store.set(projectsCollection.actionsAtom, action),
    );
  }

  connect(url: string) {
    this.socket = new WebSocket(url);
    
    this.socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handler.handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    this.socket.addEventListener('open', () => {
      console.log('🔌 [WEBSOCKET] Connected');
    });

    this.socket.addEventListener('close', () => {
      console.log('🔌 [WEBSOCKET] Disconnected'); 
      this.handleReconnection();
    });

    this.socket.addEventListener('error', (error) => {
      console.error('❌ [WEBSOCKET] Connection error:', error);
    });
  }

  private handleReconnection() {
    // Implement reconnection logic
    setTimeout(() => {
      if (this.socket?.readyState === WebSocket.CLOSED) {
        console.log('🔄 [WEBSOCKET] Attempting to reconnect...');
        this.connect(this.socket.url);
      }
    }, 5000);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export const webSocketService = new WebSocketService();
```

### Advanced Event Patterns

### Handling Complex Updates

```typescript
// Handle events that affect multiple item types
private handleWorkflowCompleted(event: WebSocketWorkflowCompletedEvent) {
  console.log(`✅ [WEBSOCKET] Workflow completed: ${event.workflowId}`);
  
  // A workflow completion might affect multiple conversations and the project
  if (event.affectedConversationIds?.length) {
    this.dispatchConversation({
      type: "MARK_ITEMS_STALE",
      itemIds: event.affectedConversationIds,
    });
  }
  
  if (event.projectId) {
    this.dispatchProject({
      type: "MARK_ITEM_STALE", 
      itemId: event.projectId,
    });
  }
  
  console.log(`✅ [WEBSOCKET] Invalidated ${event.affectedConversationIds?.length} conversations and 1 project`);
}

// Handle partial data updates
private handleConversationPartialUpdate(event: WebSocketConversationPartialUpdateEvent) {
  console.log(`🔄 [WEBSOCKET] Partial update for conversation ${event.conversationId}`);
  
  if (!event.conversationId) return;
  
  if (event.partialData) {
    // Optimistically update the item data before invalidating
    this.dispatchConversation({
      type: "UPDATE_ITEM_DATA",
      itemId: event.conversationId,
      partialData: event.partialData,
    });
  }
  
  // Still mark stale to trigger refetch and validation
  this.dispatchConversation({
    type: "MARK_ITEM_STALE",
    itemId: event.conversationId,
  });
}
```

### Error Handling and Recovery

```typescript
// Robust error handling for WebSocket events
private handleWebSocketError(event: WebSocketEvent, error: Error) {
  console.error(`❌ [WEBSOCKET] Error processing ${event.type}:`, error);
  
  // Log event details for debugging
  console.error(`Event data:`, JSON.stringify(event, null, 2));
  
  // For critical errors, mark broader queries stale as fallback
  if (event.type.includes('conversation') && 'conversationId' in event) {
    console.log(`🔄 [WEBSOCKET] Fallback: marking conversation ${event.conversationId} stale`);
    
    try {
      this.dispatchConversation({
        type: "MARK_ITEM_STALE",
        itemId: event.conversationId,
      });
    } catch (fallbackError) {
      console.error(`❌ [WEBSOCKET] Fallback also failed:`, fallbackError);
    }
  }
}

// Connection health monitoring
private monitorConnectionHealth() {
  setInterval(() => {
    if (this.socket?.readyState === WebSocket.OPEN) {
      // Send ping to check connection
      this.socket.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000); // Every 30 seconds
}
```

## Testing WebSocket Integration

### Unit Testing WebSocket Handlers

```typescript
// src/data/websockets/__tests__/handler.test.ts

import { WebSocketHandler } from '../handler';
import { vi } from 'vitest';

describe('WebSocketHandler with QueryKeys', () => {
  let handler: WebSocketHandler;
  let mockConversationDispatch: ReturnType<typeof vi.fn>;
  let mockProjectDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConversationDispatch = vi.fn();
    mockProjectDispatch = vi.fn();
    handler = new WebSocketHandler(mockConversationDispatch, mockProjectDispatch);
  });

  it('should dispatch MARK_ITEM_STALE for conversation updates', () => {
    const event = {
      type: 'conversation_updated',
      conversationId: 'conv-123',
      timestamp: new Date().toISOString(),
      organizationId: 'org-456',
    };

    handler.handleWebSocketMessage(event);

    expect(mockConversationDispatch).toHaveBeenCalledWith({
      type: 'MARK_ITEM_STALE',
      itemId: 'conv-123',
    });
  });

  it('should dispatch MARK_ITEMS_STALE for bulk updates', () => {
    const event = {
      type: 'bulk_conversation_update',
      conversationIds: ['conv-1', 'conv-2', 'conv-3'],
      updateType: 'status_change',
      timestamp: new Date().toISOString(),
      organizationId: 'org-456',
    };

    handler.handleWebSocketMessage(event);

    expect(mockConversationDispatch).toHaveBeenCalledWith({
      type: 'MARK_ITEMS_STALE',
      itemIds: ['conv-1', 'conv-2', 'conv-3'],
    });
  });

  it('should handle malformed events gracefully', () => {
    const malformedEvent = {
      type: 'conversation_updated',
      // Missing conversationId
      timestamp: new Date().toISOString(),
      organizationId: 'org-456',
    };

    // Should not throw or dispatch
    expect(() => handler.handleWebSocketMessage(malformedEvent)).not.toThrow();
    expect(mockConversationDispatch).not.toHaveBeenCalled();
  });
});
```

### Integration Testing

```typescript
// src/data/websockets/__tests__/integration.test.ts

import { createMockCollectionState } from '../../__tests__/helpers';
import { WebSocketHandler } from '../handler';
import { store } from '../../store';

describe('WebSocket Integration with Collections', () => {
  it('should invalidate all query patterns when item marked stale', async () => {
    // Setup: Item loaded by multiple queries
    const conversationId = 'conv-123';
    const orgId = 'org-456';
    const projectId = 'proj-789';
    
    const onboardingQuery = `conversations:${orgId}:${projectId}:onboarding:`;
    const projectQuery = `conversations:${orgId}:${projectId}::`;
    const directQuery = `conversation:${orgId}:${projectId}:${conversationId}`;
    
    // Load item through multiple query patterns
    await collection.fetchQuery(onboardingQuery, mockDispatch);
    await collection.fetchQuery(projectQuery, mockDispatch);  
    await collection.fetchQuery(directQuery, mockDispatch);
    
    // Verify item has all queryKeys
    const item = collection.getItem(conversationId);
    expect(item?.queryKeys).toEqual([onboardingQuery, projectQuery, directQuery]);
    
    // WebSocket event
    const handler = new WebSocketHandler(mockDispatch, vi.fn());
    handler.handleWebSocketMessage({
      type: 'conversation_updated',
      conversationId: conversationId,
      timestamp: new Date().toISOString(),
      organizationId: orgId,
    });
    
    // Verify all queries marked stale  
    const state = store.get(collection.stateAtom);
    expect(state.stale.has(onboardingQuery)).toBe(true);
    expect(state.stale.has(projectQuery)).toBe(true);
    expect(state.stale.has(directQuery)).toBe(true);
  });
});
```

## Performance Considerations

### Efficient Event Processing

```typescript
// Batch multiple events that arrive quickly
class WebSocketService {
  private eventQueue: WebSocketEvent[] = [];
  private processingTimer: NodeJS.Timeout | null = null;

  private queueEvent(event: WebSocketEvent) {
    this.eventQueue.push(event);
    
    // Debounce processing to batch events
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
    }
    
    this.processingTimer = setTimeout(() => {
      this.processBatchedEvents();
    }, 100); // 100ms batch window
  }

  private processBatchedEvents() {
    const events = [...this.eventQueue];
    this.eventQueue = [];
    
    // Group events by type and item
    const groupedEvents = this.groupEvents(events);
    
    // Process each group efficiently
    for (const [groupKey, groupEvents] of groupedEvents) {
      this.processEventGroup(groupKey, groupEvents);
    }
  }

  private groupEvents(events: WebSocketEvent[]): Map<string, WebSocketEvent[]> {
    const groups = new Map<string, WebSocketEvent[]>();
    
    for (const event of events) {
      const key = this.getEventGroupKey(event);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(event);
    }
    
    return groups;
  }
}
```

### Memory Management

```typescript
// Monitor WebSocket event processing performance
class PerformanceMonitor {
  private eventStats = new Map<string, { count: number; totalTime: number }>();

  measureEventProcessing<T>(eventType: string, fn: () => T): T {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    
    const stats = this.eventStats.get(eventType) || { count: 0, totalTime: 0 };
    stats.count++;
    stats.totalTime += duration;
    this.eventStats.set(eventType, stats);
    
    // Log slow events
    if (duration > 10) { // 10ms threshold
      console.warn(`⚠️ [WEBSOCKET] Slow event processing: ${eventType} took ${duration.toFixed(2)}ms`);
    }
    
    return result;
  }

  getStats() {
    const stats = {};
    for (const [eventType, { count, totalTime }] of this.eventStats) {
      stats[eventType] = {
        count,
        averageTime: totalTime / count,
        totalTime,
      };
    }
    return stats;
  }
}
```

## Best Practices

### 1. Event Type Design
- Use descriptive, consistent event types
- Include all necessary IDs in event payload
- Version your event schemas for backward compatibility

### 2. Error Handling
- Always validate required fields before processing
- Implement graceful degradation for malformed events
- Log detailed error information for debugging

### 3. Performance
- Batch events when possible to reduce dispatch calls
- Monitor event processing times
- Use efficient data structures for event queuing

### 4. Testing
- Test both happy path and error scenarios
- Verify integration with collection state
- Test event batching and debouncing logic

### 5. Debugging
- Add comprehensive logging for event flow
- Include performance metrics in production
- Provide tools to inspect WebSocket event history

The QueryKeys architecture makes WebSocket integration significantly simpler and more robust by eliminating manual query pattern tracking and providing automatic, precise cache invalidation.