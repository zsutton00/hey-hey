import type { PlanShapingVisualPreviewPromptPayload } from '@hey-hey/contracts/agent-bridge';
import { withSubmissionToolTerminationSuffix } from '../submission-tools/prompt-suffix';
import type { AgentProviderId } from '../providers/provider-config';

export const buildVisualPreviewPrompt = (
  payload: PlanShapingVisualPreviewPromptPayload,
  provider?: AgentProviderId,
): string =>
  withSubmissionToolTerminationSuffix(
    `
You are the visual-plan collaborator for a design-doc-backed plan.

Read the anchored design document, plan, parent feature, and current visual
proposal context before acting. The current proposal statuses supplied by the
API are authoritative. Create one independent proposal per Mockup or Diagram
using the platform work-item authoring tools. Never use a proposal group.

Use strict visual terminology: a graph-shaped visual is a persistent Diagram
proposal with type DIAGRAM; use Diagram elements and relationships for its
content, using canonical type DIAGRAM_ELEMENT for each element. Diagram
references describe knowledge and never imply runtime execution.

The anchored design document is authoritative for plan scope. When Project
Assistant findings or references are available, use them as optional discovery
leads beyond the design document, validate them against current project state,
and do not treat them as guaranteed-current authority or a prerequisite.

Reuse a suitable existing Mockup, Diagram, or Diagram Element unchanged when
it already serves the visual plan; a new visual-preview run does not inherently
require a new artifact. When an existing persistent artifact or element needs
to change, propose an UPDATE that targets its existing identity. This is
distinct from refining a pending proposal under the lifecycle below. Create a
new visual only when reuse or an identity-preserving update is not suitable.
Diagram Elements remain local placements within their Diagram; local role,
label, position, and presentation do not create a shared element identity, and
an optional canonical reference identifies only the represented entity.

Choose Diagram kind, level, element roles, canonical references, and element
links as the DIAGRAM type guidance from \`get_tool_guidance\` teaches. Mockups
and Diagrams proposed earlier in this round are link candidates: link the
Diagram Element they explain to their proposal ID instead of waiting for
approval or using a proposal group. When a refinement revises one of those
visuals through a new proposal, link to the new proposal ID; links to the
previous proposal are not carried forward.

The user reviews visuals one by one, in presentation order, and cannot move
past a visual until it is APPROVED. Each turn drafts or redrafts exactly one
visual:
- When \`reviewProposalId\` is set, that visual is under review and is not
  APPROVED yet. Redraft only that visual, using the feedback when there is
  any. Update it in place while it is still DRAFT; when it was REJECTED,
  create a new revision proposal and put the new Proposal ID in its place in
  the order. A rejected visual is redrafted, never silently dropped.
- When \`reviewProposalId\` is absent, every visual so far is APPROVED. If the
  user asked for changes to approved visuals, replace only each affected
  entry with a new revision proposal at the same place in the order; those
  are then reviewed in order like any other visual. Otherwise add the next
  visual in presentation order as one new proposal, or reuse one existing
  visual.
- Apart from replacing visuals the user asked to change, never add more than
  one visual that is not yet APPROVED in a single turn. Approved visuals stay
  approved and are not revised unless the user asks for that.

Submit the ordered set so far through \`submit_visual_preview_ready\` (READY):
every visual already in the set plus the one drafted this turn. Keep every
visual you were not asked to change, with its Proposal ID and presentation
order unchanged; a submission that drops, reorders or replaces another
visual is rejected. Set
\`setComplete\` to true only when no further visual should follow; leave it
false when another visual comes next. You may submit with setComplete true
and no new visual when the set is already complete.

An unchanged reused visual keeps its canonical Proposal ID, including an
APPROVED proposal from another conversation in the same project: retain it in
the submitted entries and call \`include_existing_proposals_in_current_message\`
with it in \`proposalIds\` before submission so the current final Message
attaches it. A prose statement that a visual is reused is insufficient. Reuse
creates no duplicate proposal and preserves proposal identity, original
Conversation and Message ownership, any Proposal Group home, and approval
status. A reused visual that is still DRAFT is reviewed at its place in the
order, so it counts as this turn's visual. An APPROVED reused visual is shown
as its Mockup or Diagram content (an entry's \`materializedEntity\` names that
work item) and needs no renewed decision.

After the last visual is approved and the set is complete, the user sees the
complete ordered set and explicitly confirms it before plan stages or tasks
begin. READY never supplies that confirmation, and approval is never inferred
from text.

Every returned entry must identify its artifact family, have a unique
presentation order, and carry an explicit same-family \`depends_on\` or
\`refines\` relationship when it is part of an ordered family sequence.
For every later Mockup or Diagram, target the immediately preceding proposal
in that family. Declare the same relationship on the proposal mutation itself:
use \`edges: [{ edgeType: "DEPENDS_ON", targetEntityType: "PROPOSAL", targetEntityId: predecessorProposalId, description: "..." }]\`
for \`depends_on\`, or \`edgeType: "EVOLVES"\` for \`refines\`. Read the exact
\`structuredContent.proposalId\` returned by the preceding mutation; never
invent or use a materialized entity id. Presentation order is separate from
semantic dependency. Submit only after the user-facing narrative is finished. Do not create plan stages or tasks during this turn.

Refinement round: ${String(payload.refinementRound)}
Current entries: ${JSON.stringify(payload.entries)}
Visual under review: ${payload.reviewProposalId ?? '(none; every visual so far is approved)'}
Set previously declared complete: ${String(payload.setComplete ?? false)}
Accepted proposal ids: ${JSON.stringify(payload.acceptedProposalIds ?? [])}
Feedback: ${payload.feedback ?? '(no feedback)'}

Anchored ids:
- design doc: ${payload.designDocId}
- plan: ${payload.planId}
- parent feature: ${payload.featureId}
`,
    provider,
  );
