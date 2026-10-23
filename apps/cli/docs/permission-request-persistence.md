# Permission Request Persistence & Stale Session Recovery

## Problem

When a coding session has a pending permission request and the user doesn't respond for an extended period (hours/days), the session enters an unrecoverable state:

1. **Process restart loses all pending state.** Permission requests are stored in an in-memory `Map<string, PendingClaudePermissionRequest>` in `session-runner-claude.ts:112`. If the CLI process restarts (or the session is deactivated and reactivated), the Map is empty and the approval can never be delivered.

2. **Sending any message cancels pending permissions.** `runPrompt()` unconditionally calls `rejectPendingPermissionRequests()` at line 410. This means any new turn — including the user trying to respond — nukes the pending permission, causing a cancel-retry-cancel cascade.

3. **No structured state transitions.** When permissions are canceled, they're rejected via `Map.clear()` with no persisted record. There's no way to distinguish "user denied" from "system canceled due to new turn" from "process restarted and lost state."

### Observed Behavior

```
⏺ Update(src/components/CodingSession/CodingSetupView.tsx)
  ⎿  Error: Tool permission request failed: Error: Claude permission request was canceled because run
     claude_93055746-... started a new turn.

⏺ Update(src/components/CodingSession/CodingSetupView.tsx)
  ⎿  Error: Tool permission request failed: Error: Claude permission request was canceled because run
     claude_36d6699d-... started a new turn.
```

Each interaction starts a new run, cancels the pending permission, Claude retries the same edit, hits a new permission request, which gets canceled by the next interaction — an infinite loop.

## Current Architecture (Post-Refactor)

The refactored event pipeline already provides several of the building blocks needed. Understanding what exists helps scope the remaining work.

### What the pipeline already handles

**Normalized event flow:** Permission requests follow the standard path:

```
provider SDK callback → session runner emits raw event → Run.onAgentOutput()
→ event-dispatcher.normalize() → PermissionEvent → handlePermission()
→ prepend System message with UI marker
```

**Dedicated decision routing:** Permission decisions arrive via `POST /permission-decision`, routed through `permission-response-routing.ts` → `PermissionDecisionHandlerRegistry` → runner's `submitPermissionDecision()`. This is a separate channel from prompt submission — approvals don't flow through `runPrompt()`.

**Coalescing:** When Claude makes N parallel calls to the same tool, the SDK fires `onPermissionRequest` N times. The runner coalesces these (lines 230-261): only the first emits events and creates a UI prompt; subsequent callbacks piggyback on its resolution. `submitPermissionDecision()` resolves all coalesced entries together (lines 1043-1068).

**`RunContext` as per-run state:** The `Run` class holds a `RunContext` with mutable per-run state (`pendingDiffs`, `touchedFiles`, `processingMessageId`). This is the natural place for runtime-level permission tracking.

### What's missing

Permission state lives **exclusively** in the session runner's closure-scoped `Map`. This means:

- The runtime layer (`Run`, `RunContext`, handlers) cannot observe pending permissions
- The run store (`run-store.ts`) has no permission-related persistence
- `runPrompt()` is the only place that checks/clears pending permissions, and it does so destructively
- Process restart = total state loss with no recovery path

## Reference: How happy-cli Handles This

Happy-cli has a more robust architecture for permission requests that avoids all of the above problems.

### 1. Server-Persisted Permission State (`AgentState`)

Permission requests are persisted via `updateAgentState()` alongside the session. The state schema:

```typescript
type AgentState = {
  requests?: {
    [id: string]: {
      tool: string;
      arguments: any;
      createdAt: number;
    };
  };
  completedRequests?: {
    [id: string]: {
      tool: string;
      arguments: any;
      createdAt: number;
      completedAt: number;
      status: 'canceled' | 'denied' | 'approved';
      reason?: string;
      decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    };
  };
};
```

Every permission request is written to `requests` when created and moved to `completedRequests` with a terminal status when resolved. This survives process restarts.

