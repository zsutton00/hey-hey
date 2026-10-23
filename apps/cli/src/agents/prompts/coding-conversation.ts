import { buildActivityResponsibilities } from './knowledge-responsibilities';
import { buildCompletionReconciliationPromptFor } from '../completion-reconciliation/prompts/common';
import type {
  LocalCodingFreeformPromptPayload,
  LocalFreeFormPromptPayload,
  Prepared,
} from '../../shared/agent-bridge-contract/index';
import type {
  ImplementationReadinessFinding,
  ImplementationReadinessSourceSnapshot,
} from '../../shared/api/generated/api';
import {
  buildServicesContextBlock,
  codingServiceScopeGuidance,
  focalContextOrientation,
  planVsTasksFork,
} from './common';
import { implementationReadinessDecisionGuidance } from './implementation-readiness';

/**
 * Payload shape used by `buildCodingConversationPrompt`. The wire payload
 * carries only `userMessage` (plus `free_form`'s deprecated `startupInput`);
 * the handler's `prepare` step stitches the Run's services, launch service and
 * worktree state onto it, and for a follow-up the Run's prior `promptType` and
 * (when the trigger has an assistant parent) the literal text of that parent
 * assistant message so the orientation can quote the exchange the user is
 * responding to.
 */
export type CodingConversationPreparedPayload = Prepared<
  LocalFreeFormPromptPayload | LocalCodingFreeformPromptPayload
>;

/**
 * Selects the orientation of the one coding-conversation prompt. Every other
 * section — behavior, references, Services, plan-vs-tasks, Service scope and
 * the completion-reconciliation instruction — is shared by both modes.
 */
export type CodingConversationMode =
  | {
      kind: 'launch';
      implementationReadinessSourceSnapshot?: ImplementationReadinessSourceSnapshot | null;
      /** The pending REVIEW_REQUIRED finding this launch's user message clarifies. */
      readinessClarification?: { finding: ImplementationReadinessFinding | null };
    }
  | {
      kind: 'follow_up';
      /**
       * True when the workflow on this conversation is alive but waiting on a
       * user review. The agent answers conversationally and points the user
       * back to the pending review.
       */
      awaitingUserReview: boolean;
      /** Canonical TASK id projected from the persisted Run entity. */
      taskId: string | null;
    };

const PROMPT_TYPE_LABELS: Readonly<Record<string, string>> = {
  startup_session: 'startup session',
  plan_execution: 'plan execution',
  final_assessment: 'final assessment',
  verification_plan: 'verification plan',
  child_task_updates: 'child task updates',
  entity_conversation: 'entity conversation',
  set_splitting: 'set splitting',
  free_form: 'free-form coding',
  debug: 'debug session',
  research: 'research session',
  daily_session: 'daily session',
  rollup_proposal: 'rollup proposal',
  task_refiner: 'task refiner',
  feature_refiner: 'feature refiner',
  design_doc_refiner: 'design-doc refiner',
  proposal_refiner: 'proposal refiner',
  commit: 'commit',
  agent_search: 'agent search',
  report_update: 'report update',
  code_review: 'code review',
  feature_sync_analyze: 'feature-sync analyze',
  feature_sync_iterate: 'feature-sync iterate',
  plan_shaping_proposed_stages: 'plan-shaping proposed stages',
  plan_shaping_finalize: 'plan-shaping finalize',
  implement: 'implement',
  coding_freeform: 'coding-session follow-up',
};

const labelForPromptType = (promptType: string | undefined): string | null => {
  if (!promptType) return null;
  return PROMPT_TYPE_LABELS[promptType] ?? promptType;
};

const formatQuoted = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

const buildPriorContextLine = (payload: CodingConversationPreparedPayload): string => {
  const priorLabel = labelForPromptType(payload.priorPromptType);
  const priorAssistant = payload.priorAssistantMessage?.trim();

  if (priorLabel && priorAssistant) {
    return `The previous turn in this session ran as **${priorLabel}** and ended with this assistant message:

${formatQuoted(priorAssistant)}

The user has now replied to that message. Orient on their reply and respond to what they're asking now.`;
  }

  if (priorLabel) {
    return `The previous turn in this session ran as **${priorLabel}**; its output is already on the conversation record. Treat that as background — orient on the user's most recent message and respond to what they're asking now.`;
  }

  if (priorAssistant) {
    return `The previous assistant message in this session was:

${formatQuoted(priorAssistant)}

The user has now replied to that message. Orient on their reply and respond to what they're asking now.`;
  }

  return "Orient on the user's most recent message and respond to what they're asking now.";
};

