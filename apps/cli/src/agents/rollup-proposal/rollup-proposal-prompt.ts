import { jsonOnlyInstructions } from '../prompts/common';

interface TaskSection {
  key: string;
  content: string;
}

export interface TriggeringTask {
  id: string;
  title: string;
  status: string;
}

export interface AncestorTask {
  id: string;
  title: string;
  status: string;
  sections: TaskSection[];
}

export interface RollupProposalPromptInput {
  triggeringTask: TriggeringTask;
  /** Ancestor tasks from direct parent up to root, closest first. */
  ancestors: AncestorTask[];
  projectId: string;
}

const formatTriggeringTask = (task: TriggeringTask): string => {
  return `**ID:** ${task.id}\n**Title:** ${task.title}\n**Status:** ${task.status}`;
};

const formatAncestor = (task: AncestorTask, index: number): string => {
  const sections = task.sections.map((s) => `#### ${s.key}\n\n${s.content}`).join('\n\n');
  const depth = index === 0 ? 'direct parent' : `ancestor (${index + 1} levels up)`;
  return `**ID:** ${task.id}\n**Title:** ${task.title}\n**Status:** ${task.status}\n**Relationship:** ${depth}\n\n${sections || '(no sections)'}`;
};

export const buildRollupProposalPrompt = (input: RollupProposalPromptInput): string => {
  const { triggeringTask, ancestors, projectId } = input;

  const ancestorsBlock =
    ancestors.length > 0
      ? ancestors.map(formatAncestor).join('\n\n---\n\n')
      : '(No ancestor tasks found — this task has no parent hierarchy)';

  return `You are a feature reviewer. A task was recently created or updated. Your job is to determine how this change should be reflected upward in the feature hierarchy, then propose updates using \`edit_work_item\` tool calls.

**Important:** \`edit_work_item\` creates proposals for human review — it does NOT apply changes directly. Frame all updates as suggestions.

## The Triggering Task (what changed)

${formatTriggeringTask(triggeringTask)}

## Ancestor Tasks (what may need updating)

These are the tasks that sit above the triggering task in the hierarchy, closest parent first:

${ancestorsBlock}

## Your Instructions

1. **Understand the change**: Read the triggering task's title and status, then use the canonical focal entity projection supplied at provider startup for its description, acceptance criteria, and other authoritative content. What new capability, constraint, or detail does it introduce? (In the calculator example: "Add sqrt with high precision — support up to 18 digits")

2. **Identify what needs updating in the ancestors**: For each ancestor task, decide whether its description or sections need to reflect this change. Ask:
   - Does this ancestor's description already cover this capability/constraint?
   - Would a reader of this ancestor task be surprised to find the triggering task here?
   - Is there a specific section (e.g., "operations", "display", "precision") that should be updated?

3. **Search for related features** using \`unified_search\` with:
   - Query: synthesized from the triggering task's title and description
   - Filter: \`projectId = "${projectId}"\`, entity type TASK
   - Purpose: find sibling or related feature tasks that are affected by the same change (e.g., a UI feature that needs to display more digits because of a precision change in the engine feature)
   - Only target results with clear semantic overlap — don't cast a wide net

4. **Propose updates** via \`edit_work_item\` for:
   - Any ancestor tasks whose description should grow to reflect this new work
   - Any related features found via search that share scope or dependencies with the triggering change

5. **Track proposal IDs**: Each \`edit_work_item\` call returns a proposal ID. Track which IDs came from:
   - Direct ancestor edits → \`parentFeatureProposalIds\`
   - Related feature edits found via search → \`relatedFeatureProposalIds\`

## Response Format

After completing all \`edit_work_item\` calls, return a JSON object:

{
  "responseType": "rollup_proposal_v1",
  "parentFeatureProposalIds": ["<proposal-id-from-ancestor-edits>"],
  "relatedFeatureProposalIds": ["<proposal-id-from-related-feature-edits>"]
}

Rules:
- If no ancestor updates are needed, use an empty array for \`parentFeatureProposalIds\`
- If no related features need updates, use an empty array for \`relatedFeatureProposalIds\`
- Only propose updates where there is a concrete, specific change implied by the triggering task — do not pad
- Prefer updating the most specific ancestor that owns the relevant scope rather than updating every level

${jsonOnlyInstructions}`;
};
