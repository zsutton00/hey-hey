# Attention Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement attention events (navigation + 30s heartbeat) to track what users focus on without granular button-click detail.

**Architecture:** Add `AttentionEvent` type alongside existing event types, create two hooks (`useNavigationAttention` with 5s debounce, `useAttentionHeartbeat` with 30s interval + visibility API), integrate both with existing `UserActionTracker` queue, ensure they work with `TrackingProvider` context enrichment.

**Tech Stack:** TypeScript, React Hooks (useState, useEffect, useCallback), Visibility API, debounce utility

---

## Task 1: Add AttentionEvent Type

**Files:**
- Modify: `src/types/userTracking.ts`
- Test: `src/types/__tests__/userTracking.test.ts` (create if needed)

**Step 1: Read the existing types file**

Read `src/types/userTracking.ts` to understand the current event type structure and discriminated unions pattern.

**Step 2: Write the failing test**

Add this test to `src/types/__tests__/userTracking.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AttentionEvent, UserTrackingEvent } from "../userTracking";

describe("AttentionEvent", () => {
  it("should create a valid navigation attention event", () => {
    const event: AttentionEvent = {
      eventType: "attention",
      entity: {
        type: "task",
        id: "task-123",
      },
      timestamp: Date.now(),
    };

    expect(event.eventType).toBe("attention");
    expect(event.entity.type).toBe("task");
    expect(event.entity.id).toBe("task-123");
  });

  it("should create attention event with optional tab field", () => {
    const event: AttentionEvent = {
      eventType: "attention",
      entity: {
        type: "initiative",
        id: "init-456",
      },
      tab: "editor",
      timestamp: Date.now(),
    };

    expect(event.tab).toBe("editor");
  });

  it("should be a valid UserTrackingEvent", () => {
    const event: UserTrackingEvent = {
      eventType: "attention",
      entity: {
        type: "project",
        id: "proj-789",
      },
      timestamp: Date.now(),
    };

    expect(event.eventType).toBe("attention");
  });
});
```

**Step 3: Run test to verify it fails**

```bash
cd /Users/zac/Desktop/code/hey-hey/ui-common
pnpm test src/types/__tests__/userTracking.test.ts
```

Expected: FAIL - "AttentionEvent not defined"

**Step 4: Add AttentionEvent type**

In `src/types/userTracking.ts`, add after the existing event type definitions (find the discriminated union):

```typescript
export interface AttentionEvent extends TrackingEventMetadata {
  eventType: "attention";
  entity: {
    type: "initiative" | "task" | "project" | "conversation" | "design_doc";
    id: string;
  };
  tab?: string; // optional sub-view identifier (e.g., "editor", "comments", "details")
}
```

Then add `AttentionEvent` to the `UserTrackingEvent` discriminated union:

```typescript
export type UserTrackingEvent =
  | InitiativeEvent
  | WorkflowEvent
  | NavigationEvent
  | FormEvent
  | UIInteractionEvent
  | AuthenticationEvent
  | IntegrationEvent
  | ErrorEvent
  | PerformanceEvent
  | AttentionEvent;
```

**Step 5: Run test to verify it passes**

```bash
pnpm test src/types/__tests__/userTracking.test.ts
```

Expected: PASS

**Step 6: Run type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 7: Commit**

```bash
git add src/types/userTracking.ts src/types/__tests__/userTracking.test.ts
git commit -m "feat: Add AttentionEvent type for focus tracking"
```

---

## Task 2: Create useNavigationAttention Hook

**Files:**
- Create: `src/hooks/useNavigationAttention.ts`
- Test: `src/hooks/__tests__/useNavigationAttention.test.ts`

**Step 1: Write the failing test**

