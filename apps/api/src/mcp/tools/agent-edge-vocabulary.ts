import type { AgentEdgeType } from '../../generated/model/agentEdgeType';

/**
 * Single source of truth for the agent-authorable edge vocabulary.
 *
 * To add or retire an agent-authorable edge type, edit this module — nowhere
 * else. `create_edge`, `update_edge`, `get_edges`, the proposal-edge
 * declaration schema, and the MCP guidance string all derive from the arrays
 * declared here, so any change propagates without parallel edits.
 *
 * The vocabulary is partitioned against the generated `AgentEdgeType` enum
 * (regenerated from openapi/specs/schemas/agent-edges.yaml) by two `as const`
 * arrays whose union must equal `AgentEdgeType` exactly. A compile-time
 * exhaustiveness check below fails type-check the moment the spec gains or
 * drops a value until the author classifies it as `authorable` or `excluded`
 * here. There is no second place where a wire-level edge type can be silently
 * added to or removed from the agent surface.
 */

/**
 * Canonical set of agent-authorable edge types, pinned to the wire contract.
 * Every member must exist in the generated `AgentEdgeType` union — a typo or
 * a name that the OpenAPI enum does not carry fails type-check here rather
 * than at runtime.
 */
export const AGENT_EDGE_TYPES = [
  'RELATED_TO',
  'DEPENDS_ON',
  'DERIVES_FROM',
  'SUPERSEDES',
  'CONTRADICTS',
  'EVOLVES',
] as const satisfies readonly AgentEdgeType[];

export type AgentEdgeVocabType = (typeof AGENT_EDGE_TYPES)[number];

export const WORKFLOW_META_EDGE_TYPES = [
  'FULFILLED_BY',
  'GUARANTEES',
  'IMPLEMENTS',
  'CONSUMES',
] as const satisfies readonly AgentEdgeType[];

export type WorkflowMetaEdgeType = (typeof WORKFLOW_META_EDGE_TYPES)[number];

export const WORKFLOW_FLOW_EDGE_TYPES = [
  'STANDARD',
  'CONDITIONAL',
  'LOOP',
] as const satisfies readonly AgentEdgeType[];

export type WorkflowFlowEdgeType = (typeof WORKFLOW_FLOW_EDGE_TYPES)[number];

export const WORKFLOW_EDGE_TYPES = [
  ...WORKFLOW_META_EDGE_TYPES,
  ...WORKFLOW_FLOW_EDGE_TYPES,
] as const satisfies readonly AgentEdgeType[];

export type WorkflowEdgeType = (typeof WORKFLOW_EDGE_TYPES)[number];

/**
 * Edge types the OpenAPI contract carries but the agent surface deliberately
 * does NOT expose. Each is excluded for a distinct reason:
 *   - TRACKS — goal-scoped structural type validated at the attach boundary,
 *     not by raw edge authoring.
 *   - PROPOSED_TOGETHER — symmetric, system-emitted co-authorship edge derived
 *     by the Graph service from approved proposals; read-only on the agent
 *     surface.
 *   - FULFILLED_BY — visible meta fulfillment link for workflow_step items;
 *     created by workflow-aware authoring paths, not raw edge authoring.
 *   - STANDARD, CONDITIONAL, LOOP — workflow flow links. They describe
 *     workflow graph sequencing and must stay out of generic meta-edge
 *     authoring guidance.
 *
 * Listing them here (rather than implicitly omitting them) is what lets the
 * exhaustiveness check below classify the full `AgentEdgeType` union.
 */
export const EXCLUDED_AGENT_EDGE_TYPES = [
  'TRACKS',
  'PROPOSED_TOGETHER',
  ...WORKFLOW_EDGE_TYPES,
] as const satisfies readonly AgentEdgeType[];

export type ExcludedAgentEdgeType = (typeof EXCLUDED_AGENT_EDGE_TYPES)[number];

/**
 * Compile-time exhaustive partition of `AgentEdgeType`.
 *
 * `_UnclassifiedAgentEdgeTypes` catches values that exist in the generated
 * enum but appear in neither array (spec added a value, author forgot to
 * classify). `_StaleVocabTypes` catches values declared above that no longer
 * exist in the enum (spec removed a value, author forgot to drop it).
 *
 * Both must collapse to `never`; the `const _exhaustivenessCheck: true`
 * assertion fails to compile otherwise. The two `Record` types below give
 * each side a named partition table for readability.
 */
type _UnclassifiedAgentEdgeTypes = Exclude<
  AgentEdgeType,
  AgentEdgeVocabType | ExcludedAgentEdgeType
>;
type _StaleVocabTypes = Exclude<
  AgentEdgeVocabType | ExcludedAgentEdgeType,
  AgentEdgeType
>;
type _AgentEdgePartitionExhaustive = [
  _UnclassifiedAgentEdgeTypes,
  _StaleVocabTypes,
] extends [never, never]
  ? true
  : never;
const _exhaustivenessCheck: _AgentEdgePartitionExhaustive = true;
void _exhaustivenessCheck;

/**
 * Freely-authorable subset: all agent edge types except SUPERSEDES.
 * SUPERSEDES requires the supersede-transition protocol (status flip + edge)
 * and must not be authored via a raw `create_edge` call.
 *
 * Derived by filter so adding or retiring a type in `AGENT_EDGE_TYPES` is a
 * single-line edit that propagates here automatically.
 */
export const FREELY_AUTHORABLE_EDGE_TYPES = AGENT_EDGE_TYPES.filter(
  (t): t is Exclude<AgentEdgeVocabType, 'SUPERSEDES'> => t !== 'SUPERSEDES',
) as unknown as readonly [
  Exclude<AgentEdgeVocabType, 'SUPERSEDES'>,
  ...Exclude<AgentEdgeVocabType, 'SUPERSEDES'>[],
];

export const GET_EDGES_VISIBLE_EDGE_TYPES = [
  ...AGENT_EDGE_TYPES,
  ...WORKFLOW_EDGE_TYPES,
] as const satisfies readonly AgentEdgeType[];
