import { queryOptions } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ReportsApiListProjectChangePlacesRequest } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/** The branches and worktrees that have change records under the given filters. */
export function useProjectChangePlaces(
  params: ReportsApiListProjectChangePlacesRequest,
) {
  const options = useMemo(
    () =>
      queryOptions({
        ...dataLayerQueryPolicy,
        queryKey: ["reports", params.organizationId, "change-places", params],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const response = await unifiedApiClient.listProjectChangePlaces(
            params,
            { signal },
          );
          return response.data.data;
        },
      }),
    [
      params.organizationId,
      params.projectId,
      params.agentSessionId,
      params.serviceId,
      params.taskId,
      params.featureId,
      params.committed,
    ],
  );
  const query = useDataLayerQuery(options, {
    enabled: !!params.organizationId && !!params.projectId,
    refetchOnMount: true,
  });
  return {
    ...query.state,
    places: query.result.data?.places ?? [],
  };
}
