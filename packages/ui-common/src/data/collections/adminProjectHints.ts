import { queryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export function adminProjectHintsQueryOptions(
  organizationId: string,
  projectId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: ["adminProjectHints", organizationId, projectId] as const,
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getAdminProjectHints(
        { organizationId, projectId },
        { ...captureRequestOptions(), signal },
      );
      const data = response.data.data;
      if (!data) throw new Error("The Hints response was incomplete.");
      return data;
    },
  });
}
