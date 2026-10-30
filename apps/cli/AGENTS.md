# CLI

## Architecture

- Session-start orchestration lives in `src/commands/agent-session-starter.ts`; file references in `src/file-references/*`. Prompt startup input logic never lives in views.
- Views are render-only and communicate through callback props. Dispatcher/orchestrator files stay orchestration-only: when feature state or branching grows there, extract a feature module first.
- Stateful owners (services, stores, monitors, runners, coordinators) are concrete classes, not `createX()` closures returning object literals. The owner keeps collaborators as named objects and calls through them rather than passing methods around in dependency bags.
- A composition root constructs top-level owners in dependency order, and nothing more. Leaf owners build their own private collaborators.
- Don't declare an interface that just restates one concrete class. Tests use or spy on the concrete class. Interfaces are for real polymorphism, third-party boundaries and generated seams.
- Pure parsing, mapping and formatting stay functions. Pass the owning object instead of a bound method where you control the call site.

## Event pipeline

`provider → raw_events → normalizer → dispatcher → effects`

`provider-event-normalization.ts` is the single normalization layer. Nothing downstream re-normalizes or re-reads raw fields. If a handler needs more data, add it to the normalizer's output. Handlers act on typed data and never parse raw events.

## Session / Run / Turn

Invariants that are easy to break and invisible in a signature:

- `promptType` belongs to the Turn, not the Session or Run.
- A Turn is immutable once constructed and holds no reference to its Run. Run is the scheduler: it resolves Turn inputs, builds the Turn, and drains the queue.
- The provider session lives as long as the Run, so anything configured at session start must stay valid for the whole Run.
- The submission-tool registry entry is mutable per Turn; the Run-scoped token is not.
- With the workflow service, the server is authoritative about prompts.

## Messages

Message payloads posted to the platform are defined in `openapi/specs/schemas/conversations.yaml`. Define new payloads there first and regenerate. The agent bridge contract (`openapi/specs/agent-bridge/openapi.yaml`) covers only the loopback agent process; no conversation message belongs in it. Agent bridge types map to conversation message types in one mapping function.

## External data

Don't encode guesses about the shape, ordering, identity or relationships of data from systems we don't own (platform API, workflow service, SDK providers, websocket). If a spec, typed contract or representative log doesn't answer "is this always true?", check or log it instead of assuming. Past outages came from assuming that `parentMessageId` points at the latest user message, that USER messages always have a non-null `parentMessageId`, and that equal comment text means the same message. Validate external payloads once at the boundary (zod, generated types).

## Failure isolation

One invalid, unreadable or failed item must never block a whole list, batch, startup, or unrelated operation.

- Handle failures at the item or session boundary and keep processing independent items. No whole-array parses, aggregate rejections or cached initialization rejections that turn one bad record into a global outage.
- Block only the operation that needs the invalid input. Fail collection-wide only for an explicit atomicity requirement or a shared dependency that truly blocks everything.
- Don't discard failed durable work or treat unreadable data as empty. Report it with item-scoped, safe diagnostics.
- Example: a corrupt persisted input in one session must not stop another session from starting.

## Other

- Log every meaningful backend action, including every session resume path, with debug logs at decisions, state transitions and external boundaries, so a run is diagnosable end to end.
- When the user names a log file for a diagnosis, it is the only log source. Don't read other logs, including same-named files elsewhere, and don't treat them as evidence. If the file doesn't prove a claim, say so.
- No broad lint or type suppressions without user approval; approved ones are narrow and commented inline.
