# Feature-Sync Node Roles — Redesign

**Status:** proposed
**Scope:** `cli/src/agents/feature-sync/*` (prompts + handlers + tests); coordinates with an API-side guard removal (separate change).
**Author's note:** This supersedes an earlier in-tree prompt patch (uncommitted on `dev`) that tried to fix the bug below by adding rules to the analyze prompt. That patch treated a symptom; this redesign removes the cause.

---

## 1. Summary

The feature-sync flow has two externally-executed agent nodes, `analyze` and `iterate`. Their responsibilities have blurred: `analyze` currently detects drift **and** drafts fixes **and** runs a multi-turn conversation with the user **and** decides its own terminal. That overload produced a real, user-visible failure (an agent freelancing a `create_plan`) and forced a server-side "guard" to paper over the resulting contradictory state.

This redesign restores the division the node names already imply:

- **`analyze` finds the issues and suggests changes, then submits one of two trivial verdicts.** It is read-only and never converses.
- **`iterate` handles the rest** — it is the only node that talks to the user and the only node that mutates, and it can only terminate based on the user's content.

Under this split the failure mode is **structurally impossible**, and the server-side guard becomes redundant and is removed.

---

## 2. Background: the two-layer model

The workflow contract draws a hard line:

- A **node** is the *skeleton* — it decides control flow (which node runs next) and authors no user-facing content.
- The dispatched **CLI agent** is the *voice* — it does the work and authors the turn's user-facing content.

Routing is **action-keyed**: each external-agent node declares an `action → nextNode` map, and the engine advances on the completion's `action`. An agent's action reports *what it found*, never *that the user has signed off*. **Advancement past flagged work is user-owned** — the flow parks on something the user owns; there is no agent-adjudicated exit from flagged work.

Two message shapes carry the mechanism on the conversation bus:

