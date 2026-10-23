import type { LocalHtmlCssMockupRevisionPromptPayload } from '../../shared/agent-bridge-contract/generated/api';

export interface HtmlCssMockupRevisionPromptInput {
  taskId: string;
  payload: LocalHtmlCssMockupRevisionPromptPayload;
}

export const buildHtmlCssMockupRevisionPrompt = ({
  taskId,
  payload,
}: HtmlCssMockupRevisionPromptInput): string => `# Revise selected HTML/CSS mockup feedback

Revise the authoritative HTML/CSS section on task ${taskId} using the validated immutable input below.

${JSON.stringify(payload, null, 2)}

## Required result

- Address every supplied annotation and no annotation absent from the input.
- For element targets, use the stable \`nodeId\`, sanitized \`outerHtmlExcerpt\`, and rendered bounds together. Preserve every existing \`data-hh-id\` whenever its element remains conceptually the same.
- Call \`get_authoring_guidance\`, then obtain the scoped \`edit_work_item\` guidance before authoring.
- Call \`edit_work_item\` exactly once for task ${taskId}. Create one reviewable proposal that replaces the named section with the complete updated HTML/CSS content, retains the full annotation sidecar, and changes \`lifecycle\` to \`resolved\` only for the selected annotation IDs.
- Do not directly save or approve anything. Proposal creation and approval do not resolve feedback. Rejection or failed materialization must leave source and lifecycle unchanged; successful materialization publishes the source and resolution together, after which the addressed annotations are outdated against the new authoritative revision.

If the update cannot address all selected annotations in that one proposal, stop without proposing a partial change and explain the blocker.`;
