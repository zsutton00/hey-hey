import { ActivityCorrelationLinkType, EntityType } from 'src/generated';
import type {
  GraphRelationship,
  SearchResponse,
  SearchResult,
  SeedSearchResult,
  TraversalPathSegment,
} from 'src/generated/graphs';

type EntityRef = {
  entityId: string;
  entityType: EntityType;
};

export type LinkedEntityRef = EntityRef & {
  linkType: ActivityCorrelationLinkType;
  status?: string;
  updatedAt?: string;
};

type IndexedGraphResult = {
  entity: EntityRef;
  nodeId?: string;
  firstHop?: TraversalPathSegment;
  seedNodeId?: string;
  status?: string;
  updatedAt?: string;
};

const HIERARCHICAL_RELATIONSHIPS = new Set<string>([
  'HAS_INITIATIVE',
  'HAS_PLAN_STAGE',
  'HAS_PLAN_STEP',
  'HAS_TASK',
  'HAS_SESSION',
  'HAS_AGENT_SESSION',
  'HAS_PROMPT',
  'HAS_CATEGORY',
  'HAS_FACET',
  'HAS_KB_ENTRY',
  'HAS_DESIGN_DOC',
  'HAS_SUB_DOC',
  'HAS_MESSAGE',
  'TRACKS',
  'PLAN_TRACKS',
  'PLAN_STAGE_TRACKS',
  'PLAN_STEP_TRACKS',
]);

const SCOPE_RELATIONSHIPS = new Set<string>([
  'SCOPED_TO_PROJECT',
  'SCOPED_TO_ORG',
]);

export function buildGraphLinkedEntitiesBySeed(
  seeds: EntityRef[],
  response: SearchResponse,
): Map<string, LinkedEntityRef[]> {
  const linkedBySeed = new Map<string, LinkedEntityRef[]>();

  seeds.forEach((seed) => {
    const seedKey = toEntityKey(seed);
    linkedBySeed.set(seedKey, [
      {
        entityId: seed.entityId,
        entityType: seed.entityType,
        linkType: ActivityCorrelationLinkType.Self,
      },
    ]);
  });

  if (populateFromSeedGroups(seeds, response.seedResults, linkedBySeed)) {
    return linkedBySeed;
  }

  const indexedResults = indexGraphResults(response);
  const seedNodeIdsByKey = resolveSeedNodeIdsByKey(seeds, indexedResults);

  indexedResults.forEach((result) => {
    const seedKeys = resolveSeedKeysForResult(result, seedNodeIdsByKey);
    if (seedKeys.length === 0) {
      return;
    }

    seedKeys.forEach((seedKey) => {
      const linked = linkedBySeed.get(seedKey);
      if (!linked) {
        return;
      }

      const seed = seeds.find(
        (candidate) => toEntityKey(candidate) === seedKey,
      );
      if (!seed) {
        return;
      }

      const resultKey = toEntityKey(result.entity);
      if (resultKey === seedKey) {
        return;
      }

      pushLinkedEntity(linked, {
        entityId: result.entity.entityId,
        entityType: result.entity.entityType,
        linkType: mapFirstHopToLinkType(result.firstHop),
        status: result.status,
        updatedAt: result.updatedAt,
      });
    });
  });

  return linkedBySeed;
}

function populateFromSeedGroups(
  seeds: EntityRef[],
  seedResults: SearchResponse['seedResults'],
  linkedBySeed: Map<string, LinkedEntityRef[]>,
): boolean {
  const groups = seedResults ?? [];
  if (groups.length === 0) {
    return false;
  }

  const seedByKey = new Map<string, EntityRef>();
  seeds.forEach((seed) => {
    seedByKey.set(toEntityKey(seed), seed);
  });

  groups.forEach((group) => {
    const seed = resolveSeedFromGroup(group, seedByKey);
    if (!seed) {
      return;
    }

    const seedKey = toEntityKey(seed);
    const linked = linkedBySeed.get(seedKey);
    if (!linked) {
      return;
    }

    (group.results ?? []).forEach((result) => {
      const entity = toEntityRef(result);
      if (!entity || toEntityKey(entity) === seedKey) {
        return;
      }

      const firstHop = result.path?.segments?.[0];
      pushLinkedEntity(linked, {
        entityId: entity.entityId,
        entityType: entity.entityType,
        linkType: mapFirstHopToLinkType(firstHop),
        status: extractGraphResultStatus(result),
        updatedAt: extractGraphResultUpdatedAt(result),
      });
    });
  });

  return true;
}

function resolveSeedFromGroup(
  group: SeedSearchResult,
  seedByKey: Map<string, EntityRef>,
): EntityRef | undefined {
  const seedNodeId = group.seedNodeId;
  const results = group.results ?? [];

  const seedResultByNode = results.find(
    (result) => result.node?.id && result.node.id === seedNodeId,
  );
  const seedFromNode = seedResultByNode
    ? resolveSeedByResult(seedResultByNode, seedByKey)
    : undefined;
  if (seedFromNode) {
    return seedFromNode;
  }

  const seedResultByPath = results.find(
    (result) =>
      result.path?.depth === 0 || result.path?.nodeIds?.[0] === seedNodeId,
  );
  if (seedResultByPath) {
    return resolveSeedByResult(seedResultByPath, seedByKey);
  }

  return undefined;
}

