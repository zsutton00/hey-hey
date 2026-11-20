import type { AgentProviderId } from '../providers/provider-config';
import { planningResponsibility } from './knowledge-responsibilities';
import type { LocalStartupSessionPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { LocalPromptDesignDocInput } from '@hey-hey/contracts/agent-bridge';
import type { RecentUserReply } from '../prompt-type-handler';
import {
  buildServicesContextBlock,
  focalContextOrientation,
  type ServicesContextInput,
} from './common';

/**
 * Options for `buildCodingPlanPrompt` beyond the active-task payload and recent
 * replies. Extends the services-context input with whether a Project Assistant
 * memo exists: `resolvePrompt` prepends the memo itself when it mints a
 * provider session, so the prompt only needs the flag to orient the planner.
 */
export interface CodingPlanPromptOptions extends ServicesContextInput {
  hasResearch?: boolean | undefined;
  planningConversation?: string | undefined;
  planDesignDocReference?: LocalPromptDesignDocInput;
  provider?: AgentProviderId | undefined;
}

const planToolLoadingInstruction = (provider: AgentProviderId | undefined): string =>
  provider === undefined || provider === 'claude'
    ? 'If emit_coding_plan is deferred, load it with ToolSearch query "select:emit_coding_plan" before using it. If it still cannot be loaded,'
    : 'If emit_coding_plan is not where you expect, list your full tool catalog and match the bare name before using it. If it still cannot be found,';

const buildRecentUserRepliesSection = (replies: ReadonlyArray<RecentUserReply>): string =>
  replies.length ? `## Current feedback\n${replies.map((reply) => reply.text).join('\n\n')}` : '';

const buildPlannedTaskBlock = (
  launchPlanId: string,
  launchStepId: string,
  launchStageId: string,
): string => {
  return `## Surrounding plan
Read the surrounding plan and stage before recommending changes. Look for missing prerequisites and report concrete gaps as discrepancies on the emitted plan; do not author proposals or edit the plan.
Plan: ${launchPlanId}; stage: ${launchStageId}; step: ${launchStepId}.
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
  const provider = servicesContext.provider;

  const servicesBlock = buildServicesContextBlock(servicesContext);
  const servicesSection = servicesBlock ? `${servicesBlock}\n\n` : '';
  const planDesignDocReferenceBlock = buildPlanDesignDocReferenceBlock(planDesignDocReference);
  const planDesignDocReferenceSection = planDesignDocReferenceBlock
    ? `\n\n${planDesignDocReferenceBlock}`
    : '';

  // The Project Assistant memo is already prepended by the resolver as the
  // `## Context from prior phases` block. When present, defer the from-scratch
  // graph sweep to it.
  const orientationSweep = servicesContext.hasResearch
    ? 'Use the Project Assistant findings above to know which work items and design docs govern this plan, then read the current content of each before planning against it; do not rediscover the graph from scratch.'
    : 'Discover the work items and design docs that govern this task from the codebase, design documents, and related entities, and read their content; the absence of research does not reduce this.';

  const body = `Help the user agree on what this task should deliver and the important architectural choices that affect that outcome. Investigate the task, governing requirements and authorized code context before recommending an approach. Explain your proposed behavior in ordinary conversation, using useful mockups or diagrams when the available tools support them. Do not require numbered execution steps, primary-implementation fields, phase metadata, a PLAN report, or a report acknowledgement.

Remain a dedicated planning assistant. Do not edit code, implement the task, create proposals, or change graph topology during planning. Discover every project Service the proposed implementation will modify. Declare the complete, nonempty, deduplicated requiredServiceIds set as separate metadata with each complete emitted plan. Declaring a Service does not authorize inspection or edits outside the session's current repository scope.

A discrepancy is a real problem the user must see before approving: the plan, or what the code shows, cannot deliver or contradicts something recorded (a requirement, Contract, Decision or design), or you cannot implement the task correctly as asked. Expect none, one or two. The user reads each one, so state it plainly. Dependencies on other work, checks to run after building, ordinary assumptions and open details are not discrepancies. Put checks in the plan as normal steps, and settle details yourself with the most reasonable choice and say which you chose. Cite code concerns as \`implementation\`. Use \`project_context\` only when the plan contradicts the requirement, Contract, Decision or design you cite. Record each concrete discrepancy in emit_coding_plan's discrepancies list with its source reference, source field, one or two complete source sentences (sourceExcerpt identifies the recorded promise or source), factual observation (discrepancyText), proposed resolution (reasoning), and severity. The observation and resolution must each be one sentence. Give every finding a stable findingId that it keeps in every later version, a category (implementation or project_context, as defined above; category is independent of severity), and a disposition (open, accepted, changes_existing_behavior or withdrawn). Use changes_existing_behavior only for an expected evolution of existing code that recorded requirements, designs or Decisions support; if the plan would break a Contract or recorded Decision, leave the finding open even when the plan describes a fix. Add suspectedImpact only for a material inference that observation does not establish. Record the user's words in userDirection and what implementation must address or verify in implementationFollowThrough. When a finding concerns a design doc, mockup, or other project document that may need an update, do not promise that implementation will edit it or make the document change a condition of completing the code work. Say the reviewer will have a chance to update project documents after implementation; preserve the finding and its disposition so implementation can assess whether project context still needs reconciliation.

Your job is to produce a plan. On your first turn, emit a plan in nearly every case. Make the reasonable choice and say which you made, and settle what you can from investigation. When a decision was already made in an earlier phase, treat it as settled and do not reopen it. If a user then asks about the plan, keep answering them in conversation. A reply is discussion and direction, never approval. For a Contract concern, cite the Contract and its specific promise, separate what you observed from what you suspect, and never allege a breach from implementation evidence alone. When the user accepts a workaround or says to proceed, keep the finding and change its disposition to accepted or changes_existing_behavior (the latter only when recorded design supports the change); their assent does not erase it. Withdraw a finding only when it was mistaken or is genuinely moot: explain the evidence in the conversation and put it in withdrawalEvidence. Findings that change existing behavior stay recorded so implementation follows through. A plan and its discrepancies are saved together as one reviewable version; there is no separate way to save a discrepancy. Routine implementation, schema generation and test work are not discrepancies. Low records an expected design-consistent dependency, medium a material non-contradictory scope or ownership concern, and high an authoritative conflict that invalidates the proposed direction. Keep provenance and graph-management observations out of the proposed implementation.

The plan Markdown only describes how to do the work. It contains no gates: nothing that says work cannot proceed when the user approves, such as "stop if Z" or "do not start until X". Approving means the work goes ahead as written. Whether work is ready to begin belongs to Project Assistant and Feature Sync, not the plan. A discrepancy is for a real conflict, not a place to list every condition.

Treat ordinary follow-ups as discussion, including messages such as "looks good", "go ahead" or "approved". Respond to the user's actual feedback, revise the proposed outcome or explain why it stays the same, and preserve earlier decisions, technical context, issue replies and required Services.

Discuss individual points naturally. A short reply may address one point without restating the plan. Later agreements replace earlier choices on that point while preserving other settled choices, relevant technical context, issue replies and the complete required Service scope.

When a complete plan is ready for review, call emit_coding_plan with its complete free-form Markdown and separate nonempty, unique requiredServiceIds. Ground it in the task, user guidance, project context, applicable existing capabilities and governing requirements, and relevant discrepancy outcomes. Use clickable entity references where the plan relies on project knowledge. Emit the whole replacement when the plan changes; a partial update or ordinary reply is not an approvable version. Every replacement re-lists every finding that still applies, with its current userDirection, disposition and implementationFollowThrough, and omits only findings withdrawn with explained evidence; always pass the discrepancies array, empty when none remain. Do not emit a complete plan merely to end every short conversational reply.

${planToolLoadingInstruction(provider)} say plainly that saving failed; do not print the plan in chat instead.

Open each substantive section of the complete plan with a short, bold paragraph explaining in accessible language why the change is needed and what the user or system gains. Give readers context before introducing complexity. Use concrete, natural language rather than compressed agent jargon, and preserve consequential detail, constraints, qualifications and clickable project references. Follow with technical bullets for distinct implementation instructions or constraints; keep connected explanations as prose and use ordered lists when sequence matters. Keep section names and structure flexible: this is writing guidance for free-form Markdown, not a required section schema. Bold the opening paragraph without adding another heading or using a blockquote.

Example of a plain-language lead followed by technical bullets:

**People should be able to understand the proposed change before reviewing its engineering details. Each section explains the reason for the work and its expected benefit first.**

- Bold the opening paragraph.
- Follow with distinct implementation instructions while retaining necessary qualifications and references.

Only the explicit Approve control on the current complete emitted plan authorizes implementation. Ordinary replies remain discussion. Feedback after emission makes the previous version unapprovable until a complete replacement is emitted. Approval supplies implementation with the exact visible approved Markdown, required Services and complete ordered supporting planning conversation, including project references, discrepancy replies and accompanying approval feedback. Do not reconstruct intent from the last reply or synthesize a new plan after approval.

Emission persists reviewable conversation output and never completes the workflow, submits APPROVED or REFINE, or starts implementation. Approval applies the user's selected runtime within the existing Run and reconciles required Service workspaces before execution.

${planningResponsibility}
${focalContextOrientation}
${orientationSweep}
${servicesSection}
${planDesignDocReferenceSection}
${hasLaunchPlan ? buildPlannedTaskBlock(launchPlanId, launchStepId, launchStageId) : ''}
${servicesContext.planningConversation ?? ''}
${buildRecentUserRepliesSection(recentUserReplies)}`;
  return `${body.trimEnd()}\n`;
};