Create `src/hooks/__tests__/useNavigationAttention.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNavigationAttention } from "../useNavigationAttention";

describe("useNavigationAttention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should track navigation after 5 second debounce", () => {
    const trackMock = vi.fn();
    const { rerender } = renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    // Simulate rapid navigation changes
    rerender({
      entityType: "task" as const,
      entityId: "task-456",
      trackAttention: trackMock,
    });

    rerender({
      entityType: "initiative" as const,
      entityId: "init-789",
      trackAttention: trackMock,
    });

    // No event fired yet (within debounce window)
    expect(trackMock).not.toHaveBeenCalled();

    // Advance time past debounce
    vi.advanceTimersByTime(5100);

    // Should fire once with latest entity
    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "attention",
        entity: {
          type: "initiative",
          id: "init-789",
        },
      })
    );
  });

  it("should not fire event if entity does not change", () => {
    const trackMock = vi.fn();
    const { rerender } = renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    // Re-render with same entity
    rerender({
      entityType: "task" as const,
      entityId: "task-123",
      trackAttention: trackMock,
    });

    vi.advanceTimersByTime(5100);

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("should include tab field when provided", () => {
    const trackMock = vi.fn();
    renderHook(
      ({ entityType, entityId, tab, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention, tab),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          tab: "editor",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(5100);

    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "editor",
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test src/hooks/__tests__/useNavigationAttention.test.ts
```

Expected: FAIL - "useNavigationAttention not defined"

**Step 3: Create the hook**

Create `src/hooks/useNavigationAttention.ts`:

```typescript
import { useEffect, useRef } from "react";
import type { AttentionEvent } from "../types/userTracking";

type EntityType = "initiative" | "task" | "project" | "conversation" | "design_doc";

export const useNavigationAttention = (
  entityType: EntityType,
  entityId: string,
  trackAttention: (event: AttentionEvent) => void,
  tab?: string
): void => {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousEntityRef = useRef<string | null>(null);

  useEffect(() => {
    const currentEntity = `${entityType}:${entityId}`;

    // Only track if entity changed
    if (currentEntity === previousEntityRef.current) {
      return;
    }

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer (5 seconds)
    debounceTimerRef.current = setTimeout(() => {
      const event: AttentionEvent = {
        eventType: "attention",
        entity: {
          type: entityType,
          id: entityId,
        },
        timestamp: Date.now(),
      };

      if (tab) {
        event.tab = tab;
      }

      trackAttention(event);
      previousEntityRef.current = currentEntity;
    }, 5000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [entityType, entityId, tab, trackAttention]);
};
```

**Step 4: Run test to verify it passes**

```bash
pnpm test src/hooks/__tests__/useNavigationAttention.test.ts
```

Expected: PASS

**Step 5: Run type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 6: Commit**

```bash
git add src/hooks/useNavigationAttention.ts src/hooks/__tests__/useNavigationAttention.test.ts
git commit -m "feat: Add useNavigationAttention hook with 5s debounce"
```

---

## Task 3: Create useAttentionHeartbeat Hook

**Files:**
- Create: `src/hooks/useAttentionHeartbeat.ts`
- Test: `src/hooks/__tests__/useAttentionHeartbeat.test.ts`

**Step 1: Write the failing test**

Create `src/hooks/__tests__/useAttentionHeartbeat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAttentionHeartbeat } from "../useAttentionHeartbeat";

describe("useAttentionHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should emit attention event every 30 seconds while tab is visible", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    // Advance to first heartbeat (30s)
    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "attention",
        entity: { type: "task", id: "task-123" },
      })
    );

    // Advance to second heartbeat (30s more)
    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(2);

    // Advance to third heartbeat
    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(3);
  });

  it("should stop emitting when tab becomes hidden", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);

    // Simulate tab becoming hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: true,
    });

    const event = new Event("visibilitychange");
    document.dispatchEvent(event);

    vi.advanceTimersByTime(30000);
    // Should not emit while hidden
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  it("should resume emitting when tab becomes visible again", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);

    // Hide tab
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);

    // Show tab again
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(2);
  });

  it("should include tab field when provided", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, tab, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention, tab),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          tab: "comments",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(30000);

    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "comments",
      })
    );
  });

  it("should restart timer when entity changes", () => {
    const trackMock = vi.fn();

    const { rerender } = renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(15000);
    expect(trackMock).not.toHaveBeenCalled();

    // Change entity
    rerender({
      entityType: "initiative" as const,
      entityId: "init-456",
      trackAttention: trackMock,
    });

    // Timer should reset, so we need 30s from this point
    vi.advanceTimersByTime(15000);
    expect(trackMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15000);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: { type: "initiative", id: "init-456" },
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test src/hooks/__tests__/useAttentionHeartbeat.test.ts
```

