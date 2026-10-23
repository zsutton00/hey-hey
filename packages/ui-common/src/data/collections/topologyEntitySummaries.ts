import { queryOptions } from "@tanstack/react-query";
import type {
  TopologyEntitySummaryDto,
  TopologySummaryCategory,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { topologyKeys } from "./topologyKeys";
export interface TopologyEntitySummaryFilters {
  category?: TopologySummaryCategory;
  subfacetId?: string[];
  since?: string;
  limitPerSubfacet?: number;
}

export function topologyEntitySummariesQueryOptions(
  organizationId: string,
  projectId: string,
  filters: TopologyEntitySummaryFilters = {},
) {
  const queryKey = topologyKeys.entitySummaries(
    organizationId,
    projectId,
    filters,
  );
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({ signal }): Promise<TopologyEntitySummaryDto[]> => {
      const response = await platformClient.listTopologyEntitySummaries(
        { organizationId, projectId, ...queryKey[4] },
        { ...captureRequestOptions(), signal },
      );
      return response.data?.data ?? [];
    },
  });
}
