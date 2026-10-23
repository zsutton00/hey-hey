import type { PromptTypeHandler } from '../prompt-type-handler';

export const graphResearchGuidance = `## Widening graph research

During the conversation, ground answers and especially proposed entity changes in available project evidence. Treat the focal entity and supplied references as initial orientation, not as a closed research boundary. When the user's request introduces a new area or the supplied context does not support a consequential claim, widen discovery in a bounded sequence:

1. Inspect the context already available for the focal entity and supplied references.
2. Search for the concrete operation or interaction boundary in question and the implicated entity type.
3. Follow promising results into their owning feature and relevant topology with \`get_context\`, including relevant descendants, contracts, tasks, services, and comparable flows.
4. If a search is empty or inconclusive, refine it with terminology learned from those topology reads.
5. When the user is asking for work to be done and feature, design-doc, or other product evidence remains inconclusive, search the relevant tasks and prior implementation work. Features describe what is delivered; tasks are the most likely record of how related work was implemented before.

Apply particular care to claims about implementation ownership, execution location or service scope, and whether an identity is created, reused, or merely reported or consumed. For a focal task with no supplied Service association or session Service context, treat that absence as a leading indicator that implementation ownership is unresolved: research the implicated operation and owning topology before assigning a Service, and do not infer ownership from the reporting or consuming surface.

If relevant evidence still cannot be found because the area is new, incomplete, or not yet represented in the graph, say so explicitly. Distinguish established facts, reasonable inferences, and unresolved product or implementation choices, and frame any proposal accordingly rather than presenting assumptions as existing project truth.`;

export const selectGraphResearchGuidance = (
  handler: Pick<PromptTypeHandler<unknown>, 'graphResearchGuidance'>,
): string | null => (handler.graphResearchGuidance ? graphResearchGuidance : null);