Expected: FAIL - "useAttentionHeartbeat not defined"

**Step 3: Create the hook**

Create `src/hooks/useAttentionHeartbeat.ts`:

```typescript
import { useEffect, useRef } from "react";
import type { AttentionEvent } from "../types/userTracking";

type EntityType = "initiative" | "task" | "project" | "conversation" | "design_doc";

export const useAttentionHeartbeat = (
  entityType: EntityType,
  entityId: string,
  trackAttention: (event: AttentionEvent) => void,
  tab?: string
): void => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isVisibleRef = useRef<boolean>(!document.hidden);

  useEffect(() => {
    const emitHeartbeat = () => {
      if (!isVisibleRef.current) {
        return;
      }

      const event: AttentionEvent = {
        eventType: "attention",
        entity: {
          type: entityType,
          id: entityId,
        },
        timestamp: Date.now(),
      };

      if (tab) {
        event.tab = tab;
      }

      trackAttention(event);
    };

    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;
    };

    // Set up visibility listener
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Start heartbeat interval (30 seconds)
    intervalRef.current = setInterval(emitHeartbeat, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [entityType, entityId, tab, trackAttention]);
};
```

**Step 4: Run test to verify it passes**

```bash
pnpm test src/hooks/__tests__/useAttentionHeartbeat.test.ts
```

Expected: PASS

**Step 5: Run type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 6: Commit**

```bash
git add src/hooks/useAttentionHeartbeat.ts src/hooks/__tests__/useAttentionHeartbeat.test.ts
git commit -m "feat: Add useAttentionHeartbeat hook with 30s interval and visibility API"
```

---

## Task 4: Integrate Attention Events with TrackingProvider

**Files:**
- Modify: `src/contexts/TrackingContext.tsx`
- Modify: `src/services/userActionTracker.ts`

**Step 1: Read the TrackingProvider and UserActionTracker**

Read both files to understand how events are currently tracked and how to integrate attention events:
- `src/contexts/TrackingContext.tsx`
- `src/services/userActionTracker.ts`

**Step 2: Update UserActionTracker to accept AttentionEvent**

In `src/services/userActionTracker.ts`, find the main event tracking method. Attention events should flow through the same queue/batching mechanism as other events.

Verify that `trackEvent()` or similar method properly handles `AttentionEvent` type. If not, update it:

```typescript
// In UserActionTracker class
public trackEvent(event: Omit<UserTrackingEvent, keyof TrackingEventMetadata>): void {
  // This should already support AttentionEvent through the UserTrackingEvent discriminated union
  this.enrichEvent(event);
}
```

**Step 3: Add attention tracking methods to TrackingContext hook**

In `src/contexts/TrackingContext.tsx`, add to the hook's returned object:

```typescript
const trackAttention = useCallback(
  (event: Omit<AttentionEvent, keyof TrackingEventMetadata>) => {
    tracker.trackEvent(event);
  },
  [tracker]
);

return {
  // ... existing methods
  trackAttention,
};
```

**Step 4: Write integration test**

Create `src/contexts/__tests__/TrackingContext.attention.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { TrackingProvider, useUserAction } from "../TrackingContext";

describe("TrackingContext - Attention Events", () => {
  it("should provide trackAttention through useUserAction hook", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackingProvider enabled={true}>{children}</TrackingProvider>
    );

    const { result } = renderHook(() => useUserAction(), { wrapper });

    expect(result.current.trackAttention).toBeDefined();
    expect(typeof result.current.trackAttention).toBe("function");
  });

  it("should queue attention events", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackingProvider enabled={true}>{children}</TrackingProvider>
    );

    const { result } = renderHook(() => useUserAction(), { wrapper });

    result.current.trackAttention({
      eventType: "attention",
      entity: {
        type: "task",
        id: "task-123",
      },
      timestamp: Date.now(),
    });

    // Event should be queued (we can't easily verify without exposing internal state)
    // This test primarily checks that the method exists and doesn't throw
    expect(result.current.trackAttention).toBeDefined();
  });
});
```

**Step 5: Run integration test**

```bash
pnpm test src/contexts/__tests__/TrackingContext.attention.test.tsx
```

