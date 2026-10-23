import { EntityType, ActivityCorrelationLinkType } from 'src/generated';
import {
  GraphRelationship,
  RelationshipType as GraphRelationshipType,
  SearchResponse,
  SearchResult,
  SeedSearchResult,
} from 'src/generated/graphs';
import {
  EntityRef,
  RecentSeedPage,
  toEntityKey,
} from './activity-correlation.types';

export function buildGraphTitleHints(
  response: SearchResponse,
): Map<string, string> {
  const titles = new Map<string, string>();
  const entitiesByNodeId = new Map<string, EntityRef>();

  collectGraphSearchResults(response).forEach((result) => {
    const entity = toEntityRefFromGraphResult(result);
    if (!entity) {
      return;
    }

    if (result.node?.id) {
      entitiesByNodeId.set(result.node.id, entity);
    }

    putEntityTitle(titles, entity, extractGraphSearchResultTitle(result));
  });

  collectGraphRelationships(response).forEach((relationship) => {
  });

  return titles;
}

export function buildGraphStatusHints(
  response: SearchResponse,
): Map<string, string> {
  const statuses = new Map<string, string>();

  collectGraphSearchResults(response).forEach((result) => {
    const entity = toEntityRefFromGraphResult(result);
    if (
      !entity ||
      (entity.entityType !== EntityType.Task &&
        entity.entityType !== EntityType.AgentSession)
    ) {
      return;
    }

    const status = extractGraphSearchResultStatus(result);
    if (status) {
      statuses.set(toEntityKey(entity), status);
    }
  });

  return statuses;
}

export function buildGraphUpdatedAtHints(
  response: SearchResponse,
): Map<string, string> {
  const updatedAts = new Map<string, string>();

  collectGraphSearchResults(response).forEach((result) => {
    const entity = toEntityRefFromGraphResult(result);
    const updatedAt = extractGraphSearchResultUpdatedAt(result);
    if (entity && updatedAt) {
      updatedAts.set(toEntityKey(entity), updatedAt);
    }
  });

  return updatedAts;
}

export function collectGraphSearchResults(
  response: SearchResponse,
): SearchResult[] {
  const results = [...(response.results ?? [])];
  (response.seedResults ?? []).forEach((seedGroup) => {
    results.push(...(seedGroup.results ?? []));
  });
  return results;
}

export function collectGraphRelationships(
  response: SearchResponse,
): GraphRelationship[] {
  const relationships = [...(response.relationships ?? [])];
  (response.seedResults ?? []).forEach((seedGroup) => {
    relationships.push(...(seedGroup.relationships ?? []));
  });
  return relationships;
}

export function toEntityRefFromGraphResult(
  result: SearchResult,
): EntityRef | undefined {
  const entityId = result.entityId?.trim();
  const entityType = result.entityType?.toString().trim().toUpperCase();
  if (!entityId || !entityType) {
    return undefined;
  }

  if (!(Object.values(EntityType) as string[]).includes(entityType)) {
    return undefined;
  }

  return {
    entityId,
    entityType: entityType as EntityType,
  };
}

export function indexSeedResultsByKey(
  seedPage: RecentSeedPage,
  response: SearchResponse,
): Map<string, SeedSearchResult> {
  const seedByKey = new Map(
    seedPage.seeds.map((seed) => [toEntityKey(seed), seed]),
  );
  const indexed = new Map<string, SeedSearchResult>();

  (response.seedResults ?? []).forEach((group) => {
    const seed = resolveSeedFromGroup(group, seedByKey);
    if (seed) {
      indexed.set(toEntityKey(seed), group);
    }
  });

  return indexed;
}

export function requireEntityTitle(
  titleMap: Map<string, string>,
  entity: EntityRef,
): string {
  const title = titleMap.get(toEntityKey(entity));
  if (!title) {
    throw new Error(
      `Missing required activity correlation title for ${toEntityKey(entity)}`,
    );
  }

  return title;
}

function resolveSeedFromGroup(
  group: SeedSearchResult,
  seedByKey: Map<string, EntityRef>,
): EntityRef | undefined {
  const seedNodeId = group.seedNodeId;
  const results = group.results ?? [];

  const byNodeId = results.find(
    (result) => result.node?.id && result.node.id === seedNodeId,
  );
  const fromNodeId = byNodeId
    ? resolveSeedByResult(byNodeId, seedByKey)
    : undefined;
  if (fromNodeId) {
    return fromNodeId;
  }

  const byDepth = results.find(
    (result) =>
      result.path?.depth === 0 || result.path?.nodeIds?.[0] === seedNodeId,
  );
  return byDepth ? resolveSeedByResult(byDepth, seedByKey) : undefined;
}

