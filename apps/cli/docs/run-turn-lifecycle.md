# Run & Turn Lifecycle

## Why this document exists

The CLI's runtime has been built ad-hoc. A feature gets added wherever the
adjacent code lived, and nobody ever defines what a "run" is or how long
something lasts. The result is lifecycle bugs — things registered on one
timescale consumed on another — that keep surfacing in ways that are hard
to diagnose because there's no model to check the code against.

This document is the model. Part 1 names the concepts. Part 2 walks a
realistic multi-turn session through them. Code that contradicts anything
here is either wrong or requires the model to be updated.

---

## Part 1 — Concepts

### Run

A **Run** is the long-lived unit of work anchored to an
`agentic_session_id`. It persists across many user messages and typically
across many workflow nodes.

A Run owns:

- A **provider session** (Claude SDK, Codex, etc.). The provider session
  is initialized at the Run's first turn and resumed on every turn after.
- A **conversation** on the platform side (`conversationId` +
  `organizationId` + `projectId`).
- The **current `promptType`** — which handler is driving this moment of
  the Run. May change mid-Run (e.g. `feature_sync_analyze` →
  `startup_session`).
- The **current `externalAgentNodeId`** — which workflow node the Run is
  servicing, if any. Mirrors the server's workflow state.
- The **current Turn**, or `null` if idle.

A Run is *not* a single agent invocation. It's the container that holds
many invocations together, binding them through a shared provider session
and conversation.

### Turn

A **Turn** is one user-message → assistant-complete cycle. It is created
when the user sends a message and destroyed when the provider emits its
terminal event for that message. A Run has at most one active Turn at a
time; additional user messages during an active Turn are queued and
drained when the Turn ends.

A Turn owns:

- The **resolved prompt** — a single string to hand to the provider. One
  function produces this from `(promptType, payload, handler, prior run
  state)`. Not five branches.
- The **submission-tool set** that is live for this Turn — derived from
  the handler.
- The **processing message id** — the platform-side placeholder the
  provider's output will eventually update.
- The **dispatch choice** — which runner executes this Turn (subagent /
  resume / new-session). Selected once, at `begin()`.
- Its own **abort signal** and **queue drain** behavior.

A Turn has three phases:

1. **`begin()`** — resolve the prompt, post the user's message, allocate
   the processing message, stamp `promptType` + `externalAgentNodeId` on
   the Run, compute the submission-tool set, pick the runner.
2. **`run()`** — invoke the chosen runner. Events stream back through the
   runtime and update the processing message.
3. **`end()`** — clear per-Turn state on the Run, drain the queue,
   resolve the waiters.

Everything that's currently duplicated across five `.finally` blocks in
`local-agent-service.sendMessage` collapses into `Turn.end()`.

### Handler

A **Handler** owns a `promptType`. It is a pure data declaration of:

- How to build a prompt from a payload (`buildPrompt`).
- Whether to emit an opener (`buildStartingMessage`).
- What submission tools the agent is allowed to call this Turn.
- How to transform the agent's final output into a platform message
  (`transformOutput`).
- What to do after the Turn completes (`onComplete`).

A Handler is picked at `Turn.begin()` based on the Run's current
`promptType` and carried on the Turn for its entire lifetime. It is *not*
re-looked-up at `assistant_complete` from three different places.

### Provider Session

The **Provider Session** is the Claude SDK (or Codex, etc.) internal
session — conversation history, cached `mcpServers` config, cached
`allowedTools`, cached model. It is owned by the Run, initialized on the
first Turn, resumed on every Turn after.

The key invariant: the provider session's lifetime is exactly the
Run's. Anything configured into the provider session at session start
must remain valid for the entire Run. **Things that change per Turn
cannot be baked into the session config — they must be looked up
dynamically at call time.**

### Submission-tool Registry

The **Submission-tool Registry** is an HTTP endpoint's dictionary from
`token → toolset-plus-routing-info`. When the agent calls a submission
tool, the MCP server resolves the token and executes the call (post a
completion message, etc.).

The registry entry is **Run-scoped**, not Turn-scoped. One token per Run,
generated when the Run acquires a handler with submission tools. The
handler's tools don't change mid-Run; what changes per Turn is
`parentMessageId` and `externalAgentNodeId`, which the MCP endpoint
reads from the active Run at call time — not from the registration.

This is a correction of the current design, where the token rotates per
Turn but the Claude SDK caches the MCP URL at session start. That
mismatch is the root cause of "submission tools disconnected mid-flow."