Expected: PASS

**Step 6: Run type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 7: Commit**

```bash
git add src/contexts/TrackingContext.tsx src/services/userActionTracker.ts src/contexts/__tests__/TrackingContext.attention.test.tsx
git commit -m "feat: Integrate AttentionEvent tracking with TrackingProvider and UserActionTracker"
```

---

## Task 5: Add useAttention Composite Hook

**Files:**
- Create: `src/hooks/useAttention.ts`
- Test: `src/hooks/__tests__/useAttention.test.ts`

**Step 1: Write the failing test**

Create `src/hooks/__tests__/useAttention.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAttention } from "../useAttention";
import { TrackingProvider, useUserAction } from "../contexts/TrackingContext";

describe("useAttention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should emit both navigation and heartbeat attention events", () => {
    const trackAttentionMock = vi.fn();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackingProvider
        enabled={true}
        onTrackEvent={(event) => {
          if (event.eventType === "attention") {
            trackAttentionMock(event);
          }
        }}
      >
        {children}
      </TrackingProvider>
    );

    renderHook(
      () => {
        const { trackAttention } = useUserAction();
        useAttention("task", "task-123", trackAttention);
      },
      { wrapper }
    );

    // Navigation event fires after 5s
    vi.advanceTimersByTime(5000);
    expect(trackAttentionMock).toHaveBeenCalledTimes(1);
    expect(trackAttentionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "attention",
        entity: { type: "task", id: "task-123" },
      })
    );

    // Heartbeat fires at 30s
    vi.advanceTimersByTime(25000);
    expect(trackAttentionMock).toHaveBeenCalledTimes(2);

    // Another heartbeat at 60s
    vi.advanceTimersByTime(30000);
    expect(trackAttentionMock).toHaveBeenCalledTimes(3);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test src/hooks/__tests__/useAttention.test.ts
```

Expected: FAIL - "useAttention not defined"

**Step 3: Create the composite hook**

Create `src/hooks/useAttention.ts`:

```typescript
import type { AttentionEvent } from "../types/userTracking";
import { useNavigationAttention } from "./useNavigationAttention";
import { useAttentionHeartbeat } from "./useAttentionHeartbeat";

type EntityType = "initiative" | "task" | "project" | "conversation" | "design_doc";

/**
 * Composite hook that handles both navigation and continuous attention tracking.
 * Emits a navigation event (with 5s debounce) when entity changes,
 * then emits heartbeat events every 30s while the tab remains visible.
 *
 * @param entityType - Type of entity being focused on
 * @param entityId - ID of the entity
 * @param trackAttention - Callback to emit attention events
 * @param tab - Optional sub-view identifier (e.g., "editor", "comments")
 */
export const useAttention = (
  entityType: EntityType,
  entityId: string,
  trackAttention: (event: Omit<AttentionEvent, keyof TrackingEventMetadata>) => void,
  tab?: string
): void => {
  // Track navigation (fires once with 5s debounce when entity changes)
  useNavigationAttention(entityType, entityId, trackAttention, tab);

  // Track continuous attention (fires every 30s while visible)
  useAttentionHeartbeat(entityType, entityId, trackAttention, tab);
};
```

**Step 4: Run test to verify it passes**

```bash
pnpm test src/hooks/__tests__/useAttention.test.ts
```

Expected: PASS

**Step 5: Run type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 6: Create index export**

Update or create `src/hooks/index.ts` to export the new hooks:

```typescript
export { useAttention } from "./useAttention";
export { useNavigationAttention } from "./useNavigationAttention";
export { useAttentionHeartbeat } from "./useAttentionHeartbeat";
```

**Step 7: Commit**

```bash
git add src/hooks/useAttention.ts src/hooks/index.ts src/hooks/__tests__/useAttention.test.ts
git commit -m "feat: Add useAttention composite hook for navigation + heartbeat tracking"
```

---

## Task 6: Update Tracking Summary Documentation

**Files:**
- Modify: `src/tracking-integration-summary.md`

**Step 1: Read the existing tracking summary**

Review `src/tracking-integration-summary.md` to understand its structure and tone.

**Step 2: Add Attention Events section**

