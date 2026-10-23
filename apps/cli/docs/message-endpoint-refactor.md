# Message Endpoint Refactor

## Problem

The current local agent API has three endpoints for the run lifecycle:

1. **createRun** — Creates a session. Optionally initializes the prompt if `promptType`/`payload` are provided.
2. **submitPrompt** — Initializes a prompt on an existing run. Duplicates what createRun can already do inline.
3. **resume** — Sends a follow-up message. Contains complex branching logic that checks `sessionContext.deferredPrompt` and `sessionContext.promptSubmitted` to decide whether this is the "first real message" or a follow-up.

This forces the frontend to maintain a state machine: "Did I already call submitPrompt? Should I call resume or submitPrompt? What if the user refreshes — how do I know which endpoint to call?" This complexity is unnecessary and produces bugs. The backend has the session state — it should make these decisions, not the frontend.

## Goals

1. **The frontend should never need to track which phase of the lifecycle it's in.** It creates a run, then sends messages. That's it.
2. **The backend owns the state machine.** It knows whether the session has been initialized, whether there's a deferred prompt waiting, whether the provider session exists. It should use that knowledge to route internally.
3. **Eliminate bookkeeping flags.** The `promptSubmitted` flag in sessionContext exists only because two separate endpoints needed to coordinate. Real state (does a provider session exist?) replaces artificial flags.
4. **Idempotent createRun.** Calling createRun twice for the same entity should return the existing run, not error or create a duplicate.

## Ideal End State

Two endpoints:

### `POST /runs` (createRun)

Creates the session and initializes the prompt. For handlers with an opener (like task-refiner), this stores the deferred prompt and emits the opener event. The frontend gets back the run and displays the opener. For handlers without an opener, this kicks off the agent immediately.

Idempotent — if the run already exists, returns it.

### `POST /runs/:id/message`

Sends a message to a run. The backend inspects session state to determine what to do:

- **Deferred prompt exists** — This is the first user message after an opener. The backend combines the stored system prompt with the user's message and starts the agent. The deferred prompt is cleared.
- **Provider session is active** — This is a follow-up message in an ongoing conversation. The backend resumes the provider session with the new message.
- **Typed prompt provided** — The request includes `promptType`/`payload` (for cases where createRun didn't inline the initialization). The backend resolves and runs the prompt.
- **Explicit prompt handler, no prior session** — First message on a run that was created without prompt initialization. The backend treats it as the initial `runPrompt`.

The frontend doesn't need to know which of these paths executes. It just sends `{ prompt: "user's text" }` and the backend does the right thing.

### What dies

- The `submitPrompt` endpoint and service method
- The `resume`/`continueRun` endpoint and service method
- The `promptSubmitted` sessionContext flag
- All frontend logic that tracks "which endpoint should I call next"

### Design Principle

The provider session ID is the source of truth for session state. A `pending_*` prefix means the session hasn't started with the provider yet. A real ID means it has. This replaces all bookkeeping flags. The backend reads real state and acts accordingly — no flags, no coordination between endpoints, no frontend state machines.