### Workflow Service (server-side)

The **Workflow Service** lives server-side, not in the CLI. It runs
conversation-level state machines: "this conversation is paused at node
`feature-sync-analyze`; it expects a completion."

The CLI is a participant, not an owner. The server tells the CLI:

- *Which* `promptType` to run this Turn (via the message payload).
- *Which* `externalAgentNodeId` is active (if any).
- *What* `completesExternalAgentNode` envelope to return when the Turn
  wants to advance the workflow.

The CLI tells the server:

- Here is the user's message.
- Here is the agent's output.
- Here is the submission-tool completion (which, if it carries
  `completesExternalAgentNode`, the workflow service interprets as node
  advancement).

The CLI does not track workflow state beyond "what was the most recent
`externalAgentNodeId` for the active Run." The workflow service is
authoritative.

---

## Part 2 — Flow walkthrough

The user opens a feature and begins a coding session. What happens, in
terms of the concepts above.

### Step 1 — User starts a session

The user clicks "start session" on a task. The UI calls `POST /runs` with
a `promptType` (say, `feature_sync_analyze`) and a payload.

- The `RunService` finds or creates the `agentic_session_id`.
- A **Run** is materialized in the runtime with that id.
- The server also returns an `externalAgentNodeId` because the workflow
  is paused on the `feature-sync-analyze` EXTERNAL_AGENT node. The Run
  stamps it.
- The handler registry resolves `feature_sync_analyze`; because the
  handler declares submission tools, a **Submission-tool Registry** entry
  is created for this Run with a stable token.
- No Turn is created yet. `createRun` either returns an opener message
  (if the handler has one) or proceeds directly to kicking off the first
  Turn. This is a handler choice, not a lifecycle branch.

### Step 1b — Workflow-bound sessions (materialize-only, no first Turn)

Some sessions are driven entirely by a server-side Temporal workflow and
must have a Run **bound but not running** before the workflow emits its
first trigger. `plan-from-design-doc` is the canonical case: the plan,
design doc, and conversation are materialized at conversation-creation
time, and the graph opens straight on the `proposed-stages`
EXTERNAL_AGENT node — there is no in-graph opening gate.

The bind happens through the **materialize-only arm** of `start_run`.
The API's `startConversationRun` authors a `start_run` whose payload
carries `workflowName` and **no** `handlerPromptType`/`payload`. On the
CLI, `trigger-verification/dispatch.ts` translates it via
`buildCreateRunRequest`, which **omits `payload`**; `run.service` gates
the first Turn on `input.payload`, so an absent payload means the Run is
created and the conversation is bound **without firing a Turn**. Every
Turn is then driven by the workflow's own SYSTEM triggers.

**Connect-driven re-fan latency.** Because the bind and the workflow's
opening trigger race, the first `proposed-stages` trigger can arrive
*before* the Run is bound. The dispatcher drops it as `no_active_run`.
The CLI has no mechanism to nudge a platform re-fan and does not
re-deliver the dropped trigger itself — redelivery rides the platform's
next connect-driven re-fan (the re-fan-on-authenticate storm), so "Start"
is not strictly instantaneous; there is a sub-reconnect window of
latency. The `no_active_run` drop is intentionally kept out of the
trigger dedupe store so that the re-fan which lands after the bind still
dispatches instead of being collapsed as a duplicate.

### Step 2 — First Turn begins

`Turn.begin()` is called on the Run with the initial payload:

1. Prompt resolution: `handler.buildPrompt(payload)` → resolved prompt.
2. User message posted (platform).
3. Processing message allocated.
4. Submission tools — *already registered for the Run*; no per-Turn work.
5. Runner selection: no existing provider session → `runPrompt`.

`Turn.run()`: the Claude SDK starts, receives the `mcpServers` config
including the submission-tools server pointing at the Run's stable
token. The agent does its work, calls `submit_discrepancies` (or in the
new conversational flow, just talks and ends).

`Turn.end()`: clear per-Turn state on the Run. Submission-tool
registration **stays registered** — it belongs to the Run, not the Turn.
Drain the queue (empty). Resolve.

### Step 3 — Subsequent Turns, same promptType

User replies ("okay, the task is wrong on discrepancy 1"). New Turn:

- `Turn.begin()` — same handler, same promptType, same
  `externalAgentNodeId`. Prompt resolution takes the user text, wraps in
  whatever the handler specifies for follow-ups. No re-registration of
  submission tools — the existing registration is still correct.
