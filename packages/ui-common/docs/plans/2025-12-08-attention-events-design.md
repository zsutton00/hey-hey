# Attention Events Analytics Extension

**Date:** 2025-12-08
**Objective:** Extend analytics tracking to capture coarse-grained "attention" events showing what users focus on and for how long, without granular button-click level detail.

## Design Overview

### Problem
Current tracking captures granular UI interactions (button clicks, field focus). To answer "what did the user do in the last hour?", you need queries that aggregate thousands of micro-events. This design shifts to **attention events** - signals about user engagement with meaningful entities (initiatives, tasks, projects) at the right level of granularity.

### Solution
Two complementary attention events:
1. **Navigation Attention** - emitted when user navigates to an entity/page
2. **Continuous Attention** - emitted every 30 seconds while engaged

## Event Schema

Both event types use the same structure:

```typescript
interface AttentionEvent {
  eventType: "attention";
  entity: {
    type: "initiative" | "task" | "project" | "conversation" | ...;
    id: string;
  };
  tab?: string;  // optional - sub-view identifier (e.g., "editor", "comments", "details")
  timestamp: number;
  // Existing context fields inherited from TrackingProvider:
  // - userId, projectId, organizationId, sessionId, etc.
}
```

## Event Triggers

### Navigation Attention (Initial Focus)
- **Trigger:** User navigates to a page or changes context to a new entity
- **Debounce:** 5 seconds (filters accidental navigation or intermediate hops)
- **Behavior:** Fire once per navigation, even if user doesn't interact
- **Example:** User navigates to Task #123 → after 5s, emit event with `entity: { type: "task", id: "123" }`

### Continuous Attention (Heartbeat)
- **Trigger:** Every 30 seconds while tab/window remains visible and in focus
- **Condition:** Only emits while browser tab has focus (visibility API)
- **No interaction required:** User can be passively reading/thinking
- **Behavior:** Captures sustained engagement without micro-interaction tracking
- **Example:** User stays on Task #123 for 2 minutes → emit at 30s, 60s, 90s, 120s

## Implementation Approach

### Changes Required
1. Create new `AttentionEvent` type in tracking types
2. Add `trackAttention()` hook for navigation events with 5s debounce
3. Add `useAttentionHeartbeat()` hook for 30s continuous events
4. Integrate with existing `TrackingProvider` context
5. Update event batching to handle attention events
6. Integrate tab context when available (optional enhancement)

### Integration Points
- **Page Navigation:** Trigger on route changes
- **Modal/Dialog Open:** Trigger when changing entity context
- **Tab Switching:** Update tab context field when user switches views
- **Window Visibility:** Stop emitting heartbeat when tab loses focus, resume when regained

## Data Quality & Performance

### Conservative Metadata
- Minimal fields: no large payloads or nested objects
- `tab` is optional, single string identifier only
- Reuses existing context from `TrackingProvider`

### Event Volume
- Navigation events: ~5-20 per user session (varies by workflow)
- Continuous events: 1 per 30s while active (2 per minute max)
- Much lower volume than granular interaction tracking

### Future Analysis Capability
- **Duration queries:** "User was on Task T for 60 minutes" (multiply heartbeat count by 30s)
- **Sub-activity tracking:** "Of that 60 minutes, 20 was in editor tab" (filter heartbeats by tab value)
- **Temporal analysis:** "Last 50 things user did" (order by timestamp, group by entity)

## Success Criteria

✅ Can query: "User spent 15 minutes on Initiative A, 60 minutes on Task T"
✅ Can infer: "Sub-activity: 30 of 60 Task T minutes were in editor tab"
✅ Can retrieve: "Last 50 things user focused on" with time spent per entity
✅ No large metadata fields (keeps events lean)
✅ Integrates cleanly with existing `TrackingProvider` infrastructure
✅ Type-safe with TypeScript discriminated unions
