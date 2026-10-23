import { RelationshipType } from '../../generated/graphs/model/relationshipType';
import type { RelationshipValue } from '../../generated/model/relationshipValue';

export type EdgeDirection = 'outbound' | 'inbound';

/**
 * Meta edge types, in the form the graph service emits them for relationship
 * surfaces. Mirrors the create_edge tool's allowed list, plus BLOCKS and
 * FULFILLED_BY. Workflow flow edges are intentionally not part of this set:
 * they are graph structure, not generic related-entity relationships.
 */
export const META_AGENT_EDGE_RELATIONSHIP_TYPES = [
  'DEPENDS_ON',
  'DERIVES_FROM',
  'SUPERSEDES',
  'CONTRADICTS',
  'RELATED_TO',
  'BLOCKS',
  'EVOLVES',
  'FULFILLED_BY',
] as const;

export type AgentEdgeRelationshipType =
  (typeof META_AGENT_EDGE_RELATIONSHIP_TYPES)[number];

export const FLOW_AGENT_EDGE_RELATIONSHIP_TYPES = [
  'STANDARD',
  'CONDITIONAL',
  'LOOP',
] as const;

export const AGENT_EDGE_RELATIONSHIP_TYPES = META_AGENT_EDGE_RELATIONSHIP_TYPES;

export type FlowAgentEdgeRelationshipType =
  (typeof FLOW_AGENT_EDGE_RELATIONSHIP_TYPES)[number];

export function isAgentEdgeRelationshipType(
  value: string,
): value is AgentEdgeRelationshipType {
  return (META_AGENT_EDGE_RELATIONSHIP_TYPES as readonly string[]).includes(
    value,
  );
}

export function isFlowAgentEdgeRelationshipType(
  value: string,
): value is FlowAgentEdgeRelationshipType {
  return (FLOW_AGENT_EDGE_RELATIONSHIP_TYPES as readonly string[]).includes(
    value,
  );
}

/**
 * Maps a system-graph edge to its canonical relationship value (from the
 * seed's perspective). Direction is encoded in the value rather than carried
 * separately. Returns null for structural-only edge types (HAS_TASK,
 * HAS_PLAN_STAGE, …) — those edges are used to discover related entities,
 * not to label the relationship itself.
 */
export function systemEdgeToRelationship(
  type: RelationshipType,
  direction: EdgeDirection,
): RelationshipValue | null {
  switch (type) {
    case RelationshipType.Mentions:
      return direction === 'outbound' ? 'mentions' : 'mentioned-by';
    case RelationshipType.CreatedVia:
      return 'created-via';
    case RelationshipType.Blocks:
      return direction === 'outbound' ? 'blocks' : 'blocked-by';
    default:
      return null;
  }
}

/**
 * Maps an agent-authored edge to its canonical relationship value (from the
 * seed's perspective). Direction is encoded in the value for asymmetric edge
 * types: SUPERSEDES, BLOCKS, DEPENDS_ON, DERIVES_FROM, and EVOLVES. Symmetric
 * types (CONTRADICTS, RELATED_TO, FULFILLED_BY) use the same label in both
 * directions. EVOLVES follows the same direction convention as SUPERSEDES:
 * outbound means the seed is the newer entity that evolves the target
 * ("evolved-by"), inbound means the seed is the predecessor being evolved
 * ("evolves").
 */
export function agentEdgeToRelationship(
  type: AgentEdgeRelationshipType,
  direction: EdgeDirection,
): RelationshipValue {
  switch (type) {
    case 'DEPENDS_ON':
      return direction === 'outbound' ? 'depends-on' : 'depended-on-by';
    case 'BLOCKS':
      return direction === 'outbound' ? 'blocks' : 'blocked-by';
    case 'SUPERSEDES':
      return direction === 'outbound' ? 'superseded-by' : 'supersedes';
    case 'DERIVES_FROM':
      return direction === 'outbound' ? 'derives-from' : 'derived-from-by';
    case 'EVOLVES':
      return direction === 'outbound' ? 'evolved-by' : 'evolves';
    case 'CONTRADICTS':
      return 'contradicts';
    case 'RELATED_TO':
    case 'FULFILLED_BY':
      return 'related-to';
  }
}
