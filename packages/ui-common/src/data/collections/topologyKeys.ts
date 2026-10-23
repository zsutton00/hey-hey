import type { TopologyEntitySummaryFilters } from "./topologyEntitySummaries";
import type { TopologyCategorySummaryFilters } from "./topologyCategorySummaries";
import type { TopologySubfacetFilters } from "./topologySubfacets";

export const topologyKeys = {
  root: () => ["topology"] as const,
  all: (organizationId: string, projectId: string) =>
    [...topologyKeys.root(), organizationId, projectId] as const,
  entitySummaries: (
    organizationId: string,
    projectId: string,
    filters: TopologyEntitySummaryFilters = {}
  ) =>
    [
      ...topologyKeys.all(organizationId, projectId),
      "entitySummaries",
      {
        category: filters.category,
        subfacetId: filters.subfacetId?.length
          ? [...new Set(filters.subfacetId)].sort()
          : undefined,
        since: filters.since,
        limitPerSubfacet: filters.limitPerSubfacet,
      },
    ] as const,
  categorySummaries: (
    organizationId: string,
    projectId: string,
    filters: TopologyCategorySummaryFilters = {}
  ) =>
    [
      ...topologyKeys.all(organizationId, projectId),
      "categorySummaries",
      { category: filters.category },
    ] as const,
  subfacets: (
    organizationId: string,
    projectId: string,
    filters: TopologySubfacetFilters = {}
  ) =>
    [
      ...topologyKeys.all(organizationId, projectId),
      "subfacets",
      { category: filters.category, status: filters.status },
    ] as const,
};
