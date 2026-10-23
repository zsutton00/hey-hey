import { useCallback, useEffect, useState } from "react";
import { EntityType as EntityTypeValue } from "../../api";
import type { EntityType, UnifiedGraphSearchResult } from "../../api";
import { platformClient } from "../../clients/serviceClients";

export type TopologyEntityGraphDirection =
  | "INCOMING"
  | "OUTGOING"
  | "UNDIRECTED";

export interface TopologyEntityGraphNode {
  id: string;
  entityId: string;
  entityType: EntityType;
  label: string;
  title?: string;
  summary?: string;
  score?: number;
  pathDepth: number;
  pathCount?: number;
  isSeed: boolean;
}

export interface TopologyEntityGraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  direction: TopologyEntityGraphDirection;
  weight?: number;
}

export interface UseTopologyEntityGraphOptions {
  depth?: number;
  enabled?: boolean;
}

export interface UseTopologyEntityGraphReturn {
  nodes: TopologyEntityGraphNode[];
  edges: TopologyEntityGraphEdge[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function readNumber(
  record: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function toNodeId(entityType: EntityType, entityId: string): string {
  return `entity:${entityType}:${entityId}`;
}

function toEntityType(value: string | undefined): EntityType | undefined {
  if (!value) {
    return undefined;
  }

  const validEntityTypes = Object.values(EntityTypeValue) as string[];
  if (!validEntityTypes.includes(value)) {
    return undefined;
  }

  return value as EntityType;
}

function normalizeNodeLabel(
  result: UnifiedGraphSearchResult,
  entityId: string
): string {
  if (!isObjectRecord(result.node)) {
    return entityId;
  }

  const properties = isObjectRecord(result.node.properties)
    ? result.node.properties
    : null;

  return (
    readString(result.node, [
      "title",
      "name",
      "summary",
      "label",
      "entityId",
    ]) ??
    (properties
      ? readString(properties, ["title", "name", "summary", "label"])
      : undefined) ??
    entityId
  );
}

function normalizeNodeSummary(
  result: UnifiedGraphSearchResult
): string | undefined {
  if (!isObjectRecord(result.node)) {
    return undefined;
  }

  return readString(result.node, ["summary", "description", "content"]);
}

function normalizeNodeTitle(
  result: UnifiedGraphSearchResult
): string | undefined {
  if (!isObjectRecord(result.node)) {
    return undefined;
  }

  const properties = isObjectRecord(result.node.properties)
    ? result.node.properties
    : null;

  return (
    readString(result.node, ["title", "name"]) ??
    (properties ? readString(properties, ["title", "name"]) : undefined)
  );
}

function normalizeEdge(
  relationship: Record<string, unknown>,
  entityTypeByEntityId: Map<string, EntityType>,
  nodeIds: Set<string>
): TopologyEntityGraphEdge | null {
  const sourceRaw = readString(relationship, [
    "sourceEntityId",
    "sourceId",
    "sourceNodeId",
    "from",
    "source",
  ]);
  const sourceEntityTypeValue = readString(relationship, [
    "sourceEntityType",
    "sourceType",
  ]);
  const targetRaw = readString(relationship, [
    "targetEntityId",
    "targetId",
    "targetNodeId",
    "to",
    "target",
  ]);
  const targetEntityTypeValue = readString(relationship, [
    "targetEntityType",
    "targetType",
  ]);

  if (!sourceRaw || !targetRaw) {
    return null;
  }

  const resolveNodeId = (
    rawValue: string,
    explicitTypeValue: string | undefined
  ): string | null => {
    if (nodeIds.has(rawValue)) {
      return rawValue;
    }

    const explicitType = toEntityType(explicitTypeValue);
    if (explicitType) {
      return toNodeId(explicitType, rawValue);
    }

    const inferredType = entityTypeByEntityId.get(rawValue);
    if (inferredType) {
      return toNodeId(inferredType, rawValue);
    }

    const parts = rawValue.split(":");
    if (parts.length === 3 && parts[0] === "entity") {
      const parsedType = toEntityType(parts[1]);
      if (parsedType) {
        return toNodeId(parsedType, parts[2]);
      }
    }

    return null;
  };

  const source = resolveNodeId(sourceRaw, sourceEntityTypeValue);
  const target = resolveNodeId(targetRaw, targetEntityTypeValue);
  if (!source || !target) {
    return null;
  }

  const relationshipType =
    readString(relationship, ["type", "relationshipType", "relation"]) ??
    "RELATED";

  const rawDirection = readString(relationship, ["direction"]);
  const direction: TopologyEntityGraphDirection =
    rawDirection === "INCOMING" || rawDirection === "OUTGOING"
      ? rawDirection
      : "UNDIRECTED";

  const weight = readNumber(relationship, ["weight", "score"]);

  return {
    id: `edge:${source}:${target}:${relationshipType}`,
    source,
    target,
    relationshipType,
    direction,
    weight,
  };
}

export function useTopologyEntityGraph(
  organizationId: string | undefined,
  projectId: string | undefined,
  entityId: string | undefined,
  options: UseTopologyEntityGraphOptions = {}
): UseTopologyEntityGraphReturn {
  const { depth = 1, enabled = true } = options;

  const [nodes, setNodes] = useState<TopologyEntityGraphNode[]>([]);
  const [edges, setEdges] = useState<TopologyEntityGraphEdge[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isFetched, setIsFetched] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const shouldFetch = enabled && !!organizationId && !!projectId && !!entityId;

  const fetchGraph = useCallback(async () => {
    if (!shouldFetch || !organizationId || !projectId || !entityId) {
      setNodes([]);
      setEdges([]);
      setTotalElements(0);
      setTotalPages(0);
      setPage(0);
      setSize(0);
      setError(null);
      setIsLoading(false);
      setIsFetching(false);
      setIsFetched(false);
      return;
    }

    setIsLoading(!isFetched);
    setIsFetching(true);
    setError(null);

    try {
      const response = await platformClient.getTopologyEntityGraph({
        organizationId: organizationId,
        projectId: projectId,
        entityId: entityId,
        depth: depth,
      });
      const graph = response.data?.data;
      const results = graph?.results ?? [];
      const relationships = graph?.relationships ?? [];

      const normalizedNodes = results
        .map((result): TopologyEntityGraphNode | null => {
          if (!result.entityId || !result.entityType) {
            return null;
          }

          const resultDepth = result.path?.depth ?? 1;

          return {
            id: toNodeId(result.entityType, result.entityId),
            entityId: result.entityId,
            entityType: result.entityType,
            label: normalizeNodeLabel(result, result.entityId),
            title: normalizeNodeTitle(result),
            summary: normalizeNodeSummary(result),
            score: result.score,
            pathDepth: resultDepth,
            pathCount: result.pathCount,
            isSeed: result.entityId === entityId,
          };
        })
        .filter((node): node is TopologyEntityGraphNode => node !== null);

      const entityTypeByEntityId = new Map<string, EntityType>();
      const nodeIds = new Set<string>();
      normalizedNodes.forEach((node) => {
        entityTypeByEntityId.set(node.entityId, node.entityType);
        nodeIds.add(node.id);
      });

      const normalizedEdges = relationships
        .map((relationship) =>
          isObjectRecord(relationship)
            ? normalizeEdge(relationship, entityTypeByEntityId, nodeIds)
            : null
        )
        .filter((edge): edge is TopologyEntityGraphEdge => edge !== null);

      setNodes(normalizedNodes);
      setEdges(normalizedEdges);
      setTotalElements(graph?.totalElements ?? normalizedNodes.length);
      setTotalPages(graph?.totalPages ?? 1);
      setPage(graph?.page ?? 0);
      setSize(graph?.size ?? normalizedNodes.length);
      setIsFetched(true);
    } catch (requestError) {
      const normalizedError =
        requestError instanceof Error
          ? requestError
          : new Error("Failed to fetch topology entity graph.");
      setError(normalizedError);
      setNodes([]);
      setEdges([]);
      setTotalElements(0);
      setTotalPages(0);
      setPage(0);
      setSize(0);
      setIsFetched(true);
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [depth, entityId, isFetched, organizationId, projectId, shouldFetch]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  const refetch = useCallback(async () => {
    await fetchGraph();
  }, [fetchGraph]);

  return {
    nodes,
    edges,
    totalElements,
    totalPages,
    page,
    size,
    isLoading,
    isFetching,
    isFetched,
    isReady: isFetched && !error,
    error,
    refetch,
  };
}
