import { z } from 'zod';

import { PROPOSAL_TOOL_NAMES } from './proposal-tool-names';

/**
 * v1 proposal-tool lint. Pre-persist gate that runs between input
 * normalization and ProposalService.create. v1 ships a single rule
 * (paragraph_count); the registry shape is preserved so v2 rules can
 * slot in without re-shaping the response.
 *
 * Each rule declares the tool names it polices via `appliesTo`, and
 * `runProposalLint` only runs rules whose scope includes the calling
 * tool. The lint envelope itself stays family-wide across all six
 * proposal handlers — scoping a rule narrows where it fires, not which
 * handlers carry the discriminated response.
 */

export const lintFindingSchema = z.object({
  rule: z.string().describe('Lint rule identifier (e.g. paragraph_count).'),
  severity: z
    .enum(['error', 'warning'])
    .describe(
      '`error` blocks proposal persistence; `warning` is advisory and is ' +
        'returned on the successful proposal response.',
    ),
  path: z
    .string()
    .describe('Stable field path identifying the affected proposed state.'),
  sectionKey: z
    .string()
    .optional()
    .describe('Legacy section key retained for paragraph-count findings.'),
  message: z.string().describe('Human-readable description of the problem.'),
  suggestion: z
    .string()
    .describe(
      'Pointer to the canonical guidance for this tool — typically a ' +
        'get_tool_guidance({ toolName }) call the agent should re-read.',
    ),
});

export type LintFinding = z.infer<typeof lintFindingSchema>;

export interface LintSection {
  key: string;
  content: string | undefined;
}

export interface LintInput {
  tool: string;
  /**
   * Work-item type the generic create_work_item / edit_work_item call is
   * authoring. Rules scoped by `appliesToWorkItemTypes` use this to keep
   * their per-type blast radius now that one tool name covers all types.
   */
  workItemType?: string;
  sections: LintSection[];
}

interface LintRule {
  /**
   * Tool names this rule polices. `runProposalLint` skips the rule for
   * any tool not in this set, so a rule's blast radius is declared here
   * rather than leaking into the rule body or the call sites.
   */
  appliesTo: ReadonlySet<string>;
  /**
   * Work-item types this rule polices on the generic tools. When set,
   * the rule is skipped unless the call's `workItemType` is in the set.
   * Calls without a workItemType (non-work-item tools) are unaffected.
   */
  appliesToWorkItemTypes?: ReadonlySet<string>;
  run: (input: LintInput) => LintFinding[];
}

const MAX_PARAGRAPHS = 3;

// Scoped to the task tools only. The remaining proposal handlers
// (feature, design_doc) still carry the lint envelope but no v1 rule
// fires for them; a v2 feature/design-doc rule would declare its own
// `appliesTo` without touching any handler.
const paragraphCountRule: LintRule = {
  appliesTo: new Set([
    PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
    PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
  ]),
  // Parity with the retired create_task / edit_task scope: the rule fired
  // for plain tasks (STANDARD, and BUG via edit_task) but never for
  // FEATURE or GOAL authoring.
  appliesToWorkItemTypes: new Set(['STANDARD', 'BUG']),
  run: ({ tool, sections }) => {
    const findings: LintFinding[] = [];
    for (const section of sections) {
      const trimmed = section.content?.trim();
      if (!trimmed) continue;
      const paragraphs = trimmed
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (paragraphs.length > MAX_PARAGRAPHS) {
        findings.push({
          rule: 'paragraph_count',
          severity: 'error',
          path: `sections.${section.key}`,
          sectionKey: section.key,
          message:
            `Section "${section.key}" has ${paragraphs.length} paragraphs; ` +
            `tighten to ${MAX_PARAGRAPHS} or fewer.`,
          suggestion: `get_tool_guidance({ toolName: "${tool}" })`,
        });
      }
    }
    return findings;
  },
};

const rules: LintRule[] = [paragraphCountRule];

export function runProposalLint(input: LintInput): LintFinding[] {
  return rules
    .filter((rule) => rule.appliesTo.has(input.tool))
    .filter(
      (rule) =>
        !rule.appliesToWorkItemTypes ||
        input.workItemType === undefined ||
        rule.appliesToWorkItemTypes.has(input.workItemType),
    )
    .flatMap((rule) => rule.run(input));
}

export function blockingLintFindings(
  findings: readonly LintFinding[],
): LintFinding[] {
  return findings.filter((finding) => finding.severity === 'error');
}
