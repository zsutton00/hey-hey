import { queryOptions } from "@tanstack/react-query";
import type { UxFlowMembershipResponseDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export const uxFlowMembershipKeys = {
  byWorkItem: (organizationId: string, projectId: string, workItemId: string) =>
    ["uxFlowMemberships", organizationId, projectId, workItemId] as const,
};

export function uxFlowMembershipQueryOptions(
  organizationId: string,
  projectId: string,
  workItemId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: uxFlowMembershipKeys.byWorkItem(
      organizationId,
      projectId,
      workItemId,
    ),
    queryFn: async ({
      signal,
    }): Promise<UxFlowMembershipResponseDto | null> => {
      const response = await unifiedApiClient.getUxFlowsForWorkItem(
        { organizationId, projectId, workItemId },
        { ...captureRequestOptions(), signal },
      );
      return response.data.data ?? null;
    },
  });
}
