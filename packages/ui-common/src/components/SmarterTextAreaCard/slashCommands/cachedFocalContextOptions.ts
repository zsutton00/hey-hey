import type {
  ContextRelatedEntityDto,
  FeatureHierarchyEntryDto,
  FullEntityContextDto,
} from "../../../api";
import type { QueryClient } from "@tanstack/react-query";
import { entityContextKeys } from "../../../data/collections/entityContext";
import type { SearchEntity } from "../types";
import type { SlashFocalEntityState } from "./types";

const toMentionEntityType = (entity: ContextRelatedEntityDto): string => {
  if (entity.entityType === "TASK") {
    if (entity.taskType?.toUpperCase() === "FEATURE") return "feature";
    return "task";
  }
  return entity.entityType.toLowerCase();
};

const isCompatibleWithRequestedTypes = (
  entity: ContextRelatedEntityDto,
  requestedTypes: readonly string[],
): boolean => {
  if (requestedTypes.length === 0) return true;

  return requestedTypes.some((requestedType) => {
    const normalizedRequest = requestedType.trim().toUpperCase();
    if (entity.entityType === "TASK") {
      if (normalizedRequest === "TASK") return true;
      return entity.taskType?.toUpperCase() === normalizedRequest;
    }
    return entity.entityType === normalizedRequest;
  });
};

export const normalizeCachedRelatedEntities = (
  relatedEntities: readonly ContextRelatedEntityDto[],
  requestedTypes: readonly string[],
): SearchEntity[] =>
  relatedEntities
    .filter((entity) => entity.status?.toUpperCase() !== "ARCHIVED")
    .filter((entity) => isCompatibleWithRequestedTypes(entity, requestedTypes))
    .map((entity) => ({
      id: entity.entityId,
      type: toMentionEntityType(entity),
      name: entity.displayName,
      status: entity.status,
      ...(entity.taskType ? { metadata: { taskType: entity.taskType } } : {}),
    }));

const normalizeCachedFeatureHierarchy = (
  featureHierarchy: readonly FeatureHierarchyEntryDto[],
  requestedTypes: readonly string[],
): SearchEntity[] => {
  const acceptsFeatures = requestedTypes.some(
    (requestedType) => requestedType.trim().toUpperCase() === "FEATURE",
  );
  if (!acceptsFeatures) return [];

  return featureHierarchy.map((feature) => ({
    id: feature.id,
    type: "feature",
    name: feature.name,
    description: feature.description ?? undefined,
  }));
};

export const readCachedFocalContext = (
  queryClient: QueryClient,
  organizationId: string | null,
  projectId: string | null,
  focalEntity: SlashFocalEntityState,
): FullEntityContextDto | null => {
  if (!organizationId || !projectId || focalEntity.kind === "none") return null;

  const cachedContext = queryClient
    .getQueriesData<FullEntityContextDto | null>({
      queryKey: entityContextKeys.entity(
        organizationId,
        projectId,
        focalEntity.entityType,
        focalEntity.entityId,
      ),
      predicate: ({ queryKey }) => {
        const flags = queryKey[5];
        return (
          typeof flags === "object" &&
          flags !== null &&
          "includeRelatedEntities" in flags &&
          flags.includeRelatedEntities === true
        );
      },
    })
    .map(([, data]) => data)
    .find(
      (data) =>
        data?.entityId === focalEntity.entityId &&
        data.entityType === focalEntity.entityType,
    );

  return cachedContext ?? null;
};

export const normalizeCachedFocalContextOptions = (
  cachedContext: FullEntityContextDto | null,
  requestedTypes: readonly string[],
): SearchEntity[] => {
  const likelyOptions = [
    ...normalizeCachedRelatedEntities(
      cachedContext?.relatedEntities ?? [],
      requestedTypes,
    ),
    ...normalizeCachedFeatureHierarchy(
      cachedContext?.featureHierarchy ?? [],
      requestedTypes,
    ),
  ];
  return Array.from(
    new Map(
      likelyOptions.map((entity) => [`${entity.type}:${entity.id}`, entity]),
    ).values(),
  );
};

export const readCachedFocalContextOptions = (
  queryClient: QueryClient,
  organizationId: string | null,
  projectId: string | null,
  focalEntity: SlashFocalEntityState,
  requestedTypes: readonly string[],
): SearchEntity[] =>
  normalizeCachedFocalContextOptions(
    readCachedFocalContext(queryClient, organizationId, projectId, focalEntity),
    requestedTypes,
  );
