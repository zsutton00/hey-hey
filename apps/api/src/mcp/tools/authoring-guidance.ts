import { z } from 'zod';

/**
 * Shared proof that the agent has read the mutation-specific topology rules.
 *
 * This is deliberately static. It is reusable, non-expiring, and
 * non-consumable; possession demonstrates only that the guidance was read and
 * never authorizes a mutation or replaces the semantic validators below the
 * MCP boundary.
 */
export const AUTHORING_ROOT_PROOF_FIELD = 'authoringRootProof' as const;
export const AUTHORING_ROOT_PROOF = 'heyhey-authoring-root-v1' as const;

export const authoringGuidanceOutputSchema = z
  .object({
    guidance: z.string().min(1),
    [AUTHORING_ROOT_PROOF_FIELD]: z.literal(AUTHORING_ROOT_PROOF),
  })
  .strict();

export const TOPOLOGY_AUTHORING_GUIDANCE = [
  '## Topology authoring guidance',
  'Diagram groups may declare optional `color`: blue, green, orange, purple, red, or teal. Color represents identity, never meaning: give groups representing the same thing the same color (AWS → GCP → AWS uses one AWS color and another GCP color). Omit color for stable automatic assignment; do not persist automatic colors. Preserve authored colors, ids, membership and nesting when replacing diagramGroups. Visual associations have dashed borders; structural and deployment boundaries have solid borders regardless of color. Color edits never move saved positions or change canonical references, relationships or Contract participation. Workflow step colors retain their existing hex-color behavior.',
  "Proposal edges have two endpoint modes. Omitted or ENTITY retains deferred entity-edge approval and rejection cleanup. Explicit PROPOSAL requires an existing same-organization/project PROPOSAL target and stores a durable relationship between proposal identities, with proposal titles snapshotted at authoring. Approval never substitutes materialized entities; undecided or rejected targets retain the link. Durable DEPENDS_ON is descriptive and does not create grouped enactment prerequisites. When creating a Diagram, declare each element's links on the element in `diagramElements[].edges`, targeting an existing work item or a same-round CREATE proposal; Diagram-level `edges` link the whole Diagram. When editing a Diagram, links to existing work items are relationship.create operations, and deferred ENTITY outer edges to CREATE proposals start from their declared sourceRef or the Diagram root when sourceRef is omitted. Diagram-internal flow relationships and layout remain operations. Diagram groups and boundaries live in the Diagram's `diagramGroups` section, are diagram-local, and never create edges, parentage, or Contract participation.",
  '',
  'Call get_authoring_guidance() once before an operation that can create or change project topology. Carry authoringRootProof into the applicable specific guidance read and topology mutation calls. The root proof is reusable, non-expiring, non-consumable, and demonstrates only that this guidance was read; it is not authorization and never replaces semantic validation.',
  '',
  'Proposal groups are for a real proposal-level enactment prerequisite that cannot be valid against live state until another member is enacted. Start the group before drafting members, use server-reserved CREATE identities in dependent references, maintain complete group-local all-of prerequisites, inspect the persisted authoring snapshot before finalization, and start a new group after the mutation set is frozen. Topic, parent, adjacency, shared message, target type, or approve-all convenience is not eligibility.',
  '',
  'TRACKS attachments must use the central source-eligibility and target allow-list configuration. Attach a new item and its TRACKS relationship atomically through the compound create input; use attach_to_goal only for an already materialized target, and do not confuse the tracking source with structural parentage.',
  '',
  'Discover Contracts from a concrete boundary and its narrowly stated durable operation, payload, timing rule, semantic promise, availability guarantee, or acknowledgement responsibility. In a Diagram, start from the represented interaction point and its explicit responsibility; outside a Diagram, use the narrowest authoritative operation, work item, design artifact, or schema. A durable authoritative producer interface may qualify before a consumer exists. Record participant responsibility explicitly: GUARANTEES identifies the Diagram element representing the provider-owned interaction point, IMPLEMENTS identifies implementation or enforcement, and CONSUMES identifies consumption. Role, shape, source-code location, proximity, or ordinary flow cannot establish provider authority. Use STANDARD, CONDITIONAL, and LOOP for process flow and keep FULFILLED_BY implementation evidence separate. Ad hoc interactions, broad channels, reference roll-ups, and schema mentions without a narrowly stated agreement remain ordinary topology.',
  '',
  'For a recognized Contract, structural parentage is sufficient for its owning feature; do not duplicate that ownership with a feature edge. From the Contract, create `RELATED_TO` for every other feature directly evidenced as providing, consuming, or enforcing the promised behavior. Diagram participant relationships are distinct: author GUARANTEES, IMPLEMENTS, and CONSUMES only from the represented DIAGRAM_ELEMENT to the Contract, according to explicit responsibility; prose mentions materialize neither relationship. Do not create legacy DIAGRAM_ELEMENT DEPENDS_ON Contract links. Do not fan out Contract edges to ancestors, incidental implementation features, or every downstream feature, and do not use feature-level `DEPENDS_ON` without a separately evidenced delivery dependency.',
  '',
  'Use structured edge and Diagram graph fields for topology mutations; keep ordinary mentions and feature-reference prose separate from typed relationships. Preserve the existing supersede approval path, reference validation, graph ownership checks, and all other semantic validators.',
  '',
  'Specific guidance returns its existing scoped proof in addition to the shared root proof handshake. Missing or mismatched root or scoped proofs must name the exact guidance call to retry.',
].join('\n');

export function validateAuthoringRootProof(args: {
  toolName: string;
  token: string | undefined;
  required: boolean;
}): string | null {
  if (!args.required) return null;

  const retry = 'get_authoring_guidance()';
  if (!args.token?.trim()) {
    return `${args.toolName} requires ${AUTHORING_ROOT_PROOF_FIELD}. Call ${retry} once, then pass its returned root proof back on this topology-authoring call.`;
  }
  if (args.token.trim() !== AUTHORING_ROOT_PROOF) {
    return `${AUTHORING_ROOT_PROOF_FIELD} does not match the shared authoring proof. Retry ${retry} and pass the returned root proof; proof possession does not replace semantic validation.`;
  }
  return null;
}

/**
 * Return true only when an input actually carries a topology mutation. Empty
 * arrays are treated as omitted so scalar-only edits remain token-free.
 */
export function topologyMutationRequested(input: {
  parentTaskId?: unknown;
  parentEntityId?: unknown;
  parentEntityType?: unknown;
  edges?: ReadonlyArray<unknown>;
  tracks?: unknown;
  groupContext?: unknown;
  diagramElements?: ReadonlyArray<unknown>;
  operations?: ReadonlyArray<unknown>;
  layoutBoundary?: unknown;
  requirementOps?: ReadonlyArray<unknown>;
}): boolean {
  return Boolean(
    input.parentTaskId !== undefined ||
      input.parentEntityId !== undefined ||
      input.parentEntityType !== undefined ||
      input.edges?.length ||
      input.tracks !== undefined ||
      input.groupContext !== undefined ||
      input.diagramElements?.length ||
      input.operations?.length ||
      input.layoutBoundary !== undefined ||
      input.requirementOps?.length,
  );
}