const LAUNCH_FRAMING =
  'You are starting a free-form coding session. Your role is to have a conversation with the user about the task before taking action.';

const buildFollowUpFraming = (payload: CodingConversationPreparedPayload): string => {
  const hasServices = (payload.services?.length ?? 0) > 0;
  const sessionDescriptor = hasServices
    ? "You are continuing a coding session scoped to this project's active services. The user's specific request is the highest priority — respond to it directly, not to the agent's own agenda or scaffolding from prior turns."
    : "You are continuing a coding session for this project. The user's specific request is the highest priority — respond to it directly, not to the agent's own agenda or scaffolding from prior turns.";

  return `${sessionDescriptor}

## Orientation

${buildPriorContextLine(payload)}

You have full access to this session's tooling: code search and reads, entity context retrieval (\`get_context\`, \`unified_search\`), proposal and edge creation, and any other tools available in this run. Use them as the user's question requires — read code before answering questions about it, fetch entity context before reasoning about project structure, and propose mutations through the normal proposal flow when the user asks for changes.`;
};

const CONVERSATION_GUIDELINES = `## Behavioral Guidelines

- **The user's specific request is the highest priority.** Orientation steps, opinionated defaults, and proactive suggestions serve the request — they are never a reason to drift from it or substitute the agent's own agenda.
- **Act on what's clear.** Read the task and relevant code, then work. Don't open with questions — start, and ask only if something genuinely blocks forward progress.
- **Be opinionated.** Make a call and state it. Do not ask the user to adjudicate low-stakes decisions (naming nits, punctuation, formatting, which of two equivalent approaches to take, whether to add a minor safeguard) — decide, explain briefly, and move on. Save questions for decisions that genuinely change the outcome: scope, behavior the user can observe, tradeoffs with real consequences.
- **If you must ask, ask once.** Ask the single highest-value question. Do not produce a checklist of clarifications.
- **If the user asks you to brainstorm or plan**, do so instead of implementing. Otherwise implement directly.
- **Stay collaborative**: offer observations, flag risks, and suggest approaches as you work — but don't pause for permission.

## Follow References

Before responding, resolve every reference the user provides:
- **File paths and code locations** (e.g. \`src/foo/bar.ts\`, \`path/to/file.ts:42\`) — read the file.
- **@-mentions** in the task context or user messages (\`@[task:...|...]\`, \`@[design_doc:...|...]\`, etc.) — fetch them via \`get_context\` or the appropriate tool so you understand what the user is pointing at.
- **URLs, issue numbers, or external references** — fetch or look them up when you have a tool that can.

Do not guess at the contents of a referenced file or entity. Read it first, then respond.`;

const AWAITING_USER_REVIEW_BLOCK = `## Workflow is waiting on the user

A workflow on this conversation is parked on a review the user must complete before it can advance. You have no tool that can post a workflow completion on this turn, and you must not pretend the workflow has moved on.

Answer the user's question conversationally and direct them back to the pending review when their question relates to workflow progress.`;

const buildTaskScopeBlock = (taskId: string): string => `## Task scope

The active entity for this session is the TASK \`${taskId}\`. This is fixed — do not search for the task or guess its identity. Pass this id directly to \`get_context\` and other tools that take a task id.`;

const buildReadinessClarification = (
  finding: ImplementationReadinessFinding | null,
): string => `## Readiness clarification

Your earlier readiness check on this Run is waiting on the user, and their message is their answer.${
  finding
    ? ` The open decision was: ${finding.unresolvedDecision} (answer needed: ${finding.answerKind}).`
    : ''
}

Reassess with their answer before using code-capable tools. If no consequential decision remains unresolved, call \`submit_implementation_readiness\` with a \`CLEAR\` disposition (the canonical source binding below, \`finding: null\`, \`resolution: { "kind": "NONE" }\`), then continue with the request. Otherwise follow the preflight below with a new \`REVIEW_REQUIRED\` finding.`;

