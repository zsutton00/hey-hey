import { queryOptions } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ReportsApiListProjectChangesRequest } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export function useProjectChanges(params: ReportsApiListProjectChangesRequest) {
  const options = useMemo(
    () =>
      queryOptions({
        ...dataLayerQueryPolicy,
        queryKey: ["reports", params.organizationId, "changes", params],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const response = await unifiedApiClient.listProjectChanges(params, {
            signal,
          });
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
      params.limit,
      params.offset,
    ],
  );
  const query = useDataLayerQuery(options, {
    enabled: !!params.organizationId && !!params.projectId,
    refetchOnMount: true,
  });
  return {
    ...query.state,
    page: query.result.data,
    refetch: query.result.refetch,
  };
}