### 2. AbortSignal-Based Cancellation

Permission requests accept an `AbortSignal`. When the session needs to abort, the signal fires and each permission request is cleanly rejected — cooperative cancellation rather than brute-force Map clearing.

### 3. Clean State Transitions on Reset

`PermissionHandler.reset()` properly: snapshots pending requests, clears the Map immediately, rejects all promises, then moves all pending → `completedRequests` with `status: 'canceled'` in the persisted state. A re-entrancy guard (`isResetting` flag) prevents concurrent resets.

### What we already have that happy-cli also has

- **Dedicated RPC channel for approvals** — our `POST /permission-decision` → `routePermissionDecision()` → `submitPermissionDecision()` path already separates decisions from prompts.
- **Coalescing** — happy-cli doesn't have this; we do. Our implementation is actually ahead here.

## Implementation Plan

The plan follows our event pipeline design philosophy: **provider → events → normalization → handler → poster**. Permission state should flow through the same pipeline rather than being a side-channel in the runner closure.

### Phase 1: Lift Permission State into `RunContext` + AbortSignal

**Goal:** Make permission state observable to the runtime layer, and enable cooperative cancellation.

The runner's closure-scoped `Map` currently serves two roles: (1) holding Promise resolve/reject callbacks for the SDK, and (2) being the only record that a permission exists. These roles should be split.

**Changes:**

