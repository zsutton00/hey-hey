import type { AgentEdge, GraphRelationship } from 'src/generated/graphs';
import { AgentEdgeCategory } from 'src/generated/graphs/model/agentEdgeCategory';
import { AgentEdgeDirection } from 'src/generated/graphs/model/agentEdgeDirection';
import { RelationshipType } from 'src/generated/graphs/model/relationshipType';

/**
 * The per-type Neo4j labels the Graph service emits for agent-authored edges.
 * Use these labels (plus `AGENT_LINKED` for transition) in traversal
 * `relationshipTypes` at every agent-edge read site so the API no longer
 * depends solely on the legacy `AGENT_LINKED` label.
 */
export const AGENT_EDGE_LABELS = [
  RelationshipType.DependsOn,
  RelationshipType.DerivesFrom,
  RelationshipType.Supersedes,
  RelationshipType.Contradicts,
  RelationshipType.RelatedTo,
  RelationshipType.Evolves,
] as const;

function readEnumProp<T extends string>(
  props: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
): T | undefined {
  const value = props[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    throw new Error(`Invalid graph relationship ${key}: ${String(value)}`);
  }
  return value as T;
}

function readNullableEnumProp<T extends string>(
  props: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
): T | null | undefined {
  const value = props[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    throw new Error(`Invalid graph relationship ${key}: ${String(value)}`);
  }
  return value as T;
}

/**
 * Maps a `GraphRelationship` returned by `searchGraph` into an `AgentEdge`.
 *
 * For per-type-labelled edges (Graph service emits the semantic type as the
 * Neo4j label, e.g. `RELATED_TO`), the type comes from `relationship.type`.
 * For not-yet-migrated `AGENT_LINKED` edges the semantic subtype is stored
 * as `props.type` and used as a fallback. Relationships missing required
 * properties (`id`, `reasoning`) return null so the caller can drop them. The
 * Graph service's virtual `PROPOSED_TOGETHER` relationships are the
 * exception: they carry their ID at the relationship level and identify
 * their system provenance instead of storing agent reasoning, so this mapper
 * supplies the canonical co-authorship explanation for that read-only edge.
 * `createdBySessionId` is optional because user/system-originated edge
 * contracts do not always carry an agent session.
 */
export function graphRelationshipToAgentEdge(
  relationship: GraphRelationship,
): AgentEdge | null {
  const props = (relationship.properties ?? {}) as Record<string, unknown>;
  const id =
    typeof props.id === 'string'
      ? props.id
      : typeof relationship.id === 'string'
        ? relationship.id
        : null;
  // Per-type-labelled edges carry the semantic type as the relationship label.
  // Legacy AGENT_LINKED edges store it in props.type.
  const type: string | null =
    relationship.type !== RelationshipType.AgentLinked
      ? relationship.type
      : typeof props.type === 'string'
        ? props.type
        : null;
  const reasoning =
    typeof props.reasoning === 'string'
      ? props.reasoning
      : relationship.type === RelationshipType.ProposedTogether &&
          props.source === 'system'
        ? 'Entities were co-authored by the same approved proposal'
        : null;
  const createdBySessionId =
    typeof props.createdBySessionId === 'string'
      ? props.createdBySessionId
      : null;

  if (!id || !type || reasoning === null) {
    return null;
  }

  const lastModifiedBySessionId =
    typeof props.lastModifiedBySessionId === 'string'
      ? props.lastModifiedBySessionId
      : null;
  const category =
    relationship.category ??
    readEnumProp(props, 'category', Object.values(AgentEdgeCategory));
  const direction =
    relationship.direction ??
    readNullableEnumProp(props, 'direction', Object.values(AgentEdgeDirection));
  const predicate =
    relationship.predicate ??
    (typeof props.predicate === 'string' ? props.predicate : undefined);

  return {
    id,
    sourceNodeId: relationship.sourceNodeId,
    targetNodeId: relationship.targetNodeId,
    type: type as AgentEdge['type'],
    ...(category !== undefined ? { category } : {}),
    ...(direction !== undefined ? { direction } : {}),
    ...(predicate !== undefined ? { predicate } : {}),
    reasoning,
    createdBySessionId,
    lastModifiedBySessionId,
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
  };
}
