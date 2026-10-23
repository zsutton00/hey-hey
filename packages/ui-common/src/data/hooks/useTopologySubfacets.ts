import type {
  TopologySubfacetDto,
  TopologySummaryCategory,
  TopologySubfacetStatus,
} from "../../api";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { topologySubfacetsQueryOptions } from "../collections/topologySubfacets";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseTopologySubfacetsOptions
  extends CollectionHookOptions<TopologySubfacetDto> {
  category?: TopologySummaryCategory;
  status?: TopologySubfacetStatus;
}

export interface UseTopologySubfacetsReturn
  extends DataCollectionHookReturn<TopologySubfacetDto> {
  subfacets: TopologySubfacetDto[];
}

export function useTopologySubfacets(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseTopologySubfacetsOptions = {}
): UseTopologySubfacetsReturn {
  const { category, status } = options;
  const { result, state } = useDataLayerQuery(
    topologySubfacetsQueryOptions(organizationId ?? "", projectId ?? "", {
      category,
      status,
    }),
    {
      ...options,
      enabled:
        (options.enabled ?? true) && Boolean(organizationId && projectId),
    }
  );
  const data = result.data ?? [];
  return { ...state, data, subfacets: data };
}
