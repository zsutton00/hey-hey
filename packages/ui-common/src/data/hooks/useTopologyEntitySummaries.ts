import type {
  TopologyEntitySummaryDto,
  TopologySummaryCategory,
} from "../../api";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { topologyEntitySummariesQueryOptions } from "../collections/topologyEntitySummaries";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseTopologyEntitySummariesOptions
  extends CollectionHookOptions<TopologyEntitySummaryDto> {
  category?: TopologySummaryCategory;
  subfacetId?: string[];
  since?: string;
  limitPerSubfacet?: number;
}

export interface UseTopologyEntitySummariesReturn
  extends DataCollectionHookReturn<TopologyEntitySummaryDto> {
  summaries: TopologyEntitySummaryDto[];
}

export function useTopologyEntitySummaries(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseTopologyEntitySummariesOptions = {}
): UseTopologyEntitySummariesReturn {
  const { category, subfacetId, since, limitPerSubfacet } = options;
  const { result, state } = useDataLayerQuery(
    topologyEntitySummariesQueryOptions(organizationId ?? "", projectId ?? "", {
      category,
      subfacetId,
      since,
      limitPerSubfacet,
    }),
    {
      ...options,
      enabled:
        (options.enabled ?? true) && Boolean(organizationId && projectId),
    }
  );
  const data = result.data ?? [];
  return { ...state, data, summaries: data };
}