- `Turn.run()` — `resumeSession` (provider session exists). The SDK's
  cached `mcpServers` config points at the same stable token. The agent
  calls `edit_task`, posts a proposal, replies "does this look good?".
- `Turn.end()` — drain, resolve.

This step is where the current code breaks and the new design doesn't.
The current registry rotates the token per Turn; the SDK's cached URL
points at the now-dead token; agent sees "MCP server offline." In the
new model, the token is stable for the Run, so this flow just works.

### Step 4 — Different promptType mid-Run

User says "ok ready." The agent calls `submit_no_discrepancy`. The MCP
endpoint posts the completion message with
`completesExternalAgentNode = { nodeId: feature-sync-analyze, action:
NO_DISCREPANCY }`. The workflow service advances to the next node —
`coding_plan` — and dispatches the next prompt to the CLI with
`promptType: startup_session`.

That arrives as a new message on the existing Run. Now:

- `Turn.begin()` — the Run's current `promptType` changes from
  `feature_sync_analyze` to `startup_session`. The new handler is picked.
- Submission tools: the old handler's tools may no longer be the right
  set. The Run's submission-tool registration is updated — **same token,
  different toolset**. The MCP URL doesn't change (the SDK's cached
  config is still correct); only the dictionary entry behind the token
  is swapped. The agent on the next tool-list call sees the new tools.