function resolveSeedByResult(
  result: SearchResult,
  seedByKey: Map<string, EntityRef>,
): EntityRef | undefined {
  const entity = toEntityRefFromGraphResult(result);
  return entity ? seedByKey.get(toEntityKey(entity)) : undefined;
}

function extractGraphSearchResultTitle(
  result: SearchResult,
): string | undefined {
  const properties = result.node?.properties;
  if (!properties || typeof properties !== 'object') {
    return undefined;
  }

  const record = properties as Record<string, unknown>;
  const candidates = [
    record['title'],
    record['name'],
    record['entityName'],
    record['entity_name'],
    record['displayName'],
    record['display_name'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = normalizeTitle(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return extractObjectTitle(record);
}

function extractGraphSearchResultStatus(
  result: SearchResult,
): string | undefined {
  const properties = result.node?.properties;
  if (!properties || typeof properties !== 'object') {
    return undefined;
  }

  const status = (properties as Record<string, unknown>)['status'];
  return typeof status === 'string' && status.trim().length > 0
    ? status.trim()
    : undefined;
}

export function extractGraphSearchResultAgentSessionType(
  result: SearchResult,
): string | undefined {
  const properties = result.node?.properties;
  if (!properties || typeof properties !== 'object') {
    return undefined;
  }

  const agentSessionType = (properties as Record<string, unknown>)['type'];
  return typeof agentSessionType === 'string' &&
    agentSessionType.trim().length > 0
    ? agentSessionType.trim()
    : undefined;
}

function extractGraphSearchResultUpdatedAt(
  result: SearchResult,
): string | undefined {
  const updatedAt = result.node?.updatedAt;
  return typeof updatedAt === 'string' && updatedAt.trim().length > 0
    ? updatedAt.trim()
    : undefined;
}

function putEntityTitle(
  titles: Map<string, string>,
  entity: EntityRef,
  title: string | undefined,
): void {
  const normalized = normalizeTitle(title);
  if (normalized && !titles.has(toEntityKey(entity))) {
    titles.set(toEntityKey(entity), normalized);
  }
}

function normalizeTitle(title?: string | null): string | undefined {
  if (typeof title !== 'string') {
    return undefined;
  }

  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractObjectTitle(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct =
    typeof record['title'] === 'string'
      ? normalizeTitle(record['title'])
      : undefined;
  if (direct) {
    return direct;
  }

  const nested = record['data'];
  if (!nested || typeof nested !== 'object') {
    return undefined;
  }

  return typeof (nested as Record<string, unknown>)['title'] === 'string'
    ? normalizeTitle((nested as Record<string, unknown>)['title'] as string)
    : undefined;
}

export function buildAgentSessionTypeMap(
  response: SearchResponse,
): Map<string, string> {
  const typeMap = new Map<string, string>();

  collectGraphSearchResults(response).forEach((result) => {
    const entityType = result.entityType?.toString().trim().toUpperCase();
    if (entityType !== EntityType.AgentSession) {
      return;
    }

    const agentSessionType = extractGraphSearchResultAgentSessionType(result);
    const entityId = result.entityId?.trim();
    if (entityId && agentSessionType) {
      typeMap.set(entityId, agentSessionType);
    }
  });

  return typeMap;
}

export const RECENT_ALLOWED_ENTITY_TYPES: readonly EntityType[] = [
  EntityType.AgentSession,
  EntityType.Conversation,
  EntityType.Task,
  EntityType.Initiative,
  EntityType.DesignDoc,
  EntityType.Report,
  EntityType.Service,
  EntityType.Project,
];

export function isRecentAllowedEntityType(entityType: EntityType): boolean {
  return RECENT_ALLOWED_ENTITY_TYPES.includes(entityType);
}

export function invertLinkType(
  linkType: ActivityCorrelationLinkType,
): ActivityCorrelationLinkType {
  switch (linkType) {
    case ActivityCorrelationLinkType.Parent:
      return ActivityCorrelationLinkType.Child;
    case ActivityCorrelationLinkType.Child:
      return ActivityCorrelationLinkType.Parent;
    case ActivityCorrelationLinkType.DependsOn:
      return ActivityCorrelationLinkType.Blocks;
    case ActivityCorrelationLinkType.Blocks:
      return ActivityCorrelationLinkType.DependsOn;
    default:
      return linkType;
  }
}
