# Runtime Event System

## Flow

```
Provider (Claude | Codex)
  |
  v
Run.onAgentOutput(raw event)
  |
  v
normalize(raw, provider) -> NormalizedEvent (discriminated union)
  |
  v
dispatch: switch (event.kind)
  |
  +-- run_started        -> create processing message
  +-- run_completed      -> complete processing message
  +-- assistant_delta    -> publish process-local agent output
  +-- assistant_complete -> complete processing message (final content)
  +-- processing_status  -> update platform current-state observation
  +-- diff               -> track files on run context
  +-- permission         -> publish the permission request through the run flow
  +-- user               -> create user message
  +-- other              -> drop
```

## Event Kinds

Each event kind is a TypeScript interface in the discriminated union. The
compiler enforces that handlers only access fields that exist on their variant.

| Kind | Handler effect |
| --- | --- |
| `run_started` | `Run.postTurnMessages` posts the SYSTEM processing placeholder. |
| `run_completed` | Completes the processing message and clears pending diffs. |
| `assistant_delta` | Publishes process-local agent output or feeds the collector. |
| `assistant_complete` | Completes the processing message with final content. |
| `processing_status` | Records the provider phase and emits platform current state. |
| `diff` | Tracks touched files and buffers provider diffs until permission. |
| `permission` | Prepends the permission request and merges pending diffs. |
| `user` | Prepends an in-turn user event or creates the declared parented message. |
| `other` | Drops the event. |

## Messages and state

The message poster owns conversation writes: turn-open processing placeholders,
assistant content, permission requests, completions, and submission-tool actions.
The `RunEventPublisher` owns process-local output and lifecycle events plus the
platform current-state and provider-identity emissions.

Transient processing status is not a browser message and is not exposed through
the loopback listener. It updates the provider-phase state used by the runtime.
Diffs remain run state in `RunContext.touchedFiles` and are persisted through
the run's normal file-change path.

## Message Threading with Prepend

The processing message is pre-created on `run_started` as a placeholder.
Intermediate output and permission requests are prepended before it, so the API
can rewire the parent-message chain while preserving conversation order.

```
turn-open:          poster.createOutOfBand(processing msg)
assistant_delta:    publisher.publishAgentOutput(...)
permission:         poster.prepend(permission req, before: processing msg)
processing_status:  publisher observes provider phase
assistant_complete: poster.complete(processing msg)
```

## Run

The `Run` class is the core discrete unit. It owns per-run mutable state,
dispatches normalized events, and invokes the provider-specific session runner.
Runs are held by the `RunRegistry`, indexed by run id.

The loopback listener is an internal agent-tool bridge. It does not own browser
REST routes or browser-local WebSocket connections.