function resolveSeedByResult(
  result: SearchResult,
  seedByKey: Map<string, EntityRef>,
): EntityRef | undefined {
  const entity = toEntityRef(result);
  if (!entity) {
    return undefined;
  }

  return seedByKey.get(toEntityKey(entity));
}

function indexGraphResults(response: SearchResponse): IndexedGraphResult[] {
  const indexed: IndexedGraphResult[] = [];
  const results = response.results ?? [];

  results.forEach((result) => {
    const entity = toEntityRef(result);
    if (!entity) {
      return;
    }

    const segments = result.path?.segments ?? [];
    const firstHop = segments.length > 0 ? segments[0] : undefined;
    const seedNodeId = result.path?.nodeIds?.[0];

    indexed.push({
      entity,
      nodeId: result.node?.id,
      firstHop,
      seedNodeId,
      status: extractGraphResultStatus(result),
      updatedAt: extractGraphResultUpdatedAt(result),
    });
  });

  return indexed;
}

function resolveSeedNodeIdsByKey(
  seeds: EntityRef[],
  indexedResults: IndexedGraphResult[],
): Map<string, Set<string>> {
  const seedNodeIdsByKey = new Map<string, Set<string>>();

  seeds.forEach((seed) => {
    seedNodeIdsByKey.set(toEntityKey(seed), new Set<string>());
  });

  indexedResults.forEach((result) => {
    const key = toEntityKey(result.entity);
    if (!seedNodeIdsByKey.has(key) || !result.nodeId) {
      return;
    }
    seedNodeIdsByKey.get(key)?.add(result.nodeId);
  });

  return seedNodeIdsByKey;
}

function resolveSeedKeysForResult(
  result: IndexedGraphResult,
  seedNodeIdsByKey: Map<string, Set<string>>,
): string[] {
  const matchingSeedKeys: string[] = [];

  seedNodeIdsByKey.forEach((seedNodeIds, seedKey) => {
    if (seedNodeIds.size === 0) {
      return;
    }

    if (result.seedNodeId && seedNodeIds.has(result.seedNodeId)) {
      matchingSeedKeys.push(seedKey);
      return;
    }

    const firstHop = result.firstHop;
    if (
      firstHop &&
      ((firstHop.sourceNodeId && seedNodeIds.has(firstHop.sourceNodeId)) ||
        (firstHop.targetNodeId && seedNodeIds.has(firstHop.targetNodeId)))
    ) {
      matchingSeedKeys.push(seedKey);
    }
  });

  return matchingSeedKeys;
}

function mapFirstHopToLinkType(
  firstHop?: TraversalPathSegment,
): ActivityCorrelationLinkType {
  if (!firstHop) {
    return ActivityCorrelationLinkType.Related;
  }

  const relationshipType = firstHop.type.toString().toUpperCase();
  const direction = firstHop.direction.toString().toUpperCase();

  if (relationshipType === 'DEPENDS_ON') {
    return direction === 'OUTGOING'
      ? ActivityCorrelationLinkType.DependsOn
      : ActivityCorrelationLinkType.Blocks;
  }

  if (relationshipType === 'BLOCKS') {
    return direction === 'OUTGOING'
      ? ActivityCorrelationLinkType.Blocks
      : ActivityCorrelationLinkType.DependsOn;
  }

  if (SCOPE_RELATIONSHIPS.has(relationshipType)) {
    return direction === 'OUTGOING'
      ? ActivityCorrelationLinkType.Parent
      : ActivityCorrelationLinkType.Child;
  }

  if (HIERARCHICAL_RELATIONSHIPS.has(relationshipType)) {
    return direction === 'OUTGOING'
      ? ActivityCorrelationLinkType.Child
      : ActivityCorrelationLinkType.Parent;
  }

  return ActivityCorrelationLinkType.Related;
}

function pushLinkedEntity(
  linkedEntities: LinkedEntityRef[],
  candidate: LinkedEntityRef,
): void {
  const duplicateIndex = linkedEntities.findIndex(
    (current) =>
      current.entityId === candidate.entityId &&
      current.entityType === candidate.entityType,
  );

  if (duplicateIndex === -1) {
    linkedEntities.push(candidate);
    return;
  }

  const existing = linkedEntities[duplicateIndex];
  if (!existing) {
    return;
  }

  const mergedCandidate: LinkedEntityRef = {
    ...candidate,
    status: candidate.status ?? existing.status,
    updatedAt: candidate.updatedAt ?? existing.updatedAt,
  };
  if (
    thisLinkPriority(candidate.linkType) > thisLinkPriority(existing.linkType)
  ) {
    linkedEntities[duplicateIndex] = mergedCandidate;
    return;
  }

  if (!existing.status && mergedCandidate.status) {
    linkedEntities[duplicateIndex] = {
      ...existing,
      status: mergedCandidate.status,
      updatedAt: mergedCandidate.updatedAt,
    };
    return;
  }

  if (!existing.updatedAt && mergedCandidate.updatedAt) {
    linkedEntities[duplicateIndex] = {
      ...existing,
      updatedAt: mergedCandidate.updatedAt,
    };
  }
}