Add a new section after the "Initiative-Specific Tracking" section:

```markdown
### 5. **Attention Tracking** ✅
- **Location**: `src/hooks/useAttention.ts`, `src/hooks/useNavigationAttention.ts`, `src/hooks/useAttentionHeartbeat.ts`
- **Tracks**: Entity navigation (what user focuses on), continuous engagement (how long they stay)
- **Human-readable output**:
  - "User navigated to task-123"
  - "User remained focused on initiative-456 for 30 seconds"

#### How It Works
The attention tracking system focuses on **what users are engaged with** rather than granular UI interactions:

1. **Navigation Attention** - Fired 5 seconds after user navigates to an entity (debounced to filter accidental hops)
2. **Continuous Attention** - Fired every 30 seconds while the tab remains visible/in-focus

Both events share the same schema and track:
- `entity`: The resource user is focused on (type + id)
- `tab` (optional): Which sub-view they're in (e.g., "editor", "comments")

#### Usage Example
```typescript
import { useAttention } from "src/hooks";
import { useUserAction } from "src/contexts/TrackingContext";

export const TaskDetail: React.FC<{ taskId: string }> = ({ taskId }) => {
  const { trackAttention } = useUserAction();

  // Track attention on this task with optional tab
  useAttention("task", taskId, trackAttention, currentTab);

  return (/* ... task detail UI ... */);
};
```

#### Benefits
- **Coarse-grained tracking**: Avoid thousands of micro-events for "last 50 things user did"
- **Duration inference**: 30s heartbeat intervals make session duration easy to compute
- **Sub-activity tracking**: Optional `tab` field enables rollup queries later (e.g., "60 min on task, 20 min in editor")
- **Privacy-preserving**: No keystroke/click tracking, only focus context
- **Performance**: Minimal event volume, visibility API integration stops emission when tab hidden
```

**Step 3: Verify documentation quality**

Read through the updated document to ensure it flows well and matches the existing documentation style.

**Step 4: Commit**

```bash
git add src/tracking-integration-summary.md
git commit -m "docs: Add attention tracking documentation to integration summary"
```

---

## Task 7: Verify Full Integration

**Files:**
- No files modified, validation only

**Step 1: Run full type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 2: Run all tests**

```bash
pnpm test src/types/__tests__/userTracking.test.ts src/hooks/__tests__/useNavigationAttention.test.ts src/hooks/__tests__/useAttentionHeartbeat.test.ts src/hooks/__tests__/useAttention.test.ts src/contexts/__tests__/TrackingContext.attention.test.tsx
```

Expected: All tests PASS

**Step 3: Run linting**

```bash
pnpm run lint
```

Expected: No errors or warnings

**Step 4: Verify exports**

Create a quick verification file to ensure all exports work:

Create `src/__verify_exports.ts` (temporary):

```typescript
// Verify all attention-related exports are accessible
import type { AttentionEvent, UserTrackingEvent } from "./types/userTracking";
import { useAttention, useNavigationAttention, useAttentionHeartbeat } from "./hooks";
import { useUserAction } from "./contexts/TrackingContext";

// This file only exists to verify imports compile
// Delete after verification
```

Run type check:
```bash
pnpm run type-check
```

Expected: Found 0 errors

Then delete the verification file:
```bash
rm src/__verify_exports.ts
```

**Step 5: Final integration test run**

```bash
pnpm test
```

Expected: All tests pass, including existing tests (no regressions)

**Step 6: Final commit**

```bash
git log --oneline -7
```

Verify the last 7 commits include all attention event work. Expected commits:
1. "feat: Add AttentionEvent type for focus tracking"
2. "feat: Add useNavigationAttention hook with 5s debounce"
3. "feat: Add useAttentionHeartbeat hook with 30s interval and visibility API"
4. "feat: Integrate AttentionEvent tracking with TrackingProvider and UserActionTracker"
5. "feat: Add useAttention composite hook for navigation + heartbeat tracking"
6. "docs: Add attention tracking documentation to integration summary"

Create a final summary commit:

```bash
git log --oneline adr-refinement..initiatives | head -7 > /tmp/attention-commits.txt
cat /tmp/attention-commits.txt
```

All tasks complete! The attention events system is fully integrated and tested.
