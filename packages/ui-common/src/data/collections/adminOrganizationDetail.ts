import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type { AdminOrganizationDetailDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
export const assertAdminOrganizationDetailEntitlement = (
  data: AdminOrganizationDetailDto
) => {
  if (
    !data.entitlement ||
    !data.entitlement.subscriptionType ||
    !data.entitlement.accessStatus ||
    !Number.isInteger(data.entitlement.revision)
  ) {
    throw new Error("Invalid admin organization entitlement projection");
  }
};

export const adminOrganizationDetailKeys = {
  root: () => ["adminOrganizationDetail"] as const,
  detail: (organizationId: string, cacheScope = "") =>
    [
      ...adminOrganizationDetailKeys.root(),
      organizationId,
      cacheScope,
    ] as const,
};
export function adminOrganizationDetailQueryOptions(
  organizationId: string,
  cacheScope = ""
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: adminOrganizationDetailKeys.detail(organizationId, cacheScope),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getAdminOrganizationDetail(
        { organizationId },
        { ...captureRequestOptions(), signal }
      );
      const data = response.data.data;
      assertAdminOrganizationDetailEntitlement(data);
      return data;
    },
  });
}
