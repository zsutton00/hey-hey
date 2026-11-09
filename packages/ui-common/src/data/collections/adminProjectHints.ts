import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export interface AdminProjectHintsFilters {
  search?: string;
  itemTypes?: string[];
  minStrength?: number;
}

export function adminProjectHintsQueryOptions(
  organizationId: string,
  projectId: string,
  filters: AdminProjectHintsFilters = {},
) {
  const { search, itemTypes, minStrength } = filters;
  return queryOptions({
    ...dataLayerQueryPolicy,
    // Keep the previous result visible while a newer filter loads.
    placeholderData: keepPreviousData,
    queryKey: [
      "adminProjectHints",
      organizationId,
      projectId,
      { search, itemTypes, minStrength },
    ] as const,
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getAdminProjectHints(
        {
          organizationId,
          projectId,
          search: search || undefined,
          itemTypes: itemTypes?.length ? itemTypes : undefined,
          minStrength,
        },
        { ...captureRequestOptions(), signal },
      );
      const data = response.data.data;
      if (!data) throw new Error("The Hints response was incomplete.");
      return data;
    },
  });
}
