# AGENTS

Task note: when working from a linked Git worktree, OpenAPI-derived generation must prefer the matching `../openapi/.worktrees/<worktree>` checkout and fall back to the main `../openapi` checkout; use `HEY_HEY_OPENAPI_ROOT` or the repository/tool-specific override only to pin a source.

This file is a CLI-specific overlay. For web UI work, follow
`/Users/zac/Desktop/code/hey-hey/ui-common/AGENTS.md` first and use this file
only for repo-specific deltas.

## 1) CLI Architecture Guardrails

- Session-start orchestration stays in `src/commands/agent-session-starter.ts`.
- File-reference feature logic stays in `src/file-references/*`.
- Prompt startup input logic stays in `src/commands/agent-startup-prompt-input.ts`
  or a dedicated prompt module, never in views.
- View components stay render-only and communicate via callback props.
- Dispatcher/orchestrator files remain orchestration-only. If feature state or
  branching grows there, extract to a feature module first.

### Stateful ownership and navigation

- Stateful services, stores, monitors, runners, coordinators, and lifecycle
  owners are concrete classes. Do not implement them as `createX()` factories
  that close over state and return object literals containing methods.
- The owner of a collaborator keeps that collaborator as a named object and
  calls it through that object (for example, `sessionMonitor.reportPolicy.handle()`).
  Do not extract methods and tunnel them through dependency bags under renamed
  function fields.
- A composition root constructs top-level owners in dependency order. It does
  not construct every leaf object, carry feature state, or mediate calls between
  objects. Leaf owners construct cohesive private collaborators themselves when
  no external implementation choice exists.
- Do not declare an interface that merely duplicates one concrete class. Keep
  interfaces only for real polymorphism, third-party boundaries, generated
  client seams, or deliberately narrow testable ports with multiple implementations.
  Tests must use or spy on the concrete class; test convenience is never a reason
  to add an interface that restates that class's public methods.
- Pure parsing, validation, mapping, formatting, and immutable data-building
  logic remains function-based. Classes are an ownership rule, not a blanket
  replacement for stateless functions.
- Public methods passed as callbacks must be explicitly bound or exposed as
  arrow properties when the receiving API truly requires a callback. Prefer
  passing the owning object whenever the receiver controls the call site.

## 2) Message Type Ownership

The CLI posts messages to the platform API. **We do not own the message types.**

- Message types (`CreateMessageDto`, `SystemMessageData`, `QuestionsSystemMessageData`,
  UI element payloads like `CodingPromptFinalAssessmentPayload`, etc.) are defined in
  `../openapi/specs/schemas/conversations.yaml`. That is the source of truth. The UI
  consumes these types. We build messages that match those shapes.
- When a new message payload is needed (e.g. a merged assessment), define it in
  `conversations.yaml` first, regenerate the platform API types, then use the generated
  type in CLI code.
- **Agent bridge OpenAPI** (`../openapi/specs/agent-bridge/openapi.yaml`) defines the
  loopback agent-process contract and generates `src/shared/agent-bridge-contract`.
  Hand-written runtime adapters there cover only internal in-memory orchestration
  types. Nothing that gets posted as a conversation message belongs in the bridge
  contract.
- Never invent message payload types in CLI code. Never use `Record<string, unknown>`,
  untyped objects, or JSON-stringified payloads for message data. Every message field
  must trace back to a generated type from `conversations.yaml`.

**Boundary rule:** Agent bridge generated/runtime types → mapping function →
conversation message types (conversations.yaml). The mapping function is where we
translate from what we own to what we don't.

## 3) Non-Negotiables

### CRITICAL: Isolate failures to the work they actually affect

**NEVER let one invalid, unreadable, or failed item block an entire list, batch,
startup, shared initialization, or unrelated operation. This is a hard rule for
every agent, including Codex.**

- Validate and handle failures at the individual item or owning session boundary.
  Continue processing independent valid items and keep unrelated operations usable.
  Do not let a thrown exception, whole-array parse, rejected aggregate promise, or
  cached initialization rejection turn one bad record into a global outage.
- Reject or block only the operation that actually requires the invalid input.
  The fail-fast rule below never authorizes validating unrelated records as a
  prerequisite for the requested operation. A collection-wide failure is justified
  only by an explicit authoritative atomicity requirement or a shared dependency
  whose failure actually prevents every affected operation from proceeding.
- Preserve failed durable work and report its failure with safe, item-scoped
  diagnostics. Do not silently discard it, treat unreadable data as an empty
  collection, fabricate defaults, or execute invalid input to keep processing.
- Example: a corrupt persisted input in one session must not prevent another
  session from starting. Loading an open-session index must isolate that session's
  failure and continue loading healthy sessions.
- When changing collection processing or shared initialization, verify that one
  failing item leaves independent items and operations working.

- Single path per feature state: no parallel old/new render or input paths.
- No placeholder identifiers or fallback coercions for required IDs.
- Fail fast only when context explicitly required by an authoritative contract is
  absent or invalid. Do not add speculative validation for internal typed inputs,
  future-valid enum members, or states that can be made unrepresentable by types.
- Outside tests, do not introduce `any`, `unknown`, or `Promise<unknown>`.
  Narrow unknown payloads at the boundary before feature logic.
- Do not use unchecked boundary casts such as `response.json() as T`.
- Do not add broad lint/type suppressions without explicit user approval.
  Any approved suppression must be narrow and documented inline.
- Backend changes must log every meaningful action, including all session
  resume paths, with extensive debug logs at control-flow decisions, validation
  branches, state transitions, and external/service boundaries so runtime
  behavior is fully diagnosable end-to-end.
- Use OpenAPI specs whenever possible. For any validation of input or generation of outpute
  check if there is an OpenAPI spec. Use `satisfies` to ensure compliance.
- OpenAPI generation supports focused outputs. The API surface in `../openapi/specs/api/openapi.yaml` has one stable tag per operation and an explicit `operationId`; use `--global-property=apis=Machines,AgentSessions` (or the smallest relevant tag set) for a focused client and `--global-property=models=ModelA,ModelB` for a focused model set, including transitive dependencies. Keep canonical generated directories complete unless all their consumers are covered by the filter.

## 4) Runtime Evidence and Log Scope

- When the user provides or names a log file for diagnosing a run, that file is the exclusive log source for that diagnosis. Do not search, read, compare, or substitute any other log file, including same-named files in another checkout, service directory, or older session, unless the user explicitly authorizes that specific file.
- Treat evidence from an out-of-scope log as unusable, even when it contains matching prompt types, run identifiers, timestamps, or events. Never use another log to explain an absence, establish that a handler ran, or claim that a record was truncated.
- Verify the exact path and the relevant run or session inside the user-named file before making runtime claims. If that file does not prove the claim, say so plainly and use source inspection only for static reasoning; ask before examining another log.

## 5) Delivery Checks

- After code changes, run `pnpm tsc --noEmit` and `pnpm test`.
- In status/final updates, report:
  - files changed
  - whether dispatcher/orchestrator boundaries stayed clean
  - the check results above
- Boundary bug fixes (routes, adapters, session/context mapping) require a
  negative-path test only when the boundary consumes untrusted data or an
  authoritative requirement defines an invalid/missing case. Do not invent
  rejection behavior solely to satisfy test coverage.

## Conversation output

- Present findings, audits, task inventories, and recommendations directly in the conversation, using clickable entity mentions. Do not create Markdown report or summary files unless the user explicitly requests a file. Repository instruction files may be edited when the user asks to add or change a rule.