- `externalAgentNodeId` is updated to whatever the server sent for
  `startup_session` (or cleared if that node isn't EXTERNAL_AGENT).
- `Turn.run()` — resumeSession with a system-prompt prefix so the agent
  re-grounds for the new job (the handler-swap logic currently in
  `send_message.handler_changed` lives here).

Handler swaps mid-Run are a normal operation, not a special case.

### Step 5 — Subagents vs "fresh agent"

A **subagent** is a Turn whose runner is not the Run's provider session.
It's an isolated Claude SDK invocation with its own config, its own
system prompt, its own tool set. It produces events that are posted into
the *same conversation* as the parent Run, but does not pollute the
parent's provider session history.

Today: `commit`, `code_review`, `final_assessment` are subagent
promptTypes. Their dispatch branches in `sendMessage` each have their
own `.finally` — in the new model, subagents are just another runner
choice:

```
pickRunner(turn) = match turn.handler.runnerKind:
  subagent(kind)   => new SubagentRunner(kind, turn.handler.subagentConfig)
  provider_session => turn.run.hasProviderSession ? ResumeRunner : NewRunner
```

A subagent Turn still goes through `Turn.begin()` / `run()` / `end()`.
It still gets a processing message. Its output still flows through
`assistant_complete`. The only difference is where the agent actually
runs.

A **"fresh agent"** in the sense I think we've been using it is the
*non-subagent* version: a runner that starts a new top-level Claude SDK
session on the Run. Today that's what happens implicitly when a Run has
no provider session yet (the `else` branch in `sendMessage`). There's
no need for "fresh agent" to be its own concept — it's just the first
Turn's runner choice, identical in shape to a subagent runner except
that its session is persisted on the Run for future Turns.

The rule: **a Run has at most one persisted provider session.**
Subagent Turns use ephemeral sessions that are discarded on
`Turn.end()`. Non-subagent Turns use the Run's persisted session.

### Step 6 — Queued messages during an active Turn

If the user sends a message while a Turn is running, it's queued on the
Run. `Turn.end()` checks the queue; if non-empty, `drainQueue` greedily
dequeues a contiguous run of items that share the same `promptType`
(normalizing `undefined` and the `workflow-defined` sentinel to "matches
the Run's persisted promptType"), then dispatches that batch:

- **Batch size 1** — run as a standard Turn via the same path as a fresh
  `sendMessage`: `Turn.begin → run → end`, one user message posted, one
  processing message, one provider call.
- **Batch size ≥ 2, all same `promptType`** — run as a single **coalesced
  Turn**. `drainQueue` pre-posts one user message per queued item
  (preserving per-item UI granularity and any `userMessageData`), joins
  the per-item `transformInput`-d text with `\n\n`, and synthesizes a
  `LocalRunPromptRequest` that carries the joined text and an internal
  marker. The marker tells `prepare` to skip its user-message post (the
  individual user messages are already on the platform) while still
  posting the processing message, stamping `promptType` and
  `externalAgentNodeId` on the Run, registering submission tools, and
  picking the runner. The agent sees one logical turn — matching the
  original UX intent of rapid-fire user messages merging into a single
  provider call.
- **Mixed `promptType`** — if the queue has items with different
  promptTypes, only the leading same-`promptType` prefix batches. The
  tail stays in the queue; the active Turn's `Turn.end()` calls
  `drainQueue` again after it cleans up, and the next batch (with its
  own handler) begins its own Turn. Handler swaps thus happen between
  Turns, never inside one, so submission-tool state and handler
  registration stay consistent per Turn.

Queue coalescing is a transport-layer optimization inside `drainQueue`;
from the Run's perspective, every dispatch still goes through exactly
one `Turn.begin → run → end` cycle.

### Step 7 — Aborting and errors

Abort signals flow from the Run to the active Turn. `Turn.run()`
catches, logs, calls `Turn.end()` in `finally`. No runner needs its own
`.finally` for registry cleanup — `Turn.end()` is the single point.

Errors in a runner don't destroy the Run. The Run remains; its provider
session may or may not be usable depending on the error. The next Turn
decides whether to reuse or start fresh based on the session's state,
not on the previous Turn's error flag.

---

## Implementation notes (for the next doc, not this one)

This document defines the target. The migration doc is separate. But a
few invariants for whoever writes code against this model:

1. **`Turn.end()` is the only place that clears per-Turn state.** If you
   find yourself writing `activeRun.setLastSubmissionAction(null)` in
   three places, you're working against the model.
2. **The submission-tool token is stable per Run.** If the registry API
   lets a caller rotate it per Turn, fix the registry API, don't
   accommodate it at the call site.
3. **Prompt resolution is one function.** If you have branches for
   "follow-up vs first vs handler-swapped vs subagent-owned," they
   belong inside the resolver, not at the call site.
4. **Handler is picked once per Turn.** Stored on the Turn. Never
   re-derived from `ctx.promptType` at effects-layer time — read it off
   the Turn.
5. **`RunContext` is not a separate object from the Run.** Today it's a
   parallel struct used by the event pipeline. Merge it into the Run, or
   make it a projection of the Run. Don't let two things own the same
   fields.

## Fork-debug log capture

The CLI and API both emit a small set of structured events used to trace
the message-fork bug end-to-end. Capture them off the running CLI's
stdout (and the API's worker logs) by grepping on the event names below.
A `post_logs.txt` at the repo root is the conventional place to collect
the captured output for an investigation.

CLI-side events (component logger emits one JSON object per line):

- `local.route.runs.message.ingress` — POST `/runs/:id/message` arrival;
  carries the resolved request shape (`postAsUserMessage`, `hasPrompt`,
  `hasPayload`, `payload.action` when `promptType=node-decision`, and
  `references.resolvedCount`).
- `local.route.runs.prompt.request` — POST `/runs/:id/prompt` arrival;
  same resolved-shape fields as the message ingress.
- `local.service.send_message.workflow_defined_resolved` — workflow
  sentinel resolved; includes the workflow-supplied `triggerMessageId`,
  `nodeId`, and the Run's `priorPersistedPromptType` so CLI-vs-server
  drift is observable per dispatch.
- `local.run.turn.open.source` — one record per turn open; the `source`
  field is one of `user_message_dispatch | system_trigger_dispatch |
  coalesced_batch | node_decision_followup`.
- `local.submission.external_agent_node_id_mismatch` — `warn`-level;
  emitted from every site that posts a `completesExternalAgentNode`
  envelope (`submission-tools.dispatchActionTool`,
  `assistant-complete.pending_completion`,
  `message.service.nodeDecision`) when the declared `externalAgentNodeId`
  differs from the Run's currently-stamped value.

API-side events (Temporal worker / Nest service logs):

- `workflow.execute_flow_node.parent_choice` — one per node start;
  carries `previousLastSystemMessageId`, `userMessageId`, `chosenParent`,
  and a discrete `reason`.
- `workflow.execute_agent.cancel_and_restart` — one per restart of
  `handleAgentExecutionWithSignals` triggered by an in-flight user
  message; carries `incomingUserMessageId`, `currentNodeId`,
  `nextRequestId`, `attempt`.
- `workflow.message.prepend.write` — one per `prependMessage` write;
  carries the read-time and post-rewire parent-message-id values on
  `beforeMessageId`, plus the new message's id.
- `workflow.message.prepend.burst` — `warn`-level; fires when two
  prepends land on the same `beforeMessageId` inside a 100ms window.

When updating a capture filter, include all of the event names above so
the collected log captures the fork-debug surface end-to-end.
