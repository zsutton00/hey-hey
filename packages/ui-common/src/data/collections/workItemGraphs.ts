import { queryOptions } from "@tanstack/react-query";
import type {
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphParticipationType,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export const workItemGraphKeys = {
  root: () => ["workItemGraph"] as const,
  all: (organizationId: string, projectId: string) =>
    [...workItemGraphKeys.root(), organizationId, projectId] as const,
  byId: (
    organizationId: string,
    projectId: string,
    workItemId: string,
    incidentRelationshipTypes: readonly WorkItemGraphParticipationType[] = []
  ) =>
    [
      ...workItemGraphKeys.all(organizationId, projectId),
      workItemId,
      [...new Set(incidentRelationshipTypes)].sort(),
    ] as const,
};

export function workItemGraphQueryOptions(
  organizationId: string,
  projectId: string,
  workItemId: string,
  incidentRelationshipTypes: readonly WorkItemGraphParticipationType[] = []
) {
  const queryKey = workItemGraphKeys.byId(
    organizationId,
    projectId,
    workItemId,
    incidentRelationshipTypes
  );
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({
      signal,
    }): Promise<WorkItemGraphAggregateResponseDto | null> => {
      const response = await unifiedApiClient.getWorkItemGraph(
        {
          organizationId,
          projectId,
          workItemId,
          incidentRelationshipTypes: queryKey[4].length
            ? new Set(queryKey[4])
            : undefined,
        },
        { ...captureRequestOptions(), signal }
      );
      return response.data.data ?? null;
    },
  });
}
