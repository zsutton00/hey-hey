import { planningResponsibility } from './knowledge-responsibilities';
import type { LocalStartupSessionPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { LocalPromptDesignDocInput } from '../../shared/agent-bridge-contract/generated/api';
import { ReportAudience } from '../../shared/api/index';
import type { RecentUserReply } from '../prompt-type-handler';
import {
  buildServicesContextBlock,
  focalContextOrientation,
  type ServicesContextInput,
} from './common';

/**
 * Options for `buildCodingPlanPrompt` beyond the active-task payload and recent
 * replies. Extends the services-context input with the optional Project
 * Assistant memo: coding-plan is a subagent, so `resolvePrompt` does not
 * prepend the run's memos for it — when a `project_assistant` memo exists the
 * handler passes its content here and the prompt renders it as additional
 * orientation.
 */
export interface CodingPlanPromptOptions extends ServicesContextInput {
  researchMemo?: string | undefined;
  planDesignDocReference?: LocalPromptDesignDocInput;
}

const buildRecentUserRepliesSection = (
  recentUserReplies: ReadonlyArray<RecentUserReply>,
): string => {
  if (recentUserReplies.length === 0) {
    return `## How every turn ends

No new user reply has arrived since your most recent plan emission. This is the
initial planning path:

- Persist the complete PLAN report using the report instructions below.
- After the report succeeds, write one concise acknowledgement and nothing
  else structured.
- Keep the acknowledgement product-facing; do not mention the report, payload,
  schema, tools, or workflow action.
- Do not call \`submit_approved\` or \`submit_revised\`. The initial report
  remains available for the user's review.`;
  }

  const formattedReplies = recentUserReplies
    .map((reply, index) => `Reply ${index + 1}: ${JSON.stringify(reply.text)}`)
    .join('\n');

  return `## How every turn ends

The CLI has identified ${recentUserReplies.length} new user reply${
    recentUserReplies.length === 1 ? '' : 'ies'
  } since your most recent plan emission, listed below in chronological order:

${formattedReplies}

Classify the **latest** reply (Reply ${recentUserReplies.length}) and follow the
matching report-and-action path:

- \`APPROVED\` — the latest reply clearly accepts the current plan (e.g.
  "looks good", "lgtm", "go ahead", "approved", "ready"). Preserve the
  current plan exactly when it is unchanged; do not create a duplicate PLAN
  report. Write a concise product-facing acknowledgement that does not mention
  the report, payload, schema, tools, or workflow action, then call
  \`submit_approved\` with no arguments. APPROVED moves the workflow forward.
- \`REVISED\` — any change request, question, or ambiguous reply (e.g.
  "can you also...", "I'd rather...", "why did you...", "remove step 3", a
  question about the plan, or an unclear short reply like "ok", "sure", or
  emoji-only). Incorporate any requested changes into the plan before
  persisting it. You may not silently re-emit an unchanged plan: if you
  conclude the reply warrants no change, record the reason in the report — add
  a \`discrepancies\` entry whose \`discrepancyText\` notes that the latest
  reply did not require a plan change and whose \`reasoning\` explains why (for
  an ambiguous reply, name what was unclear and the assumption you made), with
  \`sourceRef\` pointing at the active task. Every revision therefore carries
  either a material edit to the plan or a written explanation for the no-op.
  Create exactly one complete updated PLAN report when the plan changes. Write
  a concise product-facing acknowledgement that does not mention the report,
  payload, schema, tools, or workflow action, then call \`submit_revised\` with
  no arguments. The submission tool emits the generated REFINE action for the
  next planning pass.

Guessing wrong and calling \`submit_approved\` is irreversible once the CLI
posts the completion — when in doubt, choose \`REVISED\` and let the user
clarify. Never put a workflow action in the PLAN payload or acknowledgement.`;
};

const buildPlannedTaskBlock = (
  launchPlanId: string,
  launchStepId: string,
  launchStageId: string,
): string => {
  return `## Planned-task missed-step pass (this turn)

The active task was launched from an approved plan stage. Before creating the PLAN report, perform a missed-step pass against the surrounding plan. This pass is **surface-only**: it reports coverage gaps in the report payload. It does not author proposals or edit the plan — gap detection and its plan-shaping proposals live in the analyze step, not here.

1. **Read the surrounding plan hierarchy.** Call \`get_context\` for the active TASK with entity id \`${launchStepId}\` to orient on its TASK ancestry and upstream context. Call \`get_full_entity\` for the PLAN TASK id \`${launchPlanId}\` to read the surrounding plan's other PLAN_STAGE children. The stage id \`${launchStageId}\` identifies the TASK of type PLAN_STAGE that owns the active task; use it for any targeted context read.
2. **Compute the missed-step diff.** The missed-step diff is the set of preconditions or referenced artifacts in this session's \`executionPlan\` that no upstream plan step is responsible for producing. Two typed signals carry intent here, when present on the plan steps:
   - **Named preconditions** on a step — what the step depends on entering it.
   - **Step → service binding** — which service the step delivers against.
   Treat both as best-effort signals: prefer them when present, and fall back to inspecting step descriptions, attached reports, and any service hints when they are absent. The goal is to find gaps the upstream plan does not cover, not to argue with steps that already cover the gap by other wording.
3. **Include a \`missedSteps\` array in the PLAN report payload.** Mirror each gap as one entry on the report payload's \`missedSteps\` array. Describe the gap only — do not author proposals, insert steps, or amend stages; \`suggestedResolution\` names the *kind* of edit that would close the gap so a downstream reviewer can act, but you do not create it. Use this shape:

\`\`\`
{
  "title": "short product-language title",
  "description": "one or two sentences: what is missing and why the execution plan needs it",
  // Set exactly one of the two below — whichever frames the gap more clearly.
  "missingPrecondition": "the named precondition no upstream step produces",
  "referencedArtifact": "the artifact (file, type, contract) no upstream step delivers",
  "suggestedResolution": {
    "type": "insert_step" | "amend_stage",
    "description": "one-sentence product-language description of the edit that would close the gap",
    "targetStageId": "stage id the edit would target"
  },
  "references": [
    { "sourceType": "evidenceItem|task|designDoc|plan|initiative", "sourceId": "...", "rationale": "why this source motivated the entry" }
  ]
}
\`\`\`

4. **Omit \`missedSteps\` entirely when no gap is detected.** Do not emit \`"missedSteps": []\`. The silent-pass output must be byte-identical to today.

`;
};

const formatPlanDesignDocSections = (designDoc: LocalPromptDesignDocInput): string => {
  const sections = designDoc.sections ?? {};
  return Object.keys(sections)
    .sort()
    .map((key) => {
      const content = sections[key]?.trim();
      if (!content) return null;
      return `### ${key}\n\n${content}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join('\n\n');
};

const buildPlanDesignDocReferenceBlock = (
  designDoc: LocalPromptDesignDocInput | undefined,
): string => {
  if (!designDoc) return '';

  const content = formatPlanDesignDocSections(designDoc);
  if (!content) return '';

  const title = designDoc.title?.trim();
  return `## Plan design document (reference only)

This design document is attached to the surrounding plan. Use it only to guide implementation choices, naming, terminology, and product intent. It does not expand this session's implementation scope: the selected task or plan step remains the strict scope.

${title ? `Title: ${title}\n\n` : ''}Content:

${content}

`;
};

export const buildCodingPlanPrompt = (
  payload: LocalStartupSessionPromptPayload,
  recentUserReplies: ReadonlyArray<RecentUserReply> = [],
  servicesContext: CodingPlanPromptOptions = {},
): string => {
  const rawLaunchPlanId = payload.launchPlanId;
  const rawLaunchStepId = payload.launchStepId;
  const rawLaunchStageId = payload.launchStageId;
  const launchPlanId = typeof rawLaunchPlanId === 'string' ? rawLaunchPlanId.trim() : '';
  const launchStepId = typeof rawLaunchStepId === 'string' ? rawLaunchStepId.trim() : '';
  const launchStageId = typeof rawLaunchStageId === 'string' ? rawLaunchStageId.trim() : '';
  if (
    (rawLaunchPlanId !== undefined && launchPlanId.length === 0) ||
    (rawLaunchStepId !== undefined && launchStepId.length === 0) ||
    (rawLaunchStageId !== undefined && launchStageId.length === 0)
  ) {
    throw new Error(
      'buildCodingPlanPrompt requires non-empty launchPlanId, launchStepId, and launchStageId when present on the payload.',
    );
  }
  const hasLaunchPlan =
    launchPlanId.length > 0 && launchStepId.length > 0 && launchStageId.length > 0;
  const planDesignDocReference = servicesContext.planDesignDocReference;

  const servicesBlock = buildServicesContextBlock(servicesContext);
  const servicesSection = servicesBlock ? `${servicesBlock}\n\n` : '';
  const planDesignDocReferenceBlock = buildPlanDesignDocReferenceBlock(planDesignDocReference);
  const planDesignDocReferenceSection = planDesignDocReferenceBlock
    ? `\n\n${planDesignDocReferenceBlock}`
    : '';

  // Project Assistant memo (subagent flows don't get the resolver's memo-block
  // prepend). When present, render it and defer the from-scratch graph sweep to
  // it; when absent, both fragments collapse so the prompt is byte-identical to
  // the pre-feature output.
  const researchMemo = servicesContext.researchMemo?.trim();
  const researchSection = researchMemo
    ? `## Context from prior phases\n\nA Project Assistant pass ran earlier in this run and surfaced the relevant features, tasks, and contradictions around the active task. Read it before planning — it is durable project orientation, not a transcript.\n\n${researchMemo}\n\n`
    : '';
  const orientationSweep = researchMemo
    ? 'Use the Project Assistant findings above to know which work items and design docs govern this plan, then read the current content of each before planning against it; do not rediscover the graph from scratch.'
    : 'Discover the work items and design docs that govern this task from the codebase, design documents, and related entities, and read their content; the absence of research does not reduce this.';

  const body = `You are starting a coding agent session from structured task context and evidence.

Scope model:
- The canonical focal entity projection supplied before this prompt is the single active task for this session.
- Only plan and execute work required to complete the active task.
- The plan design document reference, when present, is contextual guidance only and does not expand the active task's scope.
- Implementing functionality whose primary outcome belongs to any non-active task is a hard failure and will be rejected.

${servicesSection}${researchSection}${focalContextOrientation}

${orientationSweep}

## Read the feature-sync handoff if one is present (mandatory)

If the prior-reports block above contains a \`FEATURE_SYNC_HANDOFF\` report, call \`get_report_body\` with that \`reportId\` before producing the plan. The handoff carries hidden requirements, constraints, and dependencies the analyze phase noticed but did not surface to the user — they are scope constraints on this plan, not optional context. If no handoff is present, skip this step.

## Proposal influences and edges (mandatory pre-plan pass)

The focal context carries two signals that capture author intent and scope, and are not derivable from the task description. Treat these as first-class constraints on the execution plan — not as decoration. Inspect them in the canonical startup projection first; call \`get_context\` on the active task only when those proposal or topology details are absent or insufficient.

1. **Proposal influences** — each proposal on the task carries an \`influences[]\` array. Each entry has \`entityId\`, \`entityType\`, \`reasonType\` (\`explicit_mention\` | \`implied\` | \`derived\`), and free-text \`reasoning\` (e.g. "this task is the consumer of X", "this task supersedes Y").
2. **Proposal edges** — each proposal declares an \`edges[]\` array of typed relationships to neighboring entities: \`DEPENDS_ON\`, \`DERIVES_FROM\`, \`SUPERSEDES\`, \`CONTRADICTS\`, \`RELATED_TO\`. These live on the proposal itself. They are distinct from the \`relatedEntities[]\` field on \`get_context\`, which carries the seed's structural neighbors (e.g. agent-session attachments and other lifecycle relationships) — those are out of scope for this pass.

**Scope of the pass.** Enumerate every entry in \`influences[]\` and every non-hierarchy, non-system entry in \`edges[]\` (e.g. exclude \`HAS_AGENT_SESSION\`) from the **most recent APPROVED proposal** on the active task, plus any **DRAFT** proposal on the active task. Do not walk older superseded proposals.

**Two-tier read strategy (keep context bounded).**
- **Tier 1 — inline from focal context:** read the influence \`reasoning\`, the edge \`description\`, and the target's title to decide which targets govern the plan.
- **Tier 2 — \`get_full_entity\` on the target:** call this for every target that governs the plan: a design doc, or a work item such as a Contract, Mockup, Diagram, or feature whose content constrains the result. Skip targets whose link is only navigational. A task with a handful of non-hierarchy connections should not trigger tens of thousands of tokens of pre-plan reads.

**Per-entry reasoning.** For every surfaced influence and every surfaced edge, reason internally about what that entry asserts about intent or scope and whether it changes the execution plan or raises a clarification question. Do not emit that inventory or reasoning as companion prose. Project only the resulting concrete implementation consequence into the structured plan.

**Output projection boundary.** Proposal influences, proposal lineage, proposal edges, Project Assistant research, and graph state are planning inputs, not implementation actions. Do not turn user influence, research provenance, graph-management activity, or a finding that no applicable connection exists into a primary implementation, execution-plan title, execution-plan description, or discrepancy. Execution-plan entries contain only concrete implementation, configuration, generation, or test work. If this evidence exposes an unresolved acceptance-criteria divergence that blocks safe planning, emit the required clarification question instead.

**Divergence rule.** When an influence or edge points at a task whose acceptance criteria describe behavior the active task's text does not cover, raise a \`clarificationQuestion\` in the output JSON. Do **not** dismiss the divergence as "different flow" or "out of scope" — the whole point of these signals is that they encode intent that the active task's description alone may not.

**Future-revision approval rule.** Read \`futureProposalDependencies\` from \`get_context\`. If its \`status\` is \`unavailable\`, emit a \`clarificationQuestion\` saying the approval state could not be read and asking how to proceed; do not plan dependent changes. If its \`status\` is \`loaded\`, inspect every \`proposals\` row. For an \`unresolved\` row, ask for clarification, leave its dependent change out of the plan, and mention the proposal as \`@[proposal:<proposalId>|<proposalId>]\`. For a \`future\` row not \`APPROVED\`, ask whether to proceed, mention it as \`@[proposal:<proposalId>|<proposalTitle or proposalId>]\` (use \`proposalId\` when \`proposalTitle\` is null), and include \`approvalsRecorded\` against numeric \`requiredApprovals\`; leave only the affected change out of the execution plan. Judge approval only by the proposal's \`status\`, never by task status, proposal edges, or a dismissed feature-sync finding. If the user's answer explicitly says to proceed, plan that change and record in its step that it builds on an unapproved direction — the override is not an approval. For each approved \`future\` row, call \`get_future_revision\` with its \`futureId\` and treat that projection as the target direction, whether or not it is applied.

**Worked example.** Active task \`3630075f\` shipped ambiguous text about whether a new \`projects\` field on \`InviteToOrganizationDto\` must create a brand-new user. Its approved proposal listed task \`7caa9b4f\` as an \`implied\` influence with reasoning "Parent invite-by-email flow is the consumer of the new projects field on InviteToOrganizationDto." The compliant pass is: (1) enumerate the influence, (2) read inline that the target's title centers on invite-by-email user creation, (3) promote to Tier 2 and call \`get_full_entity\` on \`7caa9b4f\` because its title hints at a user-creation contract the active task does not resolve, (4) observe that its acceptance criteria require creating a brand-new \`User\`, and (5) emit a clarification question asking whether the active task must take the new-user branch of \`inviteToOrganization\` rather than silently picking the existing-user branch. A prompt that required this reasoning would have caught the gap at startup instead of during final assessment.

${planningResponsibility}

Your primary goals:
1. Build a concrete multi-step execution plan.
2. Surface discrepancies between provided inputs and this session's in-repo delivery reality.
3. Ask clarification questions only when they block safe execution.
4. Keep the execution plan scoped to the current task and treat adjacentScopeTasks as out-of-scope boundaries.

Service scope:
- The supplied "Services in scope" block describes the Run's current selection and available workspace context; it is not a ceiling on what the plan may require.
- Use the active task's full implementation boundary to identify every project Service the proposed implementation may modify. If the task requires a Service that is not in the supplied block, call \`list_services\` to resolve its full project Service ID and request it by including that ID in \`requiredServiceIds\`.
- Do not omit, defer, or split out required work merely because its Service is not currently selected, and do not report the missing current selection as a discrepancy. The user approves the complete cross-Service plan as one unit; approval then expands the Run's executable Service scope before implementation begins.
- The emitted plan must declare the complete, non-empty, deduplicated Service ID set in \`requiredServiceIds\`.
- \`requiredServiceIds\` is an approval-time scope declaration only; it does not authorize changes before the user approves the plan.

${planDesignDocReferenceSection}

## PLAN report payload

When you create the PLAN report, its \`payload\` must be a strict JSON object
with this exact structure and lowerCamel keys. This object belongs in the
\`create_report\` tool argument, never in the assistant response:

{
  "reportType": "PLAN",
  "summary": "50–100 word handoff describing the proposed product and engineering result",
  "sessionTitle": "short, task-focused session title",
  "requiredServiceIds": ["full project Service ID"],
  "primaryImplementations": [
    {
      "title": "concrete centerpiece title",
      "content": "complete proposed code, database definition, or prose block",
      "language": "TypeScript | SQL | Markdown (omit when not useful)",
      "location": "repo-relative file, database object, or document section (omit when unresolved)",
      "rationale": "why this is a primary implementation rather than supporting work",
      "connections": [
        {
          "entityType": "workflowStep|contract",
          "entityId": "full UUID of the resolved non-archived entity",
          "entityTitle": "exact resolved entity title",
          "relationship": "fulfills|authors|enforces|consumes",
          "sourceField": "retrieved field path or graphEdge.FULFILLED_BY",
          "sourceExcerpt": "complete source excerpt that establishes the connection",
          "rationale": "why the evidence supports this exact relationship"
        }
      ]
    }
  ],
  "executionPlan": [
    {
      "stepId": "step-1",
      "title": "short title",
      "description": "what to do",
      "targetFiles": ["src/path/to/file.ts"],
      "phase": 1,
      "references": [
        {
          "sourceType": "evidenceItem|task|designDoc|plan|initiative",
          "sourceId": "entity or evidence id",
          "rationale": "why this source supports this step"
        }
      ]
    }
  ],
  "discrepancies": [
    {
      "sourceRef": {
        "sourceType": "evidenceItem|task|designDoc|plan|initiative",
        "sourceId": "entity or evidence id"
      },
      "sourceField": "title|content|topologySummary|taskType|description|acceptanceCriteria|sections.<sectionKey>|outcome|adjacentScopeTasks.<index>.taskType|adjacentScopeTasks.<index>.description|adjacentScopeTasks.<index>.acceptanceCriteria",
      "sourceExcerpt": "one or two full sentences from input",
      "discrepancyText": "one sentence: what you observed (the factual mismatch, not interpretation)",
      "reasoning": "one sentence: what you will do about it, stated as a proposed resolution (e.g. 'I will assume X is defined externally and reference it without implementing it')",
      "severity": "low|medium|high"
      // Severity bands (apply at write-time; the JSON value stays one of low|medium|high):
      // - low: the plan has an expected, design-consistent dependency worth recording, such as functionality already in flight or planned; routine implementation work performed by this session is not a discrepancy.
      // - medium: the plan has a material, non-contradictory scope or ownership concern that requires a decision or an additional owner; it is a scope call, not a design conflict.
      // - high: an authoritative design or Contract is specifically incompatible with the plan premise, making the plan invalid until that premise is revisited; this is an authoritative conflict, not a gap.
    }
  ],
  "clarificationQuestions": [
    {
      "question": "blocking question text that is not already captured in discrepancies",
      "reason": "why this blocks safe execution and is not already covered by a discrepancy",
      "relatedSourceRefs": [
        {
          "sourceType": "evidenceItem|task|designDoc|plan|initiative",
          "sourceId": "entity or evidence id"
        }
      ]
    }
  ]
}

Rules:
- sessionTitle must be specific to the active task and concise (prefer 3-8 words).
- sessionTitle must not be generic (for example avoid "Startup Plan" or "Task Work").
- requiredServiceIds must contain every project Service the proposed implementation may modify, including Services discovered through \`list_services\` that were not in the Run's initial selection; it must contain at least one ID and no duplicates. Preserve the same ordered set when re-emitting an unchanged plan for approval.
- Every discrepancy must include a precise sourceRef and sourceField.
- discrepancyText states the factual observation only (what you saw); reasoning states your proposed resolution only (what you will do). Do not repeat the observation in reasoning or vice versa.
- Keep both discrepancyText and reasoning to one sentence each. The user reads these to confirm your approach — verbose explanations slow review.
- In the PLAN report payload, discrepancy means a concrete mismatch between provided inputs and what is required to deliver the active task in this codebase/session.
- If missing detail is discoverable by normal in-repo work (code/types/routes/tests/patterns), it is not a discrepancy and not a clarificationQuestion; investigate and proceed.
- Classify the observed relationship, not the effort, file count, or presence of generated artifacts.
- Do not treat any mismatch whose resolution is a normal codebase operation as a discrepancy. This covers expected implementation gaps (the active task asks to add/build/refactor capability the current codebase does not yet have), concrete implementation or configuration work, updating an OpenAPI description and regenerating generated DTOs or bindings, rerunning codegen, applying an already-written migration, picking up stale generated types, and test work. Capture that work in executionPlan, not discrepancies.
- Use low only for an expected, design-consistent dependency worth recording; use medium for a material non-contradictory scope or ownership concern that requires a decision or an additional owner; use high only when an authoritative design or Contract is specifically incompatible with the plan premise and makes the plan invalid until that premise is revisited.
- Use clarificationQuestions only for unresolved blockers that remain after reasonable in-repo investigation, and do not duplicate issues already captured in discrepancies.
- Do not emit fragmentary excerpts; sourceExcerpt must be one or two full sentences.
- The executionPlan must contain at least one step. A plan with an empty executionPlan is invalid and will be rejected — never emit a zero-step plan.
- primaryImplementations must contain at least one item. Emit the smallest set of concrete centerpieces that makes the proposed result reviewable; do not repeat execution steps or list supporting edits, tests, generated files, or routine wiring as primary implementations.
- Each primary implementation content field must contain the complete proposed centerpiece, not a summary or placeholder. Use code for a code-level contract or algorithm, a complete table/index/constraint definition for database work, and the exact proposed paragraph, requirement, prompt, or other prose block for prose-centered work.
- Order primaryImplementations deterministically by the order in which a reviewer needs to understand the product behavior; when two items are peers, order by location and then title. Keep the same order when revising an otherwise unchanged plan.
- connections are optional evidence records, not graph mutations. Omit the connections property entirely when no candidate clears the evidence gate; never emit an empty connections array and never add a connection merely because the entity is topically related or nearby in the hierarchy.
- A Diagram Element connection uses the current PLAN wire discriminator \`workflowStep\`; this API value is not a product entity name. Present it to users as a Diagram Element (canonical type DIAGRAM_ELEMENT). It must use relationship \`fulfills\`, name a resolved non-archived Diagram Element by full id and exact title, and cite either exact retrieved element content that the implementation fulfills or an existing \`FULFILLED_BY\` graph edge. Flow links, Contract dependencies, shared hierarchy, and plausible future fulfillment are not evidence.
- A contract connection must name a resolved non-archived Contract by full id and exact title, use only \`authors\`, \`enforces\`, or \`consumes\`, and cite the Contract's concrete semantic body plus responsible anchor. Topical awareness, ordinary execution dependencies, missing anchors, and inferred downstream use do not qualify.
- Every emitted connection must include the complete identity, relationship, sourceField, complete sourceExcerpt, and rationale. If retrieval does not establish every field, abstain and omit the connection.
- Every executionPlan step should include at least one reference when possible.
- When a step modifies code, list the repo-relative file paths in targetFiles (for example "src/agents/implement/prompts.ts"). Omit targetFiles for purely investigative or read-only steps. Description carries the what and why; targetFiles carries the where — do not embed file paths in description when they belong in targetFiles.
- Emit phase (a 1-based integer) on every step. Start a new phase when work shifts to a different file/subsystem cluster, or when an earlier phase is settled and downstream steps only need its summary rather than its in-progress detail; otherwise keep the prior phase number.
- Do not emit difficulty. Phase remains required on every executionPlan step.
- Treat the active task as the only implementation target for this session.
- Treat design docs and governing work items as contextual guidance and scope evidence, not separate implementation targets; the constraints they establish still bind how the active task is implemented.
- Treat task descriptions as outcome-level guidance, not exact implementation instructions.
- Use the codebase (types, tests, existing patterns, runtime behavior) as the source of truth for concrete implementation decisions.
- Related tasks and child tasks are directional context only; do not implement them in this session.
- If task text and code reality conflict, follow code reality and record a discrepancy only when the conflict blocks the active task's acceptance criteria.
- A reviewed design doc or work item that conflicts with code reality is a discrepancy, not a reason to follow the code.
- Treat ancestralDesignDocs as dependency context and boundary constraints only.
- Treat adjacentScopeTasks as boundary constraints, not additional work for this session.
- Treat additional tasks included in evidence as strict out-of-scope boundaries for implementation in this session.
- Every executionPlan step must primarily advance the active task; no preemptive or follow-up implementation on non-active tasks.
- Cross-repository/service scope splits are normal; plan only the subset deliverable in this codebase/session.
- Record a cross-repository discrepancy only when external state directly conflicts with or blocks the active task's acceptance criteria in this session.
- Cross-repository discrepancies are not a separate category for severity purposes; assign whichever band (low/medium/high) their content matches under the rules above.
- Prefer the smallest viable plan that satisfies current-task acceptance criteria without preemptive neighboring-task work.
- If there are no discrepancies, return an empty discrepancies array.
- If there are no blocking questions, return an empty clarificationQuestions array.

## Persist a PLAN report before acknowledging

Persist the complete plan as a queryable \`PLAN\` report so it is reachable
from the Reports query API. The typed PLAN report is the sole structured plan presentation; the visible completion is only a short acknowledgement.

1. Call \`get_report_schema\` with \`reportType: "PLAN"\` to retrieve the canonical payload shape.
2. Call \`create_report\` with:
   - \`reportType: "PLAN"\`
   - \`audience: "${ReportAudience.ProjectVisible}"\`
   - \`payload\` — follow the PLAN report schema and carry over \`sessionTitle\`, \`requiredServiceIds\`, \`primaryImplementations\` (including only supplied evidence-gated \`connections\`), \`executionPlan\` (preserving \`stepId\`, \`title\`, \`description\`, \`phase\` and \`targetFiles\` when present, and \`references\`), \`discrepancies\`, and \`clarificationQuestions\`. Add the required \`summary\` as a 50–100 word handoff, and set the payload's \`reportType\` field to \`"PLAN"\`. The payload carries plan content only; it never carries a workflow action.
   - \`entities\` — at minimum \`{ entityType: "TASK", entityId: <active task id>, relation: "PRIMARY" }\`. Add any other in-scope references (e.g. relevant designDoc or initiative ids from supplemental inputs) as \`relation: "CONTEXT"\`. The active AgentSession is captured automatically from the request header and does not need to be passed.
3. For an initial plan, complete report persistence before writing the acknowledgement and do not call either submission tool. For an approval, do not create a duplicate unchanged report; write the acknowledgement and then call \`submit_approved\`. For a revision, persist exactly one complete updated report when the plan changes, write the acknowledgement, and then call \`submit_revised\`. The report and acknowledgement never contain a workflow action.
4. If \`create_report\` returns a validation error, fix the payload to match the schema and retry — do not fall back to skipping the report.

The assistant response after the required report work is a single concise,
product-facing acknowledgement. Do not mention the report, payload, schema,
tools, or workflow action. Do not print the PLAN payload, markdown tables for
the plan, or any other structured completion body.

${hasLaunchPlan ? buildPlannedTaskBlock(launchPlanId, launchStepId, launchStageId) : ''}${buildRecentUserRepliesSection(recentUserReplies)}`;

  return `${body.replace(/\s+$/u, '')}\n`;
};
