import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

import { unifiedApiClient } from "../../clients/serviceClients";
export interface AdminOrganizationMembersQuery {
  organizationId: string;
  name?: string;
  cursor?: string;
  limit?: number;
  cacheScope?: string;
}
const normalize = (query: AdminOrganizationMembersQuery) => ({
  organizationId: query.organizationId,
  name: query.name?.trim() || undefined,
  cursor: query.cursor || undefined,
  limit: query.limit ?? 25,
});
export const adminOrganizationMemberKeys = {
  root: () => ["adminOrganizationMembers"] as const,
  organization: (organizationId: string) =>
    [...adminOrganizationMemberKeys.root(), organizationId] as const,
  list: (query: AdminOrganizationMembersQuery, browserAuthScope = "") =>
    [
      ...adminOrganizationMemberKeys.organization(query.organizationId),
      "list",
      normalize(query),
      query.cacheScope ?? "",
      browserAuthScope,
    ] as const,
};
export function adminOrganizationMembersQueryOptions(
  query: AdminOrganizationMembersQuery,
  browserAuthScope = ""
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: adminOrganizationMemberKeys.list(query, browserAuthScope),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.listAdminOrganizationMembers(
        normalize(query),
        { ...captureRequestOptions(), signal }
      );
      return response.data.data;
    },
  });
}
