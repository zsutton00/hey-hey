# Runtime Rewrite Plan

## Problem

runtime.ts is an 860-line file that mixes provider selection, output emitting, pipeline construction, diff/permission routing, and the runtime factory. message-poster.ts is a 900-line god-function that re-classifies everything the pipeline already classified. The processor/emitter loop architecture means every processor sees every event and nobody owns any decision — so message-poster reimplements all the logic in a parallel if/else tree.

The immediate trigger: we need one message per agent turn (pre-create, update, complete). The current architecture makes this intractable because there are 7+ code paths that create messages and no single point of control.

## Invariants

1. Message poster — dumb client, three methods: create, update, complete. Zero classification logic.
2. Event handler — normalize the event, switch on type, dispatch to handler. No processor loop. No emitter loop.
3. Runtime directory — split runtime.ts into src/server/runtime/. Providers get their own files under runtime/providers/.
4. Run state — state that spans events (processing message ID, accumulated file changes) lives on the run, not in processor closures.

## Target Architecture

Session Runner (claude | codex)
|
v
Output Handler (receives raw events)
|
v
Normalizer (classify event kind)
|
v
Event Dispatcher (switch on kind)
|
+-- assistant (intermediate) --> update processing message
+-- assistant (taskComplete) --> complete processing message
+-- lifecycle (run_started) --> create user message + create processing message
+-- lifecycle (run_completed)--> complete processing message (if not already)
+-- diff --> track files on run (no message)
+-- permission --> send over WebSocket (not a message)
+-- user --> create user message
+-- other --> drop

## Message Poster API

typescript
interface MessagePoster {
create(args: { orgId, projectId, conversationId, parentMessageId?, dto }): Promise<string>;
update(args: { orgId, projectId, messageId, data }): Promise<void>;
complete(args: { orgId, projectId, messageId, data }): Promise<void>;
}

## Directory Structure

src/server/runtime/
index.ts -- createLocalAgentServerRuntime, exports
types.ts -- LocalAgentOutputEvent, interfaces
event-handler.ts -- normalize + dispatch (the switch)
message-poster.ts -- dumb client: create, update, complete
providers/
claude.ts -- claude runner creation + config
codex.ts -- codex runner creation + config
select.ts -- provider selection logic

## Event Handlers (one per kind)

Each handler is a function that receives the normalized event and run context (including processing message ID, org/project/conversation). It does its thing and returns.

- assistant — if processing message exists: intermediate updates call poster.update, taskComplete calls poster.complete. If no processing message (legacy): poster.create.
- lifecycle/run_started — post user message via poster.create, pre-create processing message via poster.create with system_processing status, store message ID on run.
- lifecycle/run_completed — if processing message still open, poster.complete.
- diff — call runStore.addTouchedFiles. No message.
- permission — emit over WebSocket. No message. (Queue/pause behavior TBD separately.)
- user — poster.create with user message DTO.

## Migration Path

1. Create src/server/runtime/ directory with new files
2. Implement message poster (3 methods)
3. Implement event dispatcher + handlers
4. Wire into existing session runners (they already call an onAgentOutput callback)
5. Delete old message-poster.ts postMessageForEvent
6. Delete pipeline processors that are now handled by event handlers
7. Delete createOutputEmitter from old runtime
8. Move provider logic to runtime/providers/

## Open Questions

- Permission request queue/pause mechanism — how to coordinate with agent when permission is needed. Deferred to separate task.
- Realtime updates (processing_status / thinking) — currently posted via a separate realtime endpoint. Likely stays as-is since it's already a targeted update to the processing message.
  "}}},"enrichment_metadata":{"reason":"Write: /Users/zac/Desktop/code/hey-hey/cli/docs/runtime-rewrite-plan.md","agent_intent":null,"referenced_files":["/Users/zac/Desktop/code/hey-hey/cli/docs/runtime-rewrite-plan.md"],"referenced_diffs":[]},"raw_event":{"toolName":"Write","toolInput":{"file_path":"/Users/zac/Desktop/code/hey-hey/cli/docs/runtime-rewrite-plan.md","content":"# Runtime Rewrite Plan

## Problem

runtime.ts is an 860-line file that mixes provider selection, output emitting, pipeline construction, diff/permission routing, and the runtime factory. message-poster.ts is a 900-line god-function that re-classifies everything the pipeline already classified. The processor/emitter loop architecture means every processor sees every event and nobody owns any decision — so message-poster reimplements all the logic in a parallel if/else tree.

The immediate trigger: we need one message per agent turn (pre-create, update, complete). The current architecture makes this intractable because there are 7+ code paths that create messages and no single point of control.

## Invariants

1. Message poster — dumb client, three methods: create, update, complete. Zero classification logic.
2. Event handler — normalize the event, switch on type, dispatch to handler. No processor loop. No emitter loop.
3. Runtime directory — split runtime.ts into src/server/runtime/. Providers get their own files under runtime/providers/.
4. Run state — state that spans events (processing message ID, accumulated file changes) lives on the run, not in processor closures.

## Target Architecture

Session Runner (claude | codex)
|
v
Output Handler (receives raw events)
|
v
Normalizer (classify event kind)
|
v
Event Dispatcher (switch on kind)
|
+-- assistant (intermediate) --> update processing message
+-- assistant (taskComplete) --> complete processing message
+-- lifecycle (run_started) --> create user message + create processing message
+-- lifecycle (run_completed)--> complete processing message (if not already)
+-- diff --> track files on run (no message)
+-- permission --> send over WebSocket (not a message)
+-- user --> create user message
+-- other --> drop

## Message Poster API

typescript
interface MessagePoster {
create(args: { orgId, projectId, conversationId, parentMessageId?, dto }): Promise<string>;
update(args: { orgId, projectId, messageId, data }): Promise<void>;
complete(args: { orgId, projectId, messageId, data }): Promise<void>;
}

## Directory Structure

src/server/runtime/
index.ts -- createLocalAgentServerRuntime, exports
types.ts -- LocalAgentOutputEvent, interfaces
event-handler.ts -- normalize + dispatch (the switch)
message-poster.ts -- dumb client: create, update, complete
providers/
claude.ts -- claude runner creation + config
codex.ts -- codex runner creation + config
select.ts -- provider selection logic

## Event Handlers (one per kind)

Each handler is a function that receives the normalized event and run context (including processing message ID, org/project/conversation). It does its thing and returns.

- assistant — if processing message exists: intermediate updates call poster.update, taskComplete calls poster.complete. If no processing message (legacy): poster.create.
- lifecycle/run_started — post user message via poster.create, pre-create processing message via poster.create with system_processing status, store message ID on run.
- lifecycle/run_completed — if processing message still open, poster.complete.
- diff — call runStore.addTouchedFiles. No message.
- permission — emit over WebSocket. No message. (Queue/pause behavior TBD separately.)
- user — poster.create with user message DTO.

## Migration Path

1. Create src/server/runtime/ directory with new files
2. Implement message poster (3 methods)
3. Implement event dispatcher + handlers
4. Wire into existing session runners (they already call an onAgentOutput callback)
5. Delete old message-poster.ts postMessageForEvent
6. Delete pipeline processors that are now handled by event handlers
7. Delete createOutputEmitter from old runtime
8. Move provider logic to runtime/providers/

## Open Questions

- Permission request queue/pause mechanism — how to coordinate with agent when permission is needed. Deferred to separate task.
- Realtime updates (processing_status / thinking) — currently posted via a separate realtime endpoint. Likely stays as-is since it's already a targeted update to the processing message.
