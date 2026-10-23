import { v5 as uuidv5 } from 'uuid';
import { AgentEdgeCategory } from '../../generated/graphs/model/agentEdgeCategory';
import type { CreateAgentEdgeDto } from '../../generated/graphs/model/createAgentEdgeDto';
import { AgentEdgeEndpointEntityType } from '../../generated/graphs/model/agentEdgeEndpointEntityType';
import type { FeatureRequirementStoredCitation } from '../../generated';
import { inspectFeatureRequirementsSection } from './feature-requirements-reader';

/**
 * Fixed namespace for requirements-derived edge identities. The computed id is
 * the only provenance marker: a declared or hand-made DEPENDS_ON between the
 * same pair has a different id, so citation removal can never delete it.
 */
export const REQUIREMENT_CITATION_EDGE_NAMESPACE =
  '8694b7ed-b3cc-5c62-8439-b9c7cbe4eb67';

export const REQUIREMENT_CITATION_EDGE_TYPE = 'DEPENDS_ON' as const;

export const REQUIREMENT_CITATION_EDGE_REASONING =
  'Cited by a feature requirement.';

export type RequirementCitationTarget = {
  entityId: string;
  entityType: AgentEdgeEndpointEntityType;
};

export type RequirementCitationEdge = RequirementCitationTarget & {
  id: string;
  featureId: string;
};

export type RequirementCitationEdgeDiff = {
  creates: RequirementCitationEdge[];
  deletes: RequirementCitationEdge[];
};

export function requirementCitationEdgeId(
  featureId: string,
  citedEntityId: string,
): string {
  return uuidv5(
    `${featureId}:${citedEntityId}`,
    REQUIREMENT_CITATION_EDGE_NAMESPACE,
  );
}

// Matches the registry mapping used when citations are authored: every cited
// kind other than a design doc (TASK, PLAN, CONTRACT, FEATURE) is a task row.
function citationEndpointType(
  citation: FeatureRequirementStoredCitation,
): AgentEdgeEndpointEntityType {
  return citation.entityType === 'DESIGN_DOC'
    ? AgentEdgeEndpointEntityType.DesignDoc
    : AgentEdgeEndpointEntityType.Task;
}

/**
 * Collect every entity cited in the designedBy, fulfilledBy and contracts
 * slots of a stored requirements section, keyed by endpoint type and id.
 * Titles, slots and records are ignored so moving a citation is a no-op.
 * Absent and empty sections cite nothing; malformed content throws.
 */
export function collectRequirementCitationTargets(
  content: unknown,
): Map<string, RequirementCitationTarget> {
  const result = inspectFeatureRequirementsSection(content);
  if (result.state === 'malformed') throw result.error;
  const targets = new Map<string, RequirementCitationTarget>();
  for (const record of result.section?.records ?? []) {
    for (const citation of [
      ...record.designedBy,
      ...record.fulfilledBy,
      ...record.contracts,
    ]) {
      const entityType = citationEndpointType(citation);
      targets.set(`${entityType}:${citation.entityId}`, {
        entityId: citation.entityId,
        entityType,
      });
    }
  }
  return targets;
}

function toEdge(
  featureId: string,
  target: RequirementCitationTarget,
): RequirementCitationEdge {
  return {
    id: requirementCitationEdgeId(featureId, target.entityId),
    featureId,
    entityId: target.entityId,
    entityType: target.entityType,
  };
}

/**
 * Create only newly cited entities and delete only entities no longer cited.
 * Pass `undefined` as prior content for a create or an explicit backfill.
 */
export function diffRequirementCitationEdges(
  featureId: string,
  priorContent: unknown,
  nextContent: unknown,
): RequirementCitationEdgeDiff {
  const prior = collectRequirementCitationTargets(priorContent);
  const next = collectRequirementCitationTargets(nextContent);
  return {
    creates: [...next]
      .filter(([key]) => !prior.has(key))
      .map(([, target]) => toEdge(featureId, target)),
    deletes: [...prior]
      .filter(([key]) => !next.has(key))
      .map(([, target]) => toEdge(featureId, target)),
  };
}

/** Canonical citation semantics shared by enactment and repair. */
export function toRequirementCitationEdgeDto(
  edge: RequirementCitationEdge,
): CreateAgentEdgeDto {
  return {
    id: edge.id,
    sourceNodeId: edge.featureId,
    sourceEntityType: AgentEdgeEndpointEntityType.Task,
    targetNodeId: edge.entityId,
    targetEntityType: edge.entityType,
    type: REQUIREMENT_CITATION_EDGE_TYPE,
    category: AgentEdgeCategory.Meta,
    reasoning: REQUIREMENT_CITATION_EDGE_REASONING,
  } satisfies CreateAgentEdgeDto;
}

export function hasRequirementCitationEdgeChanges(
  diff: RequirementCitationEdgeDiff,
): boolean {
  return diff.creates.length > 0 || diff.deletes.length > 0;
}