const buildReadinessPreflight = (
  sourceSnapshot: ImplementationReadinessSourceSnapshot | null | undefined,
): string => `## Implementation-readiness preflight

Before using code-capable tools for this request, inspect the carried Project Assistant memo, especially its \`## Implementation-readiness evidence\` section. That memo is bounded evidence; it does not replace the readiness decision.

${implementationReadinessDecisionGuidance}

- If the evidence identifies a consequential unresolved decision under that test, call \`submit_implementation_readiness\` with the disposition below. Correct any tool error and retry in this same session. After the tool accepts it, stop before coding and emit the same structured response below.
- If the evidence is empty, describes only routine implementation discovery, or preserves a conditional hazard whose triggering path is not established, continue with the user's request without asking about those details.
- When emitting the structured response, do not use code-capable tools in the same turn. The response is rendered as a read-only review field so the user can clarify the source context.

The structured response must be a single fenced JSON object with \`responseType: "implementation_readiness_v1"\`, a \`REVIEW_REQUIRED\` disposition, the affected source context, unresolved decision, consequential invention risk, bounded evidence, and the kind of answer needed. Use \`resolution: { "kind": "NONE" }\`. Copy the canonical source binding below exactly; set \`capturedAt\` to the current ISO-8601 time.

${
  sourceSnapshot
    ? `Canonical source binding:
- runId: \`${sourceSnapshot.runId}\`
- focalEntityId: \`${sourceSnapshot.focalEntityId}\`
- focalEntityType: \`${sourceSnapshot.focalEntityType}\`
- sourceRevision: \`${sourceSnapshot.sourceRevision}\``
    : 'If no canonical source binding is available, do not emit a readiness response; continue with the request.'
}

Example response shape:
\`\`\`json
{
  "responseType": "implementation_readiness_v1",
  "disposition": {
    "state": "REVIEW_REQUIRED",
    "sourceSnapshot": {
      "runId": "<canonical runId>",
      "focalEntityId": "<canonical focalEntityId>",
      "focalEntityType": "<canonical focalEntityType>",
      "sourceRevision": "<canonical sourceRevision>",
      "capturedAt": "<current ISO-8601 time>"
    },
    "finding": {
      "affectedSourceContext": "<task, feature, design doc, or plan context>",
      "unresolvedDecision": "<one consequential decision>",
      "consequentialInventionRisk": "<what implementation would otherwise invent>",
      "boundedEvidence": [{
        "category": "behavior",
        "statement": "<bounded evidence statement>",
        "sourceRef": "<memo or source reference>"
      }],
      "answerKind": "<the kind of clarification needed>"
    },
    "resolution": { "kind": "NONE" }
  }
}
\`\`\`

A readiness response replaces the completion JSON below for that turn.`;

/**
 * The one prompt for Open launches (`free_form`) and coding-session
 * follow-ups (`coding_freeform`). `mode` selects only the orientation;
 * the completion-reconciliation instruction always closes the prompt.
 */
export const buildCodingConversationPrompt = (
  payload: CodingConversationPreparedPayload,
  mode: CodingConversationMode,
  startedPromptTypes: ReadonlySet<string> = new Set(),
): string => {
  const sections: string[] = [];

  sections.push(mode.kind === 'launch' ? LAUNCH_FRAMING : buildFollowUpFraming(payload));
  sections.push(CONVERSATION_GUIDELINES);
  sections.push(buildActivityResponsibilities());

  const servicesBlock = buildServicesContextBlock({
    services: payload.services,
    launchServiceId: payload.launchServiceId ?? null,
    worktreeState: payload.worktreeState,
  });
  if (servicesBlock) sections.push(servicesBlock);

  if (mode.kind === 'launch') {
    sections.push(focalContextOrientation);
  } else {
    if (mode.taskId) sections.push(buildTaskScopeBlock(mode.taskId));
    if (mode.awaitingUserReview) sections.push(AWAITING_USER_REVIEW_BLOCK);
  }

  sections.push(planVsTasksFork);
  sections.push(codingServiceScopeGuidance);

  if (mode.kind === 'launch') {
    if (mode.readinessClarification) {
      sections.push(buildReadinessClarification(mode.readinessClarification.finding));
    }
    sections.push(buildReadinessPreflight(mode.implementationReadinessSourceSnapshot));
  }

  sections.push(buildCompletionReconciliationPromptFor(startedPromptTypes));
  return sections.join('\n\n');
};
