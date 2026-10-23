import { useCallback, useMemo } from "react";
import type {
  TopologyEntitySummaryDto,
  TopologySubfacetStatus,
  TopologySummaryCategory,
  EntityType,
} from "../../api";
import type { DataCollectionHookReturn } from "../core/types";
import { useTopologyCategorySummaries } from "./useTopologyCategorySummaries";
import { useTopologyEntitySummaries } from "./useTopologyEntitySummaries";
import { useTopologySubfacets } from "./useTopologySubfacets";

export type TopologyGraphNodeType = "category" | "subfacet" | "entity";

export interface TopologyGraphNode {
  id: string;
  type: TopologyGraphNodeType;
  label: string;
  category?: TopologySummaryCategory;
  summary?: string;
  status?: TopologySubfacetStatus;
  entityType?: EntityType;
  entityId?: string;
  subfacetIds?: string[];
  updatedAt?: string;
}

export type TopologyGraphEdgeType = "category-subfacet" | "subfacet-entity";

export interface TopologyGraphEdge {
  id: string;
  source: string;
  target: string;
  type: TopologyGraphEdgeType;
}

export interface UseTopologyGraphOptions {
  category?: TopologySummaryCategory;
  status?: TopologySubfacetStatus;
  subfacetId?: string[];
  since?: string;
  limitPerSubfacet?: number;
  enabled?: boolean;
}

export interface UseTopologyGraphReturn {
  nodes: TopologyGraphNode[];
  edges: TopologyGraphEdge[];
  entitySummaries: TopologyEntitySummaryDto[];
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: DataCollectionHookReturn<unknown>["error"];
  refetch: () => Promise<void>;
}

export function useTopologyGraph(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseTopologyGraphOptions = {}
): UseTopologyGraphReturn {
  const {
    category,
    status,
    subfacetId,
    since,
    limitPerSubfacet,
    enabled = true,
  } = options;

  const categorySummariesQuery = useTopologyCategorySummaries(
    organizationId,
    projectId,
    {
      category,
      enabled,
    }
  );

  const subfacetsQuery = useTopologySubfacets(organizationId, projectId, {
    category,
    status,
    enabled,
  });

  const entitySummariesQuery = useTopologyEntitySummaries(
    organizationId,
    projectId,
    {
      category,
      subfacetId,
      since,
      limitPerSubfacet,
      enabled,
    }
  );

  const nodes = useMemo(() => {
    const categoryMap = new Map<TopologySummaryCategory, string>();
    const categorySummaries = categorySummariesQuery.summaries;
    categorySummaries.forEach((summary) => {
      categoryMap.set(summary.category, summary.summary);
    });

    const categorySet = new Set<TopologySummaryCategory>();
    categorySummaries.forEach((summary) => {
      categorySet.add(summary.category);
    });

    subfacetsQuery.subfacets.forEach((subfacet) => {
      categorySet.add(subfacet.category);
    });

    entitySummariesQuery.summaries.forEach((summary) => {
      categorySet.add(summary.category);
    });

    const categoryNodes: TopologyGraphNode[] = Array.from(categorySet).map(
      (value) => ({
        id: `category:${value}`,
        type: "category",
        label: value,
        category: value,
        summary: categoryMap.get(value),
      })
    );

    const subfacetNodes: TopologyGraphNode[] = subfacetsQuery.subfacets.map(
      (subfacet) => ({
        id: `subfacet:${subfacet.id}`,
        type: "subfacet",
        label: subfacet.name,
        category: subfacet.category,
        summary: subfacet.summary ?? undefined,
        status: subfacet.status,
        subfacetIds: [subfacet.id],
        updatedAt: subfacet.updatedAt,
      })
    );

    const entityNodes: TopologyGraphNode[] = entitySummariesQuery.summaries.map(
      (summary) => ({
        id: `entity:${summary.entityType}:${summary.entityId}`,
        type: "entity",
        label: summary.summary || summary.entityId,
        summary: summary.summary,
        category: summary.category,
        entityType: summary.entityType,
        entityId: summary.entityId,
        subfacetIds: summary.subfacets.map((subfacet) => subfacet.id),
        updatedAt: summary.updatedAt,
      })
    );

    return [...categoryNodes, ...subfacetNodes, ...entityNodes];
  }, [
    categorySummariesQuery.summaries,
    subfacetsQuery.subfacets,
    entitySummariesQuery.summaries,
  ]);

  const edges = useMemo(() => {
    const edgesResult: TopologyGraphEdge[] = [];

    subfacetsQuery.subfacets.forEach((subfacet) => {
      const source = `category:${subfacet.category}`;
      const target = `subfacet:${subfacet.id}`;
      edgesResult.push({
        id: `edge:${source}:${target}`,
        source,
        target,
        type: "category-subfacet",
      });
    });

    entitySummariesQuery.summaries.forEach((summary) => {
      const target = `entity:${summary.entityType}:${summary.entityId}`;
      summary.subfacets.forEach((subfacet) => {
        const source = `subfacet:${subfacet.id}`;
        edgesResult.push({
          id: `edge:${source}:${target}`,
          source,
          target,
          type: "subfacet-entity",
        });
      });
    });

    return edgesResult;
  }, [subfacetsQuery.subfacets, entitySummariesQuery.summaries]);

  const refetch = useCallback(async () => {
    await Promise.all([
      categorySummariesQuery.refetch(),
      subfacetsQuery.refetch(),
      entitySummariesQuery.refetch(),
    ]);
  }, [categorySummariesQuery, subfacetsQuery, entitySummariesQuery]);

  const error =
    categorySummariesQuery.error ??
    subfacetsQuery.error ??
    entitySummariesQuery.error ??
    null;

  const isLoading =
    categorySummariesQuery.isLoading ||
    subfacetsQuery.isLoading ||
    entitySummariesQuery.isLoading;

  const isFetching =
    categorySummariesQuery.isFetching ||
    subfacetsQuery.isFetching ||
    entitySummariesQuery.isFetching;

  const isFetched =
    categorySummariesQuery.isFetched &&
    subfacetsQuery.isFetched &&
    entitySummariesQuery.isFetched;

  const isReady = isFetched && !error;

  return {
    nodes,
    edges,
    entitySummaries: entitySummariesQuery.summaries,
    isLoading,
    isFetching,
    isFetched,
    isReady,
    error,
    refetch,
  };
}
