import { queryOptions } from "@tanstack/react-query";
import type {
  TopologyCategorySummaryDto,
  TopologySummaryCategory,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { topologyKeys } from "./topologyKeys";
export interface TopologyCategorySummaryFilters {
  category?: TopologySummaryCategory;
}

export function topologyCategorySummariesQueryOptions(
  organizationId: string,
  projectId: string,
  filters: TopologyCategorySummaryFilters = {},
) {
  const queryKey = topologyKeys.categorySummaries(
    organizationId,
    projectId,
    filters,
  );
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({ signal }): Promise<TopologyCategorySummaryDto[]> => {
      const response = await platformClient.listTopologyCategorySummaries(
        { organizationId, projectId, ...queryKey[4] },
        { ...captureRequestOptions(), signal },
      );
      return response.data?.data ?? [];
    },
  });
}
