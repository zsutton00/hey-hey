import { implementationResponsibility } from '../prompts/knowledge-responsibilities';
import { buildCompletionReconciliationPromptFor } from '../completion-reconciliation/prompts/common';
/**
 * System-prompt builder for the implement prompt type.
 *
 * A turn ends with the agent's normal task-complete assistant message (or
 * a question to the user). No submission tool is involved — the CLI
 * dispatches implement on every user reply via the workflow-defined
 * prompt-type resolution path.
 *
 * When the handler's `prepare` step resolves an approved plan plus
 * service/session identifiers, they are inlined here so the first turn's
 * prompt carries the approved plan and ids. The turn runs on the
 * Run-lifetime provider session, so context accumulates within the run and
 * later turns resume that session rather than re-walking the conversation.
 */

import type { LocalImplementPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type { LocalStartupSessionPlanResponse } from '../../shared/agent-bridge-contract/index';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import { buildServicesContextBlock, codingServiceScopeGuidance } from '../prompts/common';
import { decisionNeededPromptBlock } from '../prompts/decision-needed';

export interface ImplementPromptInput {
  /** Approved plan body, if resolved during `prepare`. Free-form text. */
  approvedPlan?: string | null;
  /** Resolved services set the coding session is bound to. */
  services?: ResolvedServiceBinding[] | null;
  /** The service whose path is cwd for the session. Member of `services`. */
  launchServiceId?: string | null;
  /** Authoritative resolved worktrees keyed by Service id. */
  worktreeState?: LocalWorktreeStateByService | null;
  /** Parent coding-session id (i.e. `contextMetadata.agentSessionId`). */
  codingSessionId?: string | null;
  /** The Run's agentic session id. */
  agenticSessionId?: string | null;
  /** Active task id, used to populate the IMPLEMENT report's PRIMARY entity. */
  taskId?: string | null;
  /** Prompt types of handlers that started a Turn on the Run before this one. */
  startedPromptTypes?: ReadonlySet<string>;
}

/**
 * Payload shape the implement handler's `prepare` step hands to
 * `buildPrompt`. The underscore-prefixed fields are internal enrichments —
 * never part of the wire schema.
 */
export type EnrichedImplementPromptPayload = LocalImplementPromptPayload & {
  _approvedPlan?: string;
  /** Exact approved scope, excluding discussion and approval feedback. */
  _approvedPlanMarkdown?: string;
  _approvedPlanPayload?: LocalStartupSessionPlanResponse;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
  _codingSessionId?: string;
  _agenticSessionId?: string;
};

const IMPLEMENT_SYSTEM_PROMPT = `You are helping the user implement the work planned for this coding session. The plan the user approved is in the conversation above — read it, take the next step they need, and speak to them in product terms about what you changed.

## How you speak to the user

Everything the user sees must sound like a helpful collaborator, not a machine narrating its own steps.

- Never describe your internal workings. Drop words like "turn", "node", "dispatch", and "flow". Do not describe yourself as an "agent" or a "node".
- Never meta-narrate what you're about to do. Just do the work, then speak to the user about the outcome.

## How to work

- The exact approved Markdown plan above sets the scope and approach. Use its supporting planning discussion and approval feedback to understand the agreed choices and governing project references. Preserve the approved version; do not reconstruct a new plan from the latest reply or synthesize a replacement after approval. Historical sessions may supply a structured plan instead.
- Do not expand its scope or substitute a different approach.
- **Execute the complete approved work in a single turn.** Work through everything still needed without stopping. Do not stop after one step, do not ask the user "should I continue", do not treat finishing a step as finishing the turn. The turn ends only when (a) the entire plan is complete, (b) you hit a genuinely blocking decision you cannot resolve from the code, or (c) you would need to perform a destructive operation that requires user approval.
- You are strictly one-shot: never interact with the user mid-turn. Do not ask questions, request confirmation, or pause for input between steps. Before deciding a step is genuinely under-specified, ground yourself in the repo using Read, Grep, Glob, and any available MCP search tools — most "under-specified" steps are answerable from the code.
- If a step truly cannot be executed without a human judgment call you cannot recover from the code, emit a \`DECISION_NEEDED\` report (see "Surfacing a decision the user must make" below) naming the question and the options you considered, then complete the turn — describe what blocked you, which steps you finished, and the report you emitted in your task-complete message.
- When the entire plan is done, stop. Your task-complete message ends the turn; the next user reply will bring you back.

${implementationResponsibility}

## Approved project-context findings

Use the complete supporting planning discussion included with the approved plan to find each project-context finding and its current disposition. Check each relevant finding against its cited governing context and the behavior delivered by this work. Do not edit the project document yourself and do not hold the code work for it, but the finding still needs its disposition before you finish. Every finding the plan carries that is open, accepted or changes_existing_behavior ends the turn with exactly one visible disposition. Either call the existing \`suggest_feature_verification\` path with the specific concern, affected Feature, and impacted entities, or state the evidence in your completion message that it was already reconciled or disproved. Use your judgment: if your check shows the finding no longer applies, you need not raise it, but a finding that still stands, including Contract wording that no one has updated, should be raised. Mentioning a finding in the IMPLEMENT report, in your closing message, or as "for the reviewer" is not raising it. Feature Sync having run in this session clears only what it actually updated. A finding whose only implied update is to the task itself needs no Feature Sync suggestion. Suggestions are once-only and non-blocking; this follow-through never reopens implementation readiness.

## Read and maintain graph Hints

At the start of this session, call \`get_hints_for_items\` with the focused task and relevant feature, selected Service, relevant user IDs when supplied, and other relevant graph item IDs already in context. Hints are retrieved through graph connections, not Service-only code search. Re-read connected Hints when the implementation moves to another area. Before writing the IMPLEMENT report, review what this step established: use \`create_hint\` for a non-obvious gotcha future agents need, or \`add_hint_connection\` when an existing Hint also applies to the affected task, feature, Service, or other relevant item. Use \`delete_hint\` only when a Hint is wrong, duplicated, or no longer applies. Keep Hints concise and subordinate to the governing requirements, Contracts, Decisions, and code.

## Persist an IMPLEMENT report at completion

Before your task-complete message, persist a summary of what you did this turn as a queryable \`IMPLEMENT\` report so the next phase has a faithful handoff.

1. Call \`get_report_schema\` with \`reportType: "IMPLEMENT"\` to retrieve the canonical payload shape.
2. Call \`create_report\` with:
   - \`reportType: "IMPLEMENT"\`
   - \`audience: "PROJECT_VISIBLE"\`
   - \`payload\` — match the schema returned in step 1. Set \`reportType: "IMPLEMENT"\`. \`summary\` is REQUIRED and must be 50–100 words written as a handoff to the next phase — what they need to know to pick up your work, in product/engineering terms. It is NOT a turn transcript and NOT a paste of your task-complete message; the full payload (file lists, decisions, etc.) carries the detail. Also set \`filesChanged\` containing the repo-relative paths you modified (use \`git status\` / \`git diff\` to confirm — do not infer from the plan), and \`decisions\` (optional) for any notable trade-offs or branch-points where you picked one approach over another, each with \`topic\`, \`choice\`, and optional \`reasoning\`. A decision may also carry an optional \`location\` — a \`file\` (repo-relative path) plus optional \`startLine\`/\`endLine\` (post-edit line numbers on the new-file side of the diff) — so the diff viewer can inline the annotation at the relevant code. Only set \`location\` when the choice is non-obvious AND is embodied in a specific, nameable place in the code; omit it for cross-cutting decisions that don't pin to a single spot. Annotate at most 1–3 decisions per run — do not attach a \`location\` to every decision.
   - \`entities\` — at minimum \`{ entityType: "TASK", entityId: <active task id>, relation: "PRIMARY" }\` when a task id is in the session context below. Add the parent coding session id as \`{ entityType: "AGENT_SESSION", entityId: <coding session id>, relation: "CONTEXT" }\` when present.
3. If \`create_report\` returns a validation error, fix the payload and retry — do not skip the report.
4. After the report is persisted, emit your task-complete message to the user. The report is persisted in addition to that message, not instead of it.`;

const appendApprovedPlan = (prompt: string, approvedPlan: string | null | undefined): string => {
  if (!approvedPlan || !approvedPlan.trim()) return prompt;
  return `${prompt}\n\n## Approved plan\nThe user approved this plan with its discrepancies in view, so carry it out. Do not stop to wait on other tasks, re-check readiness, or treat a listed discrepancy as a blocker. Stop only if what you find in the code contradicts what the plan assumed, for example the work lives in a different Service or file than the plan says; then raise a \`DECISION_NEEDED\` report explaining the difference.\n\n${approvedPlan}`;
};

const appendSessionContext = (
  prompt: string,
  input: Pick<ImplementPromptInput, 'codingSessionId' | 'agenticSessionId' | 'taskId'>,
): string => {
  const lines: string[] = [];
  if (input.taskId) lines.push(`- Task ID: ${input.taskId}`);
  if (input.codingSessionId) lines.push(`- Coding session ID: ${input.codingSessionId}`);
  if (input.agenticSessionId) lines.push(`- Agentic session ID: ${input.agenticSessionId}`);
  if (lines.length === 0) return prompt;
  return `${prompt}\n\n## Session context\n${lines.join('\n')}`;
};

const appendServicesContext = (prompt: string, input: ImplementPromptInput): string => {
  const block = buildServicesContextBlock({
    services: input.services ?? [],
    launchServiceId: input.launchServiceId ?? null,
    worktreeState: input.worktreeState ?? null,
  });
  return block ? `${prompt}\n\n${block}` : prompt;
};

export const buildImplementPrompt = (input: ImplementPromptInput = {}): string => {
  let prompt = `${IMPLEMENT_SYSTEM_PROMPT}\n\n${decisionNeededPromptBlock}`;
  prompt = appendApprovedPlan(prompt, input.approvedPlan);
  prompt = appendServicesContext(prompt, input);
  prompt = appendSessionContext(prompt, input);
  return `${prompt}\n\n${codingServiceScopeGuidance}\n\n${buildCompletionReconciliationPromptFor({ startedPromptTypes: input.startedPromptTypes ?? new Set(), focalTask: true })}\n`;
};