function thisLinkPriority(linkType: ActivityCorrelationLinkType): number {
  switch (linkType) {
    case ActivityCorrelationLinkType.Self:
      return 100;
    case ActivityCorrelationLinkType.DependsOn:
    case ActivityCorrelationLinkType.Blocks:
      return 90;
    case ActivityCorrelationLinkType.Parent:
    case ActivityCorrelationLinkType.Child:
      return 80;
    case ActivityCorrelationLinkType.Sibling:
      return 70;
    case ActivityCorrelationLinkType.Related:
    default:
      return 10;
  }
}

function toApiEntityType(value?: string): EntityType | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase();
  const candidates = Object.values(EntityType) as string[];
  if (candidates.includes(normalized)) {
    return normalized as EntityType;
  }

  return undefined;
}

function toEntityRef(result: SearchResult): EntityRef | undefined {
  const entityId = result.entityId?.trim();
  const entityType = toApiEntityType(
    typeof result.entityType === 'string' ? result.entityType : undefined,
  );
  if (!entityId || !entityType) {
    return undefined;
  }

  return {
    entityId,
    entityType,
  };
}

function extractGraphResultStatus(result: SearchResult): string | undefined {
  const entity = toEntityRef(result);
  if (
    !entity ||
    (entity.entityType !== EntityType.Task &&
      entity.entityType !== EntityType.AgentSession)
  ) {
    return undefined;
  }

  const properties = result.node?.properties;
  if (!properties || typeof properties !== 'object') {
    return undefined;
  }

  const status = (properties as Record<string, unknown>)['status'];
  if (typeof status !== 'string') {
    return undefined;
  }

  const normalizedStatus = status.trim();
  return normalizedStatus.length > 0 ? normalizedStatus : undefined;
}

function extractGraphResultUpdatedAt(result: SearchResult): string | undefined {
  const updatedAt = result.node?.updatedAt;
  if (typeof updatedAt !== 'string') {
    return undefined;
  }

  const normalizedUpdatedAt = updatedAt.trim();
  return normalizedUpdatedAt.length > 0 ? normalizedUpdatedAt : undefined;
}

/**
 * Builds a map from entity ID to conversation entity ID using ABOUT
 * relationships in the graph response. When an entity has multiple
 * conversations, the most recently created one wins.
 */
export function buildConversationIdsByEntityId(
  response: SearchResponse,
): Map<string, string> {
  const nodeIdToEntityId = new Map<string, string>();
  const nodeIdToCreatedAt = new Map<string, string>();
  const conversationNodeIds = new Set<string>();

  const allResults = [
    ...(response.results ?? []),
    ...(response.seedResults ?? []).flatMap((sr) => sr.results ?? []),
  ];

  for (const result of allResults) {
    const nodeId = result.node?.id;
    const entityId = result.entityId?.trim();
    if (!nodeId || !entityId) {
      continue;
    }
    nodeIdToEntityId.set(nodeId, entityId);
    if (result.node?.createdAt) {
      nodeIdToCreatedAt.set(nodeId, result.node.createdAt);
    }
    if (
      result.entityType?.toString().toUpperCase() === EntityType.Conversation
    ) {
      conversationNodeIds.add(nodeId);
    }
  }

  if (conversationNodeIds.size === 0) {
    return new Map();
  }

  const allRelationships: GraphRelationship[] = [
    ...(response.relationships ?? []),
    ...(response.seedResults ?? []).flatMap((sr) => sr.relationships ?? []),
  ];

  const conversationsByEntityId = new Map<
    string,
    { conversationEntityId: string; createdAt: string }[]
  >();

  for (const rel of allRelationships) {
    if (rel.type.toString().toUpperCase() !== 'ABOUT') {
      continue;
    }
    const sourceNodeId = rel.sourceNodeId;
    const targetNodeId = rel.targetNodeId;
    if (
      !conversationNodeIds.has(sourceNodeId) ||
      !nodeIdToEntityId.has(targetNodeId)
    ) {
      continue;
    }

    const targetEntityId = nodeIdToEntityId.get(targetNodeId)!;
    const conversationEntityId = nodeIdToEntityId.get(sourceNodeId)!;
    const createdAt = nodeIdToCreatedAt.get(sourceNodeId) ?? '';

    const current = conversationsByEntityId.get(targetEntityId) ?? [];
    current.push({ conversationEntityId, createdAt });
    conversationsByEntityId.set(targetEntityId, current);
  }

  const result = new Map<string, string>();
  for (const [entityId, conversations] of conversationsByEntityId) {
    conversations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const newest = conversations[0];
    if (newest) {
      result.set(entityId, newest.conversationEntityId);
    }
  }

  return result;
}

function toEntityKey(entity: EntityRef): string {
  return `${entity.entityType}:${entity.entityId}`;
}
