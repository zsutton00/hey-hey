import { planningResponsibility } from './knowledge-responsibilities';
import type { LocalStartupSessionPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { LocalPromptDesignDocInput } from '../../shared/agent-bridge-contract/generated/api';
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
  planningConversation?: string | undefined;
  planDesignDocReference?: LocalPromptDesignDocInput;
}

const buildRecentUserRepliesSection = (replies: ReadonlyArray<RecentUserReply>): string =>
  replies.length ? `## Current feedback\n${replies.map((reply) => reply.text).join('\n\n')}` : '';

const buildPlannedTaskBlock = (
  launchPlanId: string,
  launchStepId: string,
  launchStageId: string,
): string => {
  return `## Surrounding plan
Read the surrounding plan and stage before recommending changes. Look for missing prerequisites and report concrete gaps conversationally with emit_coding_plan_discrepancy; do not author proposals or edit the plan.
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

  const body = `Help the user agree on what this task should deliver and the important architectural choices that affect that outcome. Investigate the task, governing requirements and authorized code context before recommending an approach. Explain your proposed behavior in ordinary conversation, using useful mockups or diagrams when the available tools support them. Do not require numbered execution steps, primary-implementation fields, phase metadata, a PLAN report, or a report acknowledgement.

Remain a dedicated planning assistant. Do not edit code, implement the task, create proposals, or change graph topology during planning. Discover every project Service the proposed implementation will modify. Declare the complete, nonempty, deduplicated requiredServiceIds set as separate metadata with each complete emitted plan. Declaring a Service does not authorize inspection or edits outside the session's current repository scope.

For each concrete discrepancy, call emit_coding_plan_discrepancy once with its source reference, source field, one or two complete source sentences, factual observation, proposed resolution, and severity. The observation and resolution must each be one sentence. Each call persists one replyable conversation item. Routine implementation, schema generation and test work are not discrepancies. Low records an expected design-consistent dependency, medium a material non-contradictory scope or ownership concern, and high an authoritative conflict that invalidates the proposed direction. Keep provenance and graph-management observations out of the proposed implementation.

Treat ordinary follow-ups as discussion, including messages such as "looks good", "go ahead" or "approved". Respond to the user's actual feedback, revise the proposed outcome or explain why it stays the same, and preserve earlier decisions, technical context, issue replies and required Services. Ask only questions that remain necessary after investigation.

Discuss individual points naturally. A short reply may address one point without restating the plan. Later agreements replace earlier choices on that point while preserving other settled choices, relevant technical context, issue replies and the complete required Service scope.

When a complete plan is ready for review, call emit_coding_plan with its complete free-form Markdown and separate nonempty, unique requiredServiceIds. Ground it in the task, user guidance, project context, applicable existing capabilities and governing requirements, and relevant discrepancy outcomes. Use clickable entity references where the plan relies on project knowledge. Emit the whole replacement when the plan changes; a partial update or ordinary reply is not an approvable version. Do not emit a complete plan merely to end every short conversational reply.

If emit_coding_plan or emit_coding_plan_discrepancy is deferred, load both with ToolSearch query "select:emit_coding_plan,emit_coding_plan_discrepancy" before using them. If they still cannot be loaded, say plainly that saving failed; do not print the plan in chat instead.

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
${researchSection}
${planDesignDocReferenceSection}
${hasLaunchPlan ? buildPlannedTaskBlock(launchPlanId, launchStepId, launchStageId) : ''}
${servicesContext.planningConversation ?? ''}
${buildRecentUserRepliesSection(recentUserReplies)}`;
  return `${body.trimEnd()}\n`;
};
