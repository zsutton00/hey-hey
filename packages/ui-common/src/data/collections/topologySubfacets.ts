import { queryOptions } from "@tanstack/react-query";
import type {
  TopologySubfacetDto,
  TopologySummaryCategory,
  TopologySubfacetStatus,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { topologyKeys } from "./topologyKeys";
export interface TopologySubfacetFilters {
  category?: TopologySummaryCategory;
  status?: TopologySubfacetStatus;
}

export function topologySubfacetsQueryOptions(
  organizationId: string,
  projectId: string,
  filters: TopologySubfacetFilters = {},
) {
  const queryKey = topologyKeys.subfacets(organizationId, projectId, filters);
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({ signal }): Promise<TopologySubfacetDto[]> => {
      const response = await platformClient.listTopologySubfacets(
        { organizationId, projectId, ...queryKey[4] },
        { ...captureRequestOptions(), signal },
      );
      return response.data?.data ?? [];
    },
  });
}