- **Add `pendingPermissions` to `RunContext`** (`src/server/runtime/types.ts`):
  ```typescript
  interface PendingPermission {
    requestId: string;
    primaryRequestId: string; // for coalesced entries, points to the user-visible request
    toolName: string;
    createdAt: string;
    messageId: string | null; // posted message ID — null until handlePermission prepends the message
  }

  interface RunContext {
    // ... existing fields ...
    pendingPermissions: Map<string, PendingPermission>;
  }
  ```
  The `primaryRequestId` field handles coalescing — N map entries can point to one user-visible request, so recovery logic knows to show 1 stale prompt, not N. The `messageId` field links the permission to its posted UI message (see [Message ID Linkage](#message-id-linkage) below).

- **Emit normalized events for permission lifecycle changes.** The runner already emits `permission_request` events. Add corresponding events for resolution and cancellation so the full lifecycle flows through the pipeline:
  - `permission_resolved` (approved/denied/always_approve)
  - `permission_cancelled` (with structured reason: `new_turn`, `run_completed`, `process_restart`, `session_resumed`)

  These become new `NormalizedEventKind` variants, each with its own handler that updates `RunContext.pendingPermissions` and (in Phase 2) persists the transition.

- **Thread an `AbortController` per run through to pending permissions** (`session-runner-claude.ts`). Instead of `rejectPendingPermissionRequests()` iterating the Map and calling `reject()` on each entry, the run's abort signal fires and each pending Promise rejects cooperatively. This eliminates the race where a concurrent `onPermissionRequest` inserts between iteration and `Map.clear()`.

- **Add a re-entrancy guard** to the cancellation path (like happy-cli's `isResetting` flag) to prevent concurrent abort + new-turn from double-rejecting.

- **Initialize `RunContext.pendingPermissions`** in the `Run` constructor (`src/server/runtime/run.ts`).

- **`Run.cleanup()`** should clear `pendingPermissions` alongside `pendingDiffs`.

#### Message ID Linkage

Today, `handlePermission()` calls `deps.poster.prepend()` which returns a message ID — and then discards it. That message sits in the conversation with `status: Open` and a clickable Approve/Deny UI. If the process restarts, the SDK callback is gone but the message is still actionable. Clicking Approve hits `submitPermissionDecision()`, finds no matching entry in the runner's Map, and throws `RUN_FAILED`.

To close this gap, `handlePermission()` must write the returned message ID back to `RunContext.pendingPermissions` after prepending. This introduces a new pattern: **cross-handler state sharing via `RunContext`**. Currently handlers are independent — they read from `RunContext` but don't write state that other handlers depend on. Here, the `permission` handler writes `messageId`, and the `permission-cancelled` handler reads it to close the original message via `deps.poster.complete()`.

The flow:

1. `handlePermission()` prepends the Open message → gets `messageId` back
2. Writes `messageId` to the matching entry in `ctx.pendingPermissions`
3. On cancellation (new turn, process restart, session resume), `handlePermissionCancelled()` reads `messageId` from the entry
4. Calls `deps.poster.complete(messageId, { status: 'Cancelled' })` to transition the original message
5. The UI sees the status change and disables the Approve/Deny buttons

For process restart recovery (Phase 2), `messageId` must also be persisted in the run store so it survives across process lifetimes. Without it, stale Open messages become permanently orphaned — still clickable, but guaranteed to fail.

**Edge case:** If the prepend call fails (network error, API down), `messageId` is null. The cancellation handler should handle this gracefully — log a warning, skip the complete call. The permission still gets cleaned up in `RunContext` and the run store; the orphaned message is a cosmetic issue, not a state corruption.

**Files:**
- `src/server/runtime/types.ts` — add `PendingPermission`, extend `RunContext`, add new event kinds
- `src/server/runtime/run.ts` — initialize + cleanup `pendingPermissions`
- `src/server/runtime/event-dispatcher.ts` — normalize new lifecycle events, add handlers
- `src/server/runtime/handlers/permission-resolved.ts` — new handler: update `RunContext`, log
- `src/server/runtime/handlers/permission-cancelled.ts` — new handler: update `RunContext`, log
- `src/agents/session-runner-claude.ts` — emit lifecycle events, accept `AbortSignal`, add re-entrancy guard
- `src/agents/session-runner-mcp.ts` — same pattern

### Phase 2: Persist Permission State to Run Store

**Goal:** Permission requests survive process restarts.

With Phase 1 in place, permission lifecycle events flow through the normalized pipeline. Persistence becomes a natural extension — the handlers write state transitions to the run store.

**Changes:**

- **Add permission state to the run metadata schema** (`src/run/run-store.ts`). Two fields on the per-run JSON:
  ```typescript
  interface PersistedPermissionState {
    pending: Record<string, {
      toolName: string;
      primaryRequestId: string;
      messageId: string | null; // posted UI message — needed to close it on recovery
      createdAt: string;
    }>;
    completed: Record<string, {
      toolName: string;
      primaryRequestId: string;
      messageId: string | null;
      createdAt: string;
      completedAt: string;
      status: 'approved' | 'denied' | 'cancelled';
      reason: string | null;
    }>;
  }
  ```

- **Permission lifecycle handlers persist transitions.** `handlePermissionResolved()` moves entries from `pending` → `completed`. `handlePermissionCancelled()` does the same with `status: 'cancelled'`. This follows the existing pattern where handlers call `deps.poster` — here they'd also call a new `deps.runStore.updatePermissionState()` method (injected via `HandlerDeps`).

- **On run initialization, check for stale pending permissions** in the persisted store. Any entries in `pending` from a previous process lifetime get moved to `completed` with `status: 'cancelled'`, `reason: 'process_restart'`. Emit a `permission_cancelled` event so the pipeline handles it uniformly. The cancellation handler uses the persisted `messageId` to close the original Open message in the conversation — without this, the old permission prompt remains clickable but guaranteed to fail.

**Files:**
- `src/run/run-store.ts` — add `updatePermissionState()`, `getPermissionState()` methods
- `src/run/types.ts` — add `PersistedPermissionState`
- `src/server/runtime/types.ts` — extend `HandlerDeps` to include run store access
- `src/server/runtime/handlers/permission-resolved.ts` — add persistence call
- `src/server/runtime/handlers/permission-cancelled.ts` — add persistence call
- `src/server/runtime/run.ts` — check stale permissions on construction, emit cleanup events

### Phase 3: Guard Prompt Submission During Pending Permissions

**Goal:** Prevent the cancel-retry-cancel cascade.

With `RunContext.pendingPermissions` from Phase 1, this becomes a simple check.

**Changes:**

- **In `runPrompt()`**, before calling `rejectPendingPermissionRequests()`, check if there are pending permissions in the current `RunContext`. If pending permissions exist and the incoming prompt is a regular user message:
  - Reject the prompt with a clear error (`PERMISSION_PENDING`) so the UI can show "Resolve the pending permission request before sending a new message."
  - The permission decision endpoint remains unaffected — it resolves the pending request without starting a new turn (this already works correctly via the separate routing path).

- **Surface the error at the HTTP layer.** `local-agent-service.ts` already handles runner errors — map `PERMISSION_PENDING` to an appropriate HTTP response (409 Conflict) with a structured body the UI can act on.

**Files:**
- `src/agents/session-runner-claude.ts` — add guard at top of `runPrompt()`
- `src/agents/session-runner-mcp.ts` — same
- `src/server/local-agent-service.ts` — map `PERMISSION_PENDING` error to HTTP 409

### Phase 4: Stale Permission Recovery on Resume

**Goal:** When a session is resumed after a long idle period, handle stale permissions gracefully.

**Changes:**

- **On `resumeSession()`**, before delegating to `runPrompt()`, load persisted permission state from the run store. If there are stale pending permissions (from a previous process lifetime or older than a configurable threshold), emit `permission_cancelled` events with `reason: 'session_resumed'`. These flow through the normal pipeline — the handler updates `RunContext`, persists the transition, and the poster can prepend a user-visible message:

  > "Previous permission request for [tool] was canceled because the session was resumed."

- This replaces the current behavior where the error surfaces as a cryptic "permission request was canceled because run X started a new turn."

**Files:**
- `src/agents/session-runner-claude.ts` — add recovery logic in `resumeSession()`
- `src/agents/session-runner-mcp.ts` — same

## Design Alignment

The implementation follows the established pipeline philosophy:

| Concern | Where it lives | Why |
|---------|---------------|-----|
| SDK Promise callbacks | Runner closure `Map` | Only the runner can resolve the SDK's callback |
| Permission existence/lifecycle | `RunContext.pendingPermissions` | Runtime state belongs in `RunContext`, like `pendingDiffs` |
| Lifecycle transitions | Normalized events (`permission_resolved`, `permission_cancelled`) | State changes are events; events flow through the pipeline |
| UI message creation | `handlePermission()` → `deps.poster.prepend()` | Handlers own message creation, not runners |
| UI message closure | `handlePermissionCancelled()` → `deps.poster.complete()` | Cancellation handler reads `messageId` from `RunContext` to close the original Open message |
| Durable state | Run store via handler `deps` | Persistence is a side effect of handling events |
| Decision routing | `permission-response-routing.ts` → runner | Already correct; no changes needed |

The runner's `Map` shrinks to a synchronization primitive (holding Promises). The source of truth moves to `RunContext` (runtime) and the run store (durable). All state transitions flow as events through the normalized pipeline.

## Priority

Phase 1 is the foundation — it restructures where permission state lives and how cancellation works. Phase 2 adds durability. These two together fix the data loss (permissions lost on restart) and lay the groundwork for Phase 3's cascade fix. Phase 3 is the user-facing bug fix. Phase 4 is UX polish.

| Phase | Impact | Complexity |
|-------|--------|------------|
| 1: Lift state + AbortSignal | Enables everything else | Medium — touches types, runner, and run class |
| 2: Persist to run store | Survives process restart | Low — handlers + run store methods |
| 3: Guard prompt submission | Fixes cascade bug | Low — one guard + HTTP mapping |
| 4: Stale recovery on resume | UX improvement | Low — reads persisted state, emits events |