- **Trigger** — a SYSTEM message carrying `data.triggersAgent` (a `promptType`, a `nodeId`, and the message's own id as `triggerMessageId`). Emitted when an external-agent node is entered. Means "an agent owes a turn here."
- **Completion** — a message carrying `data.completesExternalAgentNode.completesTriggerMessageId`, posted by the executor that ran the trigger. The engine routes on its `action`.

**Pending = triggers − completions.** A trigger is "open" until some completion back-references its id. The platform projects this set (`api/src/services/workflows/pending-trigger.service.ts`) and the CLI mirrors it. `getConversationPromptType` reports one of three states:

- `agent-pending` — an open trigger exists; the CLI owns the next turn and gets a non-null `triggerMessageId`.
- `live-non-agent` — the flow is alive but parked on a non-agent gate (waiting on a human); no trigger.
- `terminal` — the flow is complete, gone, or never attached; no trigger.

The CLI binds a trigger to a turn **only** in the `agent-pending` case (`cli/src/server/services/message.service.ts:407-408`). Any other state dispatches the resolved `promptType` with `triggerContext: null`.

---

## 3. The bug

### 3.1 Symptom

A feature-sync analyze session ended with the agent authoring a full **plan** (`create_plan`) that no one asked for — an entirely off-the-rails turn. It does not reproduce every time, which is itself a clue.

### 3.2 Evidence (run `f470e334-44a4-406f-94ba-6fe9458e411d`, 2026-06-22)

Recorded under `~/Library/Application Support/heyhey/runs/f470e334….{json,events.jsonl,tool-usage.json}`.

- The whole run made **exactly one** submission-tool call: `submit_no_discrepancy`. There was **never** a `submit_discrepancies`. (tool-usage.json: `submit_no_discrepancy:1`, `edit_work_item:1`, `create_plan:1`; no `submit_discrepancies`.)
- The analyze turn's tool order was: `get_feature_sync_context` → `get_context` → `get_full_entity` → **`edit_work_item`** (drafted a `fulfilledBy` proposal, returned `status:"proposed"`) → `create_report` ×2 → **`submit_no_discrepancy`** (input `{}`).
- The server response to `submit_no_discrepancy` was the string **`"Recorded completion with action=NO_DISCREPANCY."`**
- The *next* turn was dispatched `mode:"resume"` against the **same provider session**, with `promptType: feature_sync_analyze` (run.json top-level **and** `lastTurnSummary.promptType`), and **`triggerMessageId: null`, `triggerExternalAgentNodeId: null`** (verified present-and-null via `jq has()` + `type`, not a missing key). Its entire prompt body was:

  ```
  ## Prior turn output (feature_sync_analyze)

  <analyze's closing summary about adding a second fulfilledBy cite>

  ---

  All proposals approved, ready for the next phase
  ```

  That turn ran `create_plan` and authored a design doc. The run has **no** `flowId`/`workflowId`/`workflowName`.

### 3.3 Root cause (causal chain)

1. **`analyze` drafted a proposal and then claimed no discrepancy in one shot.** It called `edit_work_item` (creating a DRAFT proposal on the conversation) and then `submit_no_discrepancy` — never `submit_discrepancies`. The two states "I just proposed an edit" and "no discrepancy" are contradictory, and the node skeleton currently lets them coexist on one turn.

2. **`"Recorded completion"` is a CLI post-ack, not platform acceptance.** `postSubmissionAction` (`cli/src/agents/submission-tools/action-poster.ts:140-160`) just appends the completion message to the conversation tail via `createOutOfBand` and returns success text (`cli/src/agents/submission-tools/http-mcp.ts:493`). The platform validates and advances **asynchronously**, after the CLI already told the agent "recorded." So the agent and its SDK session believe the turn succeeded regardless of the engine's decision.

3. **`NO_DISCREPANCY` did not advance the workflow.** By design, the platform's completion receiver rejects a `NO_DISCREPANCY` verdict when conversation-scoped DRAFT proposals exist (`api/src/core/processing/external-agent-completion-rules.service.ts:29-44`), and on rejection `message-processor.service.ts:638-650` marks the completion Failed and **returns without signaling** the workflow (signal is at `:709`). The drafted `fulfilledBy` proposal made the clean verdict contradict a live draft → no transition. (Log-proven: the next turn came back as `feature_sync_analyze`/null-trigger, *not* `coding_plan`/agent-pending, so no advance happened. That the rejection guard *specifically* blocked it is inferred from the code path — there are no platform logs for this conversation in the local capture.)

4. **The trigger was still consumed.** The pending projection keys only on `completesTriggerMessageId`; it does not care whether the rules guard accepted the verdict. So the posted completion closed the analyze trigger while the workflow refused to advance — leaving the conversation in limbo: **no open trigger, and no successor trigger**.

5. **The user's approval had nowhere to go.** When the UI auto-advance posted `"All proposals approved, ready for the next phase"`, `getConversationPromptType` returned a **non-`agent-pending`** verdict (`promptType: feature_sync_analyze`, no trigger). Per `message.service.ts:407-408` the CLI dispatched that `promptType` with `triggerContext: null` — a bare, triggerless resume of the analyze session. With no trigger there was no bounded handler turn and no valid terminal to call, so the unanchored agent improvised and ran `create_plan`.

### 3.4 Why it's intermittent

There is no deterministic code path that creates the Plan — step 5 is an LLM improvising against a vague "ready for the next phase" nudge in a triggerless resume. When the same approval instead lands while a real `feature_sync_iterate` trigger is open (`agent-pending`), the iterate handler runs *bounded*, reads the approval, and answers `submit_resolved`. The freelance only happens on the runs where the approval arrives with the pending set already empty.

### 3.5 What is **not** the cause

Tool reachability is **immaterial**. `create_plan` is reachable because `BUILTIN_ALLOWED_TOOLS` unions the entire MCP tool list into every session (`cli/src/agents/mcp-server-config.ts:167-169, 255-257`), but removing it would only change *which* tool the unanchored agent freelances next (`create_work_item`, `edit_work_item`, a design doc, …). It controls the *flavor* of the misfire, never *whether* one happens. Correctness lives in the node skeleton and the agent's role, not the permission surface. Tool-surface narrowing is explicitly **out of scope** here (see §7).

---

## 4. Why the current design is wrong

`analyze` today (`cli/src/agents/feature-sync/prompts.ts`) is the full conversational front of the flow:

- It renders a discrepancy table and a numbered list of self-authored reconciliation options.
- It **drafts** platform edits (`edit_work_item`, `requirementOps` `fulfilledBy` enrichment).
- It runs a multi-turn confirm/revise conversation and "treats an item as resolved only after the user confirms."
- It then decides its own terminal.

`iterate` (`ITERATE_SYSTEM_PROMPT`) is, by contrast, a thin adjudicator that is told *not* to re-walk the tree and does no drafting.

So the node that is *named* "analyze" is doing the proposing and the talking, and the node *named* "iterate" only rubber-stamps. The bug is a direct consequence: because `analyze` both mutates and emits a "nothing happened" terminal, it can produce the contradictory draft-plus-clean-verdict state — and the only defense was a server-side guard bolted on to reject that state after the fact. The guard is a band-aid over a self-inflicted wound.

---

## 5. New design: clean two-node split

The responsibilities follow the names, with no overlap.

### 5.1 `analyze` — read-only detection

- Walks the feature tree, finds drift, and produces a **discrepancy table** as its turn output — one row per issue: `summary`, `rationale`, the entity it points at (`entityType`/`entityId` when applicable), and a **suggested change** as descriptive data (the `proposal` field), *not* a drafted edit.
- Submits exactly one of two trivial verdicts **on that same turn**:
  - rows present → `submit_discrepancies({ discrepancies: [...] })`
  - nothing found → `submit_no_discrepancy()`
- **Never** mutates (no `edit_work_item`/`requirementOps`), **never** waits on the user, **never** runs a confirm/revise loop.

Key invariant: *a suggested change is itself a discrepancy.* There is no "clean walk that nonetheless suggests something" — that is a `DISCREPANCY` by definition. So `NO_DISCREPANCY` cannot coexist with a suggestion, and the §3 failure mode cannot be constructed.

### 5.2 `iterate` — the voice and the mutation

- Entered from `analyze.DISCREPANCY` carrying the table. It is the only node that **talks to the user** and the only node that **mutates** — it discusses the table, drafts/applies the actual edits (`edit_work_item`/`requirementOps`) as the user agrees, creating the DRAFT proposals the user then approves on the review surface.
- Terminates **only on the user's content**:
  - user accepts (including the deterministic `"All proposals approved, ready for the next phase"` literal, or a clear affirmative) → `submit_resolved()`
  - user requests changes → `submit_revised({ discrepancies: [...] })` and the node self-loops
  - reply is a question / not yet decided → answer and wait; do **not** force a terminal
- Never self-adjudicates. Because the only terminal-bearing node is gated on user content, **"advancement past flagged work is user-owned" falls out for free** — no separate gate node required; `iterate` *is* the user-owned surface.

### 5.3 End-to-end flow

```
analyze (read-only)
  ├─ nothing found ──────────────► submit_no_discrepancy ─► CODING_PLAN
  └─ issues found → table ────────► submit_discrepancies ─► ITERATE
                                                              │
ITERATE (talks + mutates)                                     ▼
  presents table → drafts edits as user agrees → user approves proposals
     ├─ user accepts ───────────► submit_resolved  ─► CODING_PLAN
     └─ user wants changes ─────► submit_revised   ─► ITERATE (self-loop)
```

The node graph (`api/src/flows/templates/feature-sync.flow.ts`) already routes exactly this; no flow-template change is expected.

### 5.4 Why the guard is removed

The completion-rules guard exists only to catch "analyze left a DRAFT proposal but claimed `NO_DISCREPANCY`." Under §5.1 `analyze` creates no DRAFT proposals at all, so the guard has nothing to guard — it is redundant and is removed.

**Dependency:** the guard removal is only safe **together with** the role fix. Removing the guard *without* §5.1 would make the old contradictory turn (`analyze` drafts + `NO_DISCREPANCY`) silently *advance* instead of stall — arguably worse. The two halves must land coherently.

---

## 6. Changes required

### 6.1 API (separate change, owner: Zac)

- **Remove** `ExternalAgentCompletionRulesService` and its call site in `message-processor.service.ts:638-650`. Redundant under the new model (§5.4).
- Confirm flow routing is unchanged: `analyze` `DISCREPANCY→ITERATE` / `NO_DISCREPANCY→CODING_PLAN`; `iterate` `RESOLVED→CODING_PLAN` / `REVISED→ITERATE`.

### 6.2 CLI (this change)

- **`prompts.ts` — gut `analyze` to read-only.** Reduce to: walk the tree → emit the discrepancy table → one trivial verdict that turn. Delete the conversation steps (`ANALYZE_FREE_WHEN_OFF` / `ANALYZE_PLAN_WHEN_OFF`), the narrative-observations branch, `ANALYZE_PLAN_NO_FLAG_TERMINAL`'s multi-branch logic, `ANALYZE_PLAN_PROPOSAL_GATE`, `ANALYZE_PLAN_OBSERVATION_FOLLOWUP`, and the `edit_work_item`/`fulfilledBy` *drafting* instructions in `ANALYZE_ACTIVE_TASK_AS_FULFILLER` (keep the matching logic, but it produces a *suggested* table row, not a draft). This also discards the earlier in-tree patch, which is moot once `analyze` never drafts.
- **`prompts.ts` — expand `iterate`.** Give it the conversation + drafting responsibilities that move out of `analyze` (`edit_work_item`/`requirementOps`), while keeping the existing dual-signal acceptance logic (`RESOLVED`/`REVISED`/keep-talking) and the named auto-advance literal. State explicitly that it terminates only on user content and that on first entry it presents the table and waits.
- **`analyze.handler.ts` / `iterate.handler.ts`.** Submission-tool registration is unchanged (`analyze`: `submit_no_discrepancy`/`submit_discrepancies`; `iterate`: `submit_resolved`/`submit_revised`). `analyze` should carry no mutation tools; `iterate` carries the mutation tools it needs. (Reachability is unaffected by the `BUILTIN` union, so this is role hygiene, not a functional gate.)
- **Tests** (`__tests__/feature-sync.handlers.test.ts` + a prompt-shape test). Replace the in-tree assertions about analyze's drafted-proposal handling with assertions for the new split: analyze's prompt contains **no** drafting/conversation/observation/gate language and names only its two verdicts; iterate's prompt owns the edits, names the auto-advance literal, and states the user-content-only terminal rule.

---

## 7. Non-goals

- **Tool-surface narrowing** (`BUILTIN_ALLOWED_TOOLS`). Immaterial to this bug (§3.5). If the union is reworked later it must account for the SDK freezing `allowedTools` at session mint (resume turns inherit the minting handler's set) — tracked separately.
- **Flow-graph changes.** The existing routing already supports the new split.

---

## 8. Open questions / risks

1. **`iterate` entry behavior.** On first entry (from `analyze.DISCREPANCY`) there is no user reply yet. The prompt must make `iterate` present the affordance and **wait**, never firing a terminal before the user has spoken. This is the load-bearing expression of "terminates only on user content" and must be unambiguous in the prompt.
2. **Where the table is rendered.** `analyze` authors the table as its turn output (the voice). `iterate` must not re-narrate it (a turn that already spoke) — it provides the response surface only. Confirm this matches the render rules so the user doesn't see the table twice.
3. **Reconciling the in-tree patch.** The uncommitted `prompts.ts` / `feature-sync.handlers.test.ts` edits on `dev` must be reverted/replaced as part of §6.2, not layered on top.
4. **Guard-removal ordering.** §5.4 — the API and CLI halves must be coherent; if they ship separately, the window between them should not leave `analyze` able to draft while the guard is gone.

---

## 9. Acceptance criteria

- `analyze`'s assembled prompt contains **no** mutation, conversation, confirm/revise, narrative-observation, or proposal-gate language; it instructs exactly one read-only walk producing a table and exactly one of `submit_no_discrepancy` / `submit_discrepancies` on that turn.
- `iterate`'s prompt owns the user conversation and the actual edits, names the `"All proposals approved, ready for the next phase"` literal, and states that a terminal fires only in response to the user's content.
- The completion-rules guard is removed; no feature-sync regression in the suite.
- Prompt-shape tests pin the new split.
- **Behavioral invariant:** a feature-sync analyze turn can never leave a DRAFT proposal attached, because `analyze` never drafts — so the §3 contradictory state is unconstructable rather than guarded.
