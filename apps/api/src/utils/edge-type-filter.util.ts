import { BadRequestException } from '@nestjs/common';
import { AgentEdgeType } from '@hey-hey/contracts/api/models';
import { RelationshipType } from 'src/generated/graphs/model/relationshipType';

/**
 * Parses an edge-type filter from a read request (array or comma-separated
 * string) into the Graph relationship types it names. Returns undefined when
 * the filter is omitted; rejects an empty filter or unknown labels.
 */
export function normalizeEdgeTypeFilter(
  edgeTypes?: string | string[],
): RelationshipType[] | undefined {
  if (edgeTypes === undefined) {
    return undefined;
  }

  const values = (Array.isArray(edgeTypes) ? edgeTypes : [edgeTypes])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new BadRequestException(
      'edgeTypes must contain at least one AgentEdgeType value',
    );
  }

  const allowedAgentTypes = new Set<string>(Object.values(AgentEdgeType));
  const allowedRelationshipTypes = new Map<string, RelationshipType>(
    Object.values(RelationshipType).map((value) => [value, value]),
  );
  const requestedTypes: RelationshipType[] = [];
  for (const value of values) {
    if (!allowedAgentTypes.has(value)) {
      throw new BadRequestException(
        `edgeTypes must be one of: ${Object.values(AgentEdgeType).join(', ')}`,
      );
    }
    const relationshipType = allowedRelationshipTypes.get(value);
    if (!relationshipType) {
      throw new BadRequestException(
        `edgeTypes value ${value} is not supported by graph traversal`,
      );
    }
    requestedTypes.push(relationshipType);
  }

  return [...new Set(requestedTypes)];
}
