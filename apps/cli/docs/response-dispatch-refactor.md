# Response Dispatch Refactor

## Problem

Assistant `taskComplete` messages that embed a recognized `responseType` JSON blob (e.g. `final_assessment_v2`, `startup_plan_v1`) often post to the platform as raw prose + unparsed JSON text instead of structured messages.

The current pipeline has three independent paths that each try to detect and parse structured responses, and each one silently falls through to "post the raw summary" on any failure:

1. **`ProcessCollector`** (`src/agents/process/collector.ts`). Only runs when a multi-step process is active. Gates on `hasResponseTypeMarker`, parses with Zod, fires side effects via `combine()`. If the schema fails or the collector wasn't initialized for this run, no structured message is posted.
2. **Prompt-type handler `transformOutput`** (e.g. `coding-plan.handler.ts:164-235`). Each handler internally calls `parseStartupSessionPlanResponseFromText`, then `parseFinalAssessmentResponseFromText`, then falls through to a plain `AGENT` message with `event.summary` verbatim. Any parse failure silently drops to the fall-through.
3. **Default builder** (`assistant-utils.ts:17-34`). When no handler is registered or `transformOutput` returns `null`, stuffs the whole summary (preamble prose + JSON blob) into `response`.

The result: the same `responseType` detection logic is duplicated across handlers, each copy fails quietly, and unrelated prompt types that happen to emit a known response shape get no structured handling.

Confirmed example: a completed coding session emitted a `final_assessment_v2` JSON payload preceded by narrative prose. The parser (`parseFinalAssessmentResponseFromText`) parses it correctly in isolation, but the run wasn't going through the `final_assessment` process, so the collector never ran and the text was posted raw.

## Goals

1. **One place detects and dispatches `responseType`.** No per-handler parse fall-through. If a known `responseType` appears in any assistant-complete summary, it is parsed and posted as a structured message regardless of prompt type.
2. **Delete `ProcessCollector` and the multi-step process framework.** Multi-prompt chaining for things like "then update neighborhood tasks" belongs in a tool call, not in a second-hop prompt driven by client orchestration.
3. **Handlers stop owning response parsing.** They declare the UI shape for `responseType`s they want to surface specially (startup plan, final assessment) but no longer call parsers themselves.

## Ideal End State

### Central dispatcher

New module `src/agents/response-dispatch.ts` exports a single function used by `handleAssistantComplete` before any handler logic:

```ts
dispatchResponseType(event.summary) →
  | { matched: true, updateData: UpdateMessageDto, sideEffects: SideEffect[] }
  | { matched: false }
```

Internally it maintains a registry keyed by `responseType`:

```ts
register('final_assessment_v2', {
  parse: parseFinalAssessmentResponseFromText,
  buildMessage: (parsed) => ({ data: { ... uiElements with CodingPromptFinalAssessment ... } }),
  sideEffects: (parsed, ctx) => [{ type: 'sync_final_assessment_report', assessment: parsed }],
});
```

Entries: `final_assessment_v2`, `startup_plan_v1`, `merged_final_assessment_v1`, `neighborhood_task_updates_v1`, `verification_plan_v1`, `child_task_description_update_v1`, `set_splitting_v1`, `design_doc_sync_v1`, `reconciliation_report_v1`, `rollup_proposal_v1`, `daily_session_v1`, `report_update_v1`.

Detection rule: scan `summary` for a lowercase match of `responsetype` AND any registered responseType token. On match, extract JSON (`extractStructuredJsonPayload`), parse with the registered schema. On schema failure, fall through to the handler / plain text path — parse-failure logging is loud but non-fatal.

### Flow in `handleAssistantComplete`

1. Call `dispatchResponseType(event.summary)`.
2. If matched: complete the processing message with `updateData`, fire side effects, done.
3. If not matched: fall through to current handler logic (`handler.transformOutput` → default builder), minus every path that re-parses `responseType`.

### Handler changes

- `coding-plan.handler.ts`: drop the parse calls from `transformOutput`. If the handler still needs to add `actionHint: TaskComplete` on the default text path, keep that branch; else delete `transformOutput` entirely.
- `daily-session.handler.ts`, refiner handlers, `report-update.handler.ts`: same cleanup — remove internal `parseXxxResponseFromText` calls and let the dispatcher handle structured responses. Handlers retain `onComplete` for non-message side effects (e.g. report creation).
- Specialized UI shapes (`CodingPromptStartupPlan`, `CodingPromptFinalAssessment`) move from handlers into dispatcher entries.

### Deletions

- `src/agents/process/` (whole directory): `collector.ts`, `registry.ts`, `process-types.ts`, `collector.test.ts`, `registry.test.ts`, `index.ts`, `PROCESS.md`, `__fixtures__/`.
- `'process_checkpoint'` event type and payload from `src/session/types.ts`.
- `ApiEventType` exclusion and checkpoint branches in `src/server/local-agent-service.ts` (~lines 302, 323, 330, 1150–1237).
- Collector branch (lines 20–54) in `src/server/runtime/handlers/assistant-complete.ts`.
- `collector` field on `RunContext` and its constructors.
- `signalCollectorRunComplete` in runtime and its call site.
- `docs/process-pipeline-migration.md`.
- The `neighborhood_task_updates` chained-step flow goes away. If that behavior is still wanted it comes back as a tool call the agent invokes during the initial `final_assessment` run, not a second prompt orchestrated by the client.

## Non-Goals

- Rewriting any Zod schemas or response parsers. Dispatcher reuses existing `parseXxxResponseFromText` functions and `extractStructuredJsonPayload`.
- Changing the platform API surface. All structured messages already accept `{ data: { content, processResponseType } }` or `{ data: { uiElements: [...] } }`.
- Changing per-handler `prepare` / `buildPrompt` / `onComplete` / side-effect APIs — only the `transformOutput` parse logic moves.

## Acceptance Criteria

- A coding session that emits a `final_assessment_v2` JSON blob in its completion message posts as a structured message with `processResponseType: 'final_assessment_v2'` and the final-assessment UI element — without the `final_assessment` process being active.
- A `startup_session` run posts a `CodingPromptStartupPlan` UI element whether or not the startup handler's legacy `transformOutput` parse path exists.
- Summaries with no recognizable `responseType` still post as plain `AGENT` messages with the raw text.
- `src/agents/process/` no longer exists; `'process_checkpoint'` no longer appears in the event type union; tests compile and pass.
- No handler file imports `parseXxxResponseFromText` for output dispatch (they may still import parsers for input transformation where relevant, e.g. `coding-plan` `transformInput`).
